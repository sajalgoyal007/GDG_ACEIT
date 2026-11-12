import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isAutoProgressEnabled } from "@/lib/auto-progress/config";
import {
  bulkApproveStagedBadges,
  createBadgeSyncFetchRun,
  isBadgeSyncRunId,
  prepareBadgeSyncStaging,
  previewBadgeSyncRun,
  readBadgeSyncFetchProgress,
  readBadgeSyncSnapshot,
  setBadgeSyncFetchPause,
  type BadgeSyncFetchProgress,
  type BadgeSyncRpcWriter,
} from "@/lib/badges/fetch-queue";
import { executeBadgeSyncFetchBatch, type BadgeSyncFetchBatchResult } from "@/lib/badges/fetch-batch";
import { parseBadgeSyncSnapshot, type BadgeSyncSnapshot } from "@/lib/badges/snapshot";
import type { BadgeSyncBatchResponse, BadgeSyncResponseStatus } from "@/lib/badges/batch-state";
import { getAdminAuthorization } from "@/lib/supabase/admin-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function response(status: number, body: BadgeSyncBatchResponse) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function queueWriter(client: SupabaseClient): BadgeSyncRpcWriter {
  return {
    rpc: (name, args) => client.rpc(name as never, args as never),
  };
}

function previewMessage(snapshot: BadgeSyncSnapshot): string {
  const run = snapshot.run;
  const unclassified = run.unclassified_participant_count;
  const blocked = run.blocked_participant_count;
  return [
    `Preview ready: ${run.total_skill} Skill + ${run.total_arcade} Arcade across ${run.total_participants} participants.`,
    unclassified > 0
      ? `${unclassified} participant${unclassified === 1 ? "" : "s"} have unclassified badge identities; classify them below, then re-preview.`
      : null,
    blocked > 0 ? `${blocked} participant${blocked === 1 ? "" : "s"} will be left unchanged.` : null,
  ].filter(Boolean).join(" ");
}

function statusForRun(runStatus: string, fallback: BadgeSyncResponseStatus): BadgeSyncResponseStatus {
  if (runStatus === "applied") return "applied";
  if (runStatus === "rolled_back") return "rolled_back";
  if (runStatus === "previewed" || runStatus === "approved") return "previewed";
  return fallback;
}

/**
 * Align catalog classifications, auto-approve every catalog-classified
 * skill/arcade identity, then freeze the deterministic preview.
 */
async function buildPreview(writer: BadgeSyncRpcWriter, runId: string): Promise<BadgeSyncSnapshot> {
  await prepareBadgeSyncStaging(writer, runId);
  await bulkApproveStagedBadges(writer, runId);
  return parseBadgeSyncSnapshot(await previewBadgeSyncRun(writer, runId));
}

async function settleBatch(
  writer: BadgeSyncRpcWriter,
  runId: string,
  batch: BadgeSyncFetchBatchResult,
): Promise<BadgeSyncBatchResponse> {
  const progress = batch.progress;
  if (batch.halted) {
    return {
      status: "paused",
      message: batch.pauseReason ?? "The run paused before all participants were read.",
      runId,
      progress,
      halted: batch.halted,
    };
  }
  if (progress.total === 0) {
    return { status: "error", message: "No active participants are available for badge sync.", runId, progress };
  }
  if (!progress.complete) {
    if (batch.claimed === 0) {
      return {
        status: "paused",
        message: "No participants are ready right now. Resume when the retry delay has passed.",
        runId,
        progress,
      };
    }
    return {
      status: "running",
      message: `Processed ${progress.processed} of ${progress.total} participants.`,
      runId,
      progress,
    };
  }

  if (progress.runStatus === "staged") {
    const snapshot = await buildPreview(writer, runId);
    return { status: "previewed", message: previewMessage(snapshot), runId, progress, snapshot };
  }

  const snapshot = parseBadgeSyncSnapshot(await readBadgeSyncSnapshot(writer, runId));
  return {
    status: statusForRun(progress.runStatus, "previewed"),
    message: "This run is no longer accepting fetch batches.",
    runId,
    progress,
    snapshot,
  };
}

async function progressOrThrow(writer: BadgeSyncRpcWriter, runId: string): Promise<BadgeSyncFetchProgress> {
  return readBadgeSyncFetchProgress(writer, runId);
}

export async function POST(request: NextRequest) {
  if (!request.headers.get("origin") || request.headers.get("origin") !== request.nextUrl.origin) {
    return response(403, { status: "error", message: "This badge sync request was rejected." });
  }

  const authorization = await getAdminAuthorization();
  if (authorization.status !== "admin") {
    return response(
      authorization.status === "signed_out" ? 401 : authorization.status === "not_admin" ? 403 : 503,
      { status: "error", message: "Administrator access could not be verified. No profiles were fetched." },
    );
  }
  if (!isAutoProgressEnabled()) {
    return response(503, {
      status: "disabled",
      message: "Public-profile retrieval is disabled. No profiles were fetched.",
    });
  }

  const writer = queueWriter(authorization.client);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = typeof body?.action === "string" ? body.action : "";
  const runIdInput = body?.runId;

  try {
    if (action === "start") {
      const runId = await createBadgeSyncFetchRun(writer, null);
      const batch = await executeBadgeSyncFetchBatch({ writer, runId });
      return response(200, await settleBatch(writer, runId, batch));
    }

    if (!isBadgeSyncRunId(runIdInput)) {
      return response(400, { status: "error", message: "A valid badge sync run id is required." });
    }
    const runId = runIdInput;

    if (action === "continue") {
      const current = await progressOrThrow(writer, runId);
      if (current.complete) return response(200, await settleBatch(writer, runId, {
        progress: current,
        claimed: 0,
        staged: 0,
        failed: 0,
        skipped: 0,
        retrying: 0,
        stale: 0,
        halted: null,
        pauseReason: null,
        errors: [],
      }));
      if (current.paused) {
        return response(200, {
          status: "paused",
          message: current.pauseReason ?? "This badge sync run is paused.",
          runId,
          progress: current,
        });
      }
      const batch = await executeBadgeSyncFetchBatch({ writer, runId });
      return response(200, await settleBatch(writer, runId, batch));
    }

    if (action === "pause") {
      await setBadgeSyncFetchPause(writer, runId, true, "Paused by an administrator. Remaining participants stay queued.");
      const progress = await progressOrThrow(writer, runId);
      return response(200, {
        status: "paused",
        message: "The run is paused. Already staged observations are unchanged.",
        runId,
        progress,
      });
    }

    if (action === "resume") {
      await setBadgeSyncFetchPause(writer, runId, false, null);
      const progress = await progressOrThrow(writer, runId);
      return response(200, {
        status: progress.complete ? statusForRun(progress.runStatus, "previewed") : "running",
        message: progress.complete ? "The run is complete." : "The queue resumed.",
        runId,
        progress,
      });
    }

    if (action === "preview" || action === "repreview") {
      const progress = await progressOrThrow(writer, runId);
      if (!progress.complete) {
        return response(409, {
          status: "running",
          message: `The run is not complete yet: ${progress.remaining} participants remain.`,
          runId,
          progress,
        });
      }
      if (progress.runStatus === "applied" || progress.runStatus === "rolled_back") {
        return response(409, {
          status: statusForRun(progress.runStatus, "error"),
          message: "An applied or rolled-back run cannot be previewed again.",
          runId,
          progress,
        });
      }
      const snapshot = await buildPreview(writer, runId);
      return response(200, { status: "previewed", message: previewMessage(snapshot), runId, progress, snapshot });
    }

    return response(400, { status: "error", message: "Unknown badge sync action." });
  } catch {
    return response(503, {
      status: "temporarily_unavailable",
      message: "The badge sync batch could not complete. Queued participants and previous counts remain unchanged.",
    });
  }
}

export async function GET(request: NextRequest) {
  const authorization = await getAdminAuthorization();
  if (authorization.status !== "admin") {
    return response(authorization.status === "signed_out" ? 401 : authorization.status === "not_admin" ? 403 : 503, {
      status: "error",
      message: "Administrator access could not be verified.",
    });
  }
  const runId = request.nextUrl.searchParams.get("runId");
  if (!isBadgeSyncRunId(runId)) {
    return response(400, { status: "error", message: "A valid badge sync run id is required." });
  }
  try {
    const progress = await progressOrThrow(queueWriter(authorization.client), runId);
    return response(200, {
      status: progress.paused ? "paused" : progress.complete ? statusForRun(progress.runStatus, "previewed") : "running",
      message: progress.paused ? progress.pauseReason ?? "This run is paused." : "Badge sync progress.",
      runId,
      progress,
    });
  } catch {
    return response(503, {
      status: "temporarily_unavailable",
      message: "Badge sync progress could not be read.",
    });
  }
}

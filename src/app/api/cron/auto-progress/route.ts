import { NextResponse, type NextRequest } from "next/server";
import { isAutoProgressEnabled } from "@/lib/auto-progress/config";
import { executeDurableRefreshBatch } from "@/lib/auto-progress/refresh-job-executor";
import { startOrResumeDurableJob } from "@/lib/auto-progress/durable-job";
import { googleSkillsAutoProgressProvider } from "@/lib/auto-progress/provider";
import { authorizeCronRequest, cronProviderGate, scheduledRefreshDedupeKey } from "@/lib/auto-progress/cron-trigger";
import { claimRefreshJob, releaseRefreshJob } from "@/lib/auto-progress/refresh-job-lock";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
// Keep a batch boundary below common serverless request limits. Remaining work
// stays durable and is resumed by a later scheduled invocation.
export const maxDuration = 60;

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest) {
  const authorization = authorizeCronRequest(request.headers.get("authorization"), process.env.CRON_SECRET);
  if (authorization === "unconfigured") return json(503, { status: "not_configured", message: "Scheduled refresh authentication is not configured." });
  if (authorization !== "authorized") return json(401, { status: "unauthorized", message: "Scheduled refresh authorization failed." });
  const providerGate = cronProviderGate(isAutoProgressEnabled(), googleSkillsAutoProgressProvider.availability === "available");
  if (providerGate !== "ready") return json(503, { status: providerGate, message: "No approved live provider is enabled; no job was started and saved snapshots are unchanged." });

  let lockToken: string | null = null;
  try {
    const service = createSupabaseServiceClient();
    const lock = await claimRefreshJob(service);
    if (lock.status === "busy") return json(409, { status: "busy", retryAfterSeconds: lock.retryAfterSeconds });
    if (lock.status !== "claimed") return json(503, { status: "temporarily_unavailable", message: "The durable refresh lock could not be claimed." });
    lockToken = lock.token;

    const dedupeKey = scheduledRefreshDedupeKey();
    let job = await startOrResumeDurableJob(service, lockToken, "scheduled", dedupeKey);
    if (!job.id) return json(503, { status: "lock_lost", message: "The scheduled job lease expired before work could start." });

    const deadline = Date.now() + 25_000;
    let emptyClaim = false;
    while (!job.complete && Date.now() < deadline) {
      const batch = await executeDurableRefreshBatch({
        writer: service,
        jobId: job.id,
        lockToken,
        provider: googleSkillsAutoProgressProvider,
        concurrency: 4,
        timeoutMs: 15_000,
      });
      job = await startOrResumeDurableJob(service, lockToken, "scheduled", dedupeKey);
      if (!job.id) return json(503, { status: "lock_lost", message: "The scheduled job lease expired; durable work remains resumable." });
      if (batch.items.length === 0) {
        emptyClaim = true;
        break;
      }
    }

    return json(job.complete ? 200 : 202, {
      status: job.complete ? job.status : emptyClaim ? "waiting" : "running",
      runId: job.id,
      total: job.total,
      fetched: job.fetched,
      validated: job.validated,
      saved: job.saved,
      unchanged: job.unchanged,
      failed: job.failed,
      skipped: job.skipped,
      processed: job.saved + job.unchanged + job.failed + job.skipped,
      continuation: job.complete ? null : "The durable job will resume on the next protected invocation.",
    });
  } catch {
    return json(503, { status: "temporarily_unavailable", message: "Scheduled refresh failed safely; saved snapshots were preserved and unfinished work remains durable." });
  } finally {
    if (lockToken) {
      try {
        await releaseRefreshJob(createSupabaseServiceClient(), lockToken);
      } catch {
        // Lease expiry provides recovery if release cannot reach Supabase.
      }
    }
  }
}

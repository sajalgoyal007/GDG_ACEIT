/**
 * One bounded badge-sync fetch batch.
 *
 * The route calls this repeatedly until the queue is complete. Every claimed
 * item is either staged (a trustworthy observation), staged as failed (no
 * trustworthy evidence, NULL counts), skipped (participant left the roster), or
 * returned to `pending` for a later retry.
 *
 * HTTP 403/429 is run-fatal: the current item is released back to `pending`,
 * every unattempted claimed item is released, and the run is paused so the next
 * invocation cannot burn through the rest of the roster.
 *
 * Fetching stays behind the existing AUTO_PROGRESS_ENABLED and
 * GOOGLE_SKILLS_PROFILE_FETCH_AUTHORIZED gates inside fetchPublicProfileHtml.
 */

import { parseStructuralBadgeSignals } from "../auto-progress/parser.ts";
import { fetchPublicProfileHtml, type ProfileFetchResult } from "../auto-progress/safe-fetch.ts";
import {
  claimBadgeSyncFetchBatch,
  finishBadgeSyncFetchItem,
  readBadgeSyncFetchProgress,
  setBadgeSyncFetchPause,
  type BadgeSyncFetchItem,
  type BadgeSyncFetchProgress,
  type BadgeSyncRpcWriter,
} from "./fetch-queue.ts";
import { toStagingPayload, validateObservationBatch } from "./observations.ts";
import {
  failedFetchObservation,
  isHaltStatus,
  structuralSignalsToObservation,
  type BadgeFetchFailureCategory,
} from "./structural-identities.ts";
import type { ObservationParticipantInput } from "./observations.ts";

const DEFAULT_BATCH_SIZE = 8;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_PACING_MS = 1_500;
const DEFAULT_RETRY_AFTER_SECONDS = 900;
const DEFAULT_TIMEOUT_MS = 15_000;

export type BadgeSyncHalt = "rate_limited" | "blocked";

export interface ExecuteBadgeSyncFetchBatchOptions {
  writer: BadgeSyncRpcWriter;
  runId: string;
  fetchHtml?: (profileUrl: string) => Promise<ProfileFetchResult>;
  batchSize?: number;
  concurrency?: number;
  leaseSeconds?: number;
  pacingMs?: number;
  retryAfterSeconds?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface BadgeSyncFetchBatchResult {
  progress: BadgeSyncFetchProgress;
  claimed: number;
  staged: number;
  failed: number;
  skipped: number;
  retrying: number;
  stale: number;
  halted: BadgeSyncHalt | null;
  pauseReason: string | null;
  errors: { participantId: string; category: string }[];
}

function bounded(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** Default pacing is 1.5 s between fetch starts unless explicitly configured. */
export function readBadgeSyncFetchPacingMs(env: Record<string, string | undefined> = process.env): number {
  const parsed = Number(env.BADGE_SYNC_FETCH_PACING_MS);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_PACING_MS;
  return Math.min(10_000, Math.trunc(parsed));
}

function pauseText(halt: BadgeSyncHalt): string {
  return halt === "rate_limited"
    ? "Google Skills rate limited the run (HTTP 429). Remaining participants stay queued; resume after the limit clears."
    : "Google Skills refused the run (HTTP 403). Remaining participants stay queued; resume after access is restored.";
}

function errorMessage(error: unknown): string {
  return typeof error === "object" && error !== null && typeof (error as { message?: unknown }).message === "string"
    ? (error as { message: string }).message
    : "";
}

export async function executeBadgeSyncFetchBatch(
  options: ExecuteBadgeSyncFetchBatchOptions,
): Promise<BadgeSyncFetchBatchResult> {
  const {
    writer,
    runId,
    fetchHtml = (profileUrl) => fetchPublicProfileHtml(profileUrl, { timeoutMs: timeoutMs }),
    sleep = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    now = () => Date.now(),
  } = options;
  const batchSize = bounded(options.batchSize, DEFAULT_BATCH_SIZE, 1, 16);
  const concurrency = bounded(options.concurrency, DEFAULT_CONCURRENCY, 1, 8);
  const pacingMs = bounded(options.pacingMs, readBadgeSyncFetchPacingMs(), 0, 10_000);
  const retryAfterSeconds = bounded(options.retryAfterSeconds, DEFAULT_RETRY_AFTER_SECONDS, 1, 86_400);
  const timeoutMs = bounded(options.timeoutMs, DEFAULT_TIMEOUT_MS, 1, 15_000);

  const items = await claimBadgeSyncFetchBatch(writer, runId, {
    batchSize,
    leaseSeconds: options.leaseSeconds,
  });

  const result: BadgeSyncFetchBatchResult = {
    progress: await readBadgeSyncFetchProgress(writer, runId),
    claimed: items.length,
    staged: 0,
    failed: 0,
    skipped: 0,
    retrying: 0,
    stale: 0,
    halted: null,
    pauseReason: null,
    errors: [],
  };
  if (items.length === 0) return result;

  let halt: BadgeSyncHalt | null = null;
  const attempted = new Set<string>();
  let cursor = 0;
  let nextFetchAt = now();

  async function pace(): Promise<void> {
    const current = now();
    const wait = Math.max(0, nextFetchAt - current);
    nextFetchAt = (wait > 0 ? nextFetchAt : current) + pacingMs;
    if (wait > 0) await sleep(wait);
  }

  async function finish(
    item: BadgeSyncFetchItem,
    status: "staged" | "failed" | "skipped" | "pending",
    errorCategory: string | null,
  ): Promise<void> {
    try {
      const finished = await finishBadgeSyncFetchItem(writer, runId, item, status, {
        errorCategory,
        retryAfterSeconds: status === "pending" ? retryAfterSeconds : null,
      });
      if (finished === "stale") result.stale += 1;
      else if (finished === "staged") result.staged += 1;
      else if (finished === "failed") result.failed += 1;
      else if (finished === "skipped") result.skipped += 1;
      else result.retrying += 1;
    } catch {
      result.errors.push({ participantId: item.participantId, category: "finish_failed" });
    }
  }

  async function stage(item: BadgeSyncFetchItem, participant: ObservationParticipantInput): Promise<boolean> {
    const validation = validateObservationBatch([participant]);
    if (!validation.ok) {
      result.errors.push({ participantId: item.participantId, category: "invalid_observation" });
      return false;
    }
    try {
      const { error } = await writer.rpc("admin_stage_badge_sync_observations", {
        p_run_id: runId,
        p_participants: toStagingPayload(validation.value),
      });
      if (error) throw error;
      return true;
    } catch (error) {
      // A participant removed after the claim can no longer be staged. They are
      // exempt from the completeness guard, so retire the item instead of
      // retrying forever.
      if (/removed/i.test(errorMessage(error))) {
        await finish(item, "skipped", "participant_removed");
      } else {
        result.errors.push({ participantId: item.participantId, category: "staging_error" });
        await finish(item, "pending", "staging_error");
      }
      return false;
    }
  }

  async function processItem(item: BadgeSyncFetchItem): Promise<void> {
    if (halt) return;
    await pace();
    if (halt) return;
    attempted.add(item.id);

    if (!item.profileUrl) {
      const participant = failedFetchObservation(item.participantId, "no_profile_url");
      if (await stage(item, participant)) await finish(item, "staged", "no_profile_url");
      return;
    }

    let fetched: ProfileFetchResult;
    try {
      fetched = await fetchHtml(item.profileUrl);
    } catch {
      fetched = { status: "upstream_error" };
    }

    if (fetched.status === "ok") {
      const structural = parseStructuralBadgeSignals(fetched.html, fetched.normalizedProfileUrl);
      const decision = structuralSignalsToObservation(item.participantId, structural);
      if (await stage(item, decision.participant)) {
        await finish(item, "staged", decision.status === "complete" ? null : decision.reason);
      }
      return;
    }

    if (isHaltStatus(fetched.status)) {
      halt = fetched.status;
      try {
        const paused = await setBadgeSyncFetchPause(writer, runId, true, pauseText(fetched.status));
        result.pauseReason = paused.pauseReason;
      } catch {
        result.errors.push({ participantId: item.participantId, category: "pause_failed" });
      }
      await finish(item, "pending", fetched.status);
      return;
    }

    const category = fetched.status as BadgeFetchFailureCategory;
    const participant = failedFetchObservation(item.participantId, category);
    if (await stage(item, participant)) await finish(item, "staged", category);
  }

  async function worker(): Promise<void> {
    while (!halt) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      await processItem(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));

  // Anything claimed but never attempted (because the run halted) stays pending.
  for (const item of items) {
    if (attempted.has(item.id)) continue;
    await finish(item, "pending", halt ?? "paused");
  }

  result.halted = halt;
  result.progress = await readBadgeSyncFetchProgress(writer, runId);
  if (halt) result.pauseReason = result.progress.pauseReason ?? result.pauseReason;
  return result;
}

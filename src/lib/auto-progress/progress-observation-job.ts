import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchGoogleSkillsObservedBadgeCount } from "./google-skills-observed-count-provider.ts";
import type { FetchLike } from "./safe-fetch.ts";
import type { RpcWriter } from "./service.ts";

export type ObservationJobProgress = {
  id: string | null;
  status: "running" | "completed" | "partial" | "busy" | "stale_lease";
  total: number;
  observed: number;
  failed: number;
  skipped: number;
};
export type ObservationJobItem = { id: string; participantId: string; claimToken: string; attempt: number };
export type ObservationAttempt = { participantId: string; status: "observed" | "failed" | "skipped" | "retrying" | "stale"; message: string };

function row(value: unknown): Record<string, unknown> | null {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "object" && first !== null ? first as Record<string, unknown> : null;
}
function count(value: unknown): number {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
}
function parseProgress(value: unknown): ObservationJobProgress | null {
  const result = row(value);
  if (!result || !["running", "completed", "partial", "busy", "stale_lease"].includes(String(result.job_status))) return null;
  return {
    id: typeof result.job_id === "string" ? result.job_id : null,
    status: result.job_status as ObservationJobProgress["status"],
    total: count(result.total_count), observed: count(result.observed_count),
    failed: count(result.failed_count), skipped: count(result.skipped_count),
  };
}

export async function startOrResumeObservationJob(writer: RpcWriter, lockToken: string, actorUserId: string, dedupeKey: string) {
  const result = await writer.rpc("start_or_resume_progress_observation_job", {
    p_lock_token: lockToken, p_actor_user_id: actorUserId, p_dedupe_key: dedupeKey,
  });
  const progress = parseProgress(result.data);
  if (result.error || !progress) throw new Error("observation_job_start_failed");
  return progress;
}

export async function claimObservationBatch(writer: RpcWriter, jobId: string, lockToken: string, batchSize = 8): Promise<ObservationJobItem[]> {
  const result = await writer.rpc("claim_progress_observation_batch", {
    p_job_id: jobId, p_lock_token: lockToken, p_batch_size: batchSize,
  });
  if (result.error || !Array.isArray(result.data)) throw new Error("observation_job_claim_failed");
  const items = result.data.flatMap((value): ObservationJobItem[] => {
    if (!value || typeof value !== "object") return [];
    const valueRow = value as Record<string, unknown>;
    if (typeof valueRow.item_id !== "string" || typeof valueRow.participant_id !== "string" || typeof valueRow.item_claim_token !== "string") return [];
    return [{ id: valueRow.item_id, participantId: valueRow.participant_id, claimToken: valueRow.item_claim_token, attempt: count(valueRow.attempt_count) }];
  });
  if (items.length !== result.data.length) throw new Error("observation_job_claim_invalid");
  return items;
}

async function finishItem(writer: RpcWriter, args: Record<string, unknown>) {
  const result = await writer.rpc("finish_progress_observation_item", args);
  const first = row(result.data);
  if (result.error || !first || typeof first.item_status !== "string") return "stale";
  return first.item_status;
}

function retrySeconds(retryAfter: string | undefined): number {
  if (!retryAfter) return 60;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds)) return Math.max(1, Math.min(3600, Math.ceil(seconds)));
  const date = Date.parse(retryAfter);
  return Number.isFinite(date) ? Math.max(1, Math.min(3600, Math.ceil((date - Date.now()) / 1000))) : 60;
}

/** Processes only claimed work; the SQL RPC atomically fences claims and inserts unverified observations. */
export async function executeObservationBatch(input: {
  writer: RpcWriter;
  adminClient: SupabaseClient;
  actorUserId: string;
  jobId: string;
  lockToken: string;
  items: readonly ObservationJobItem[];
  renewLease: () => Promise<boolean>;
  fetchImpl?: FetchLike;
  concurrency?: number;
  timeoutMs?: number;
}): Promise<ObservationAttempt[]> {
  const concurrency = Math.max(1, Math.min(4, Math.trunc(input.concurrency ?? 4)));
  const timeoutMs = Math.max(1, Math.min(15_000, Math.trunc(input.timeoutMs ?? 10_000)));
  const attempts: ObservationAttempt[] = [];
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor++;
      if (index >= input.items.length) return;
      const item = input.items[index];
      let leaseActive = false;
      try { leaseActive = await input.renewLease(); } catch { leaseActive = false; }
      if (!leaseActive) {
        attempts.push({ participantId: item.participantId, status: "stale", message: "The refresh lease expired; this item was not saved." });
        continue;
      }
      const { data, error } = await input.adminClient.from("participants")
        .select("participant_key,profile_url,auto_profile_revision")
        .eq("id", item.participantId).eq("registration_status", "registered").maybeSingle();
      let finalStatus: ObservationAttempt["status"] = "failed";
      let message = "Profile observation failed; prior observations remain unchanged.";
      const baseArgs = {
        p_job_id: input.jobId, p_lock_token: input.lockToken, p_item_id: item.id,
        p_item_claim_token: item.claimToken, p_actor_user_id: input.actorUserId,
      };
      if (error) {
        const retry = item.attempt < 2;
        const status = await finishItem(input.writer, {
          ...baseArgs, p_status: retry ? "pending" : "failed", p_error_category: "participant_lookup_failed",
          p_retry_after_seconds: retry ? 30 : null,
        });
        finalStatus = status === "stale" ? "stale" : status === "pending" ? "retrying" : "failed";
        message = "The registered profile could not be loaded; no profile request was made.";
      } else if (!data || typeof data.profile_url !== "string" || typeof data.participant_key !== "string") {
        const status = await finishItem(input.writer, { ...baseArgs, p_status: "skipped", p_error_category: "profile_unavailable" });
        finalStatus = status === "skipped" ? "skipped" : "stale";
        message = "No current registered profile was available; nothing was fetched.";
      } else {
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => { controller.abort(); reject(new Error("timeout")); }, timeoutMs);
          });
          const observed = await Promise.race([fetchGoogleSkillsObservedBadgeCount(data.profile_url, { fetchImpl: input.fetchImpl, signal: controller.signal }), timeout]);
          if (observed.status === "unverified") {
            const status = await finishItem(input.writer, {
              ...baseArgs, p_status: "observed", p_error_category: null, p_retry_after_seconds: null,
              p_participant_key: data.participant_key, p_profile_url: data.profile_url,
              p_profile_revision: data.auto_profile_revision, p_http_status: observed.httpStatus,
              p_retrieved_at: observed.retrievedAt, p_reported_total: observed.candidateCount,
              p_detail_count: observed.detailCount,
            });
            finalStatus = status === "observed" ? "observed" : status === "stale" ? "stale" : "failed";
            message = finalStatus === "observed" ? "Unverified rendered-card observation recorded; completeness is unknown." : "The profile or claim changed; no observation was recorded.";
          } else {
            const retryable = ["rate_limited", "timeout", "upstream_error", "provider_unavailable"].includes(observed.status);
            const retry = retryable && item.attempt < 2;
            const seconds = observed.status === "rate_limited" ? retrySeconds(observed.retryAfter) : 60;
            const status = await finishItem(input.writer, {
              ...baseArgs, p_status: retry ? "pending" : observed.status === "identity_mismatch" || observed.status === "identity_unverified" || observed.status === "invalid_url" ? "skipped" : "failed",
              p_error_category: observed.status, p_retry_after_seconds: retry ? seconds : null,
            });
            finalStatus = status === "stale" ? "stale" : status === "pending" ? "retrying" : status === "skipped" ? "skipped" : "failed";
            message = `No count was recorded (${observed.status}); previous observations remain unchanged.`;
          }
        } catch {
          const retry = item.attempt < 2;
          const status = await finishItem(input.writer, {
            ...baseArgs, p_status: retry ? "pending" : "failed", p_error_category: "timeout", p_retry_after_seconds: retry ? 60 : null,
          });
          finalStatus = status === "stale" ? "stale" : status === "pending" ? "retrying" : "failed";
          message = "The profile request did not complete; previous observations remain unchanged.";
        } finally {
          if (timer) clearTimeout(timer);
        }
      }
      attempts.push({ participantId: item.participantId, status: finalStatus, message });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, input.items.length) }, () => worker()));
  return attempts.sort((a, b) => a.participantId.localeCompare(b.participantId));
}

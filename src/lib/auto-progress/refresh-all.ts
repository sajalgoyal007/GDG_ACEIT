import type { ClaimResult, PersistResult } from "./service.ts";

export type RefreshAllItemStatus = "refreshed" | "unchanged" | "retrying" | "unavailable" | "failed" | "stale" | "skipped" | "timeout";
export type RefreshAllItem = { participantId: string; status: RefreshAllItemStatus; message: string; fetched: boolean; updated: boolean };
export type RefreshAllSummary = {
  status: "completed" | "partial" | "running" | "waiting" | "lock_lost";
  total: number;
  fetched: number;
  validated?: number;
  updated: number;
  unchanged?: number;
  refreshed: number;
  failed: number;
  skipped: number;
  results: RefreshAllItem[];
  jobId?: string;
  processed?: number;
  retryAfterSeconds?: number;
};

function itemStatus(result: ClaimResult | PersistResult): Pick<RefreshAllItem, "status" | "message" | "fetched" | "updated"> {
  if (result.status === "recorded") {
    const row = Array.isArray(result.result) ? result.result[0] : result.result;
    const resultStatus = typeof row === "object" && row !== null && "result_status" in row ? row.result_status : null;
    const itemStatus = typeof row === "object" && row !== null && "item_status" in row ? row.item_status : null;
    if (itemStatus === "unchanged" && resultStatus === "ok") return { status: "unchanged", message: "The complete snapshot was unchanged.", fetched: result.fetched, updated: false };
    if (itemStatus === "pending") return { status: "retrying", message: "A transient failure is queued for retry.", fetched: result.fetched, updated: false };
    if (resultStatus === "ok") return { status: "refreshed", message: "Complete progress snapshot saved.", fetched: result.fetched, updated: true };
    if (resultStatus === "stale_claim") return { status: "stale", message: "Profile changed during refresh; saved progress was preserved.", fetched: result.fetched, updated: false };
    if (resultStatus === "duplicate_profile") return { status: "skipped", message: "A duplicate profile URL cannot qualify multiple participants.", fetched: result.fetched, updated: false };
    return { status: "failed", message: "The profile result was not saved; prior progress was preserved.", fetched: result.fetched, updated: false };
  }
  if (result.status === "write_failed") return { status: "failed", message: "The complete profile result could not be saved; prior progress was preserved.", fetched: result.fetched, updated: false };
  if (result.status === "cancelled") return { status: "timeout", message: "Refresh was cancelled; prior progress was preserved.", fetched: false, updated: false };
  if (result.status === "provider_unavailable" || result.status === "disabled") {
    return { status: "unavailable", message: "Live profile retrieval is unavailable; saved progress was preserved.", fetched: false, updated: false };
  }
  if (result.status === "cooldown" || result.status === "busy" || result.status === "duplicate_profile"
    || result.status === "no_profile" || result.status === "no_participant") {
    return { status: "skipped", message: "This registration was skipped by its cooldown, profile, or claim checks.", fetched: false, updated: false };
  }
  if (result.status === "not_recorded") return { status: "stale", message: "Profile identity changed; saved progress was preserved.", fetched: false, updated: false };
  return { status: "failed", message: "Refresh failed; saved progress was preserved.", fetched: false, updated: false };
}

/** Runs a bounded batch. The lease callback must renew the database job lock before each profile. */
export async function refreshAllParticipants(
  participantIds: readonly string[],
  refreshOne: (participantId: string, signal: AbortSignal) => Promise<ClaimResult | PersistResult>,
  options: {
    concurrency?: number;
    timeoutMs?: number;
    renewJobLease?: () => Promise<boolean>;
  } = {},
): Promise<RefreshAllSummary> {
  const concurrency = Math.max(1, Math.min(4, Math.trunc(options.concurrency ?? 4)));
  const timeoutMs = Math.max(1, Math.min(30_000, Math.trunc(options.timeoutMs ?? 15_000)));
  const results: RefreshAllItem[] = [];
  let cursor = 0;
  let lockLost = false;

  async function worker() {
    while (!lockLost) {
      const index = cursor++;
      if (index >= participantIds.length) return;
      const participantId = participantIds[index];
      if (options.renewJobLease && !(await options.renewJobLease())) {
        lockLost = true;
        results.push({ participantId, status: "skipped", message: "Refresh job lease expired; no new profile was started.", fetched: false, updated: false });
        return;
      }

      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("refresh_timeout"));
        }, timeoutMs);
      });
      try {
        const result = await Promise.race([refreshOne(participantId, controller.signal), timeout]);
        results.push({ participantId, ...itemStatus(result) });
      } catch (error) {
        results.push({
          participantId,
          status: error instanceof Error && error.message === "refresh_timeout" ? "timeout" : "failed",
          message: "Refresh did not complete; saved progress was preserved.",
          fetched: false,
          updated: false,
        });
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, participantIds.length) }, () => worker()));
  const reported = new Set(results.map((item) => item.participantId));
  if (lockLost) {
    for (const participantId of participantIds) {
      if (!reported.has(participantId)) results.push({
        participantId,
        status: "skipped",
        message: "Refresh job lease expired before this profile started; saved progress was preserved.",
        fetched: false,
        updated: false,
      });
    }
  }
  const sorted = [...results].sort((left, right) => left.participantId.localeCompare(right.participantId));
  const refreshed = sorted.filter((item) => item.status === "refreshed").length;
  const failed = sorted.filter((item) => item.status === "failed" || item.status === "timeout").length;
  return {
    status: lockLost ? "lock_lost" : "completed",
    total: participantIds.length,
    fetched: sorted.filter((item) => item.fetched).length,
    updated: sorted.filter((item) => item.updated).length,
    refreshed,
    failed,
    skipped: sorted.length - refreshed - failed,
    results: sorted,
  };
}

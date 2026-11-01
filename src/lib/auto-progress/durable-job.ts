import type { RpcWriter } from "./service.ts";

export type DurableJobState = "queued" | "running" | "completed" | "partial" | "stale_lease";
export type DurableJobProgress = {
  id: string | null;
  status: DurableJobState;
  total: number;
  fetched: number;
  validated: number;
  saved: number;
  unchanged: number;
  failed: number;
  skipped: number;
  complete: boolean;
};
export type DurableJobItem = { id: string; participantId: string; claimToken: string; attempt: number };

function firstRow(data: unknown): Record<string, unknown> | null {
  return Array.isArray(data) && typeof data[0] === "object" && data[0] !== null ? data[0] as Record<string, unknown> : null;
}

function integer(row: Record<string, unknown>, key: string): number {
  const value = Number(row[key]);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function progress(row: Record<string, unknown> | null): DurableJobProgress | null {
  if (!row || typeof row.job_status !== "string") return null;
  const jobStatus = row.job_status;
  if (!(["queued", "running", "completed", "partial", "stale_lease"] as string[]).includes(jobStatus)) return null;
  const jobId = typeof row.job_id === "string" ? row.job_id : null;
  if (jobStatus !== "stale_lease" && jobId === null) return null;
  return {
    id: jobId,
    status: jobStatus as DurableJobState,
    total: integer(row, "total_count"),
    fetched: integer(row, "fetched_count"),
    validated: integer(row, "validated_count"),
    saved: integer(row, "saved_count"),
    unchanged: integer(row, "unchanged_count"),
    failed: integer(row, "failed_count"),
    skipped: integer(row, "skipped_count"),
    complete: row.is_complete === true,
  };
}

export async function startOrResumeDurableJob(
  writer: RpcWriter,
  lockToken: string,
  triggerSource: "admin" | "scheduled",
  dedupeKey: string,
): Promise<DurableJobProgress> {
  const { data, error } = await writer.rpc("start_or_resume_participant_auto_refresh_job", {
    p_lock_token: lockToken,
    p_trigger_source: triggerSource,
    p_dedupe_key: dedupeKey,
  });
  const row = firstRow(data);
  const result = progress(row);
  if (error || !result) throw new Error("durable_job_start_failed");
  return result;
}

export async function claimDurableJobBatch(
  writer: RpcWriter,
  jobId: string,
  lockToken: string,
  batchSize = 8,
): Promise<DurableJobItem[]> {
  const { data, error } = await writer.rpc("claim_participant_auto_refresh_job_batch", {
    p_job_id: jobId,
    p_lock_token: lockToken,
    p_batch_size: batchSize,
    p_item_lease_seconds: 120,
  });
  if (error || !Array.isArray(data)) throw new Error("durable_job_batch_claim_failed");
  const items = data.flatMap((item): DurableJobItem[] => {
    if (typeof item !== "object" || item === null) return [];
    const row = item as Record<string, unknown>;
    if (typeof row.item_id !== "string" || typeof row.participant_id !== "string"
      || typeof row.item_claim_token !== "string") return [];
    return [{ id: row.item_id, participantId: row.participant_id, claimToken: row.item_claim_token, attempt: integer(row, "attempt_count") }];
  });
  if (items.length !== data.length) throw new Error("durable_job_batch_invalid");
  return items;
}

export async function finishDurableJobItem(
  writer: RpcWriter,
  jobId: string,
  lockToken: string,
  item: DurableJobItem,
  status: "failed" | "skipped" | "pending",
  errorCategory: string,
  retryAfterSeconds?: number,
): Promise<boolean> {
  const { data, error } = await writer.rpc("finish_participant_auto_refresh_job_item", {
    p_job_id: jobId,
    p_lock_token: lockToken,
    p_item_id: item.id,
    p_item_claim_token: item.claimToken,
    p_item_status: status,
    p_error_category: errorCategory,
    p_retry_after_seconds: retryAfterSeconds ?? null,
  });
  return !error && firstRow(data)?.item_status === status;
}

export function durableJobRecordFetch(
  writer: RpcWriter,
  jobId: string,
  lockToken: string,
  item: DurableJobItem,
) {
  return (args: Record<string, unknown>) => writer.rpc("record_participant_auto_refresh_job_result", {
    p_job_id: jobId,
    p_lock_token: lockToken,
    p_item_id: item.id,
    p_item_claim_token: item.claimToken,
    ...args,
  });
}

export async function runDurableBatch<T>(
  items: readonly DurableJobItem[],
  processItem: (item: DurableJobItem, signal: AbortSignal) => Promise<T>,
  options: { concurrency?: number; timeoutMs?: number } = {},
): Promise<{ item: DurableJobItem; value?: T; error?: "timeout" | "failed" }[]> {
  const concurrency = Math.max(1, Math.min(4, Math.trunc(options.concurrency ?? 4)));
  const timeoutMs = Math.max(1, Math.min(30_000, Math.trunc(options.timeoutMs ?? 15_000)));
  const results: { item: DurableJobItem; value?: T; error?: "timeout" | "failed" }[] = [];
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      const item = items[index];
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("timeout")); }, timeoutMs);
      });
      try {
        const value = await Promise.race([processItem(item, controller.signal), timeout]);
        results.push({ item, value });
      } catch (error) {
        results.push({ item, error: error instanceof Error && error.message === "timeout" ? "timeout" : "failed" });
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results.sort((a, b) => a.item.participantId.localeCompare(b.item.participantId));
}

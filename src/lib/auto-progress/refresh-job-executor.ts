import { claimDurableJobBatch, durableJobRecordFetch, finishDurableJobItem, runDurableBatch, startOrResumeDurableJob, type DurableJobItem } from "./durable-job.ts";
import { refreshParticipantAutoProgress, type ClaimResult, type PersistResult, type RpcWriter } from "./service.ts";
import { renewRefreshJob } from "./refresh-job-lock.ts";
import type { AutoProgressProvider } from "./provider.ts";
import type { FetchLike } from "./safe-fetch.ts";

export type DurableBatchItemResult = {
  participantId: string;
  status: "saved" | "unchanged" | "failed" | "skipped" | "retrying" | "stale";
  fetched: boolean;
  validated: boolean;
  message: string;
};

export type DurableBatchExecution = {
  items: DurableJobItem[];
  results: DurableBatchItemResult[];
};

function rpcRow(value: unknown): Record<string, unknown> | null {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "object" && first !== null ? first as Record<string, unknown> : null;
}

function recordedResult(result: PersistResult): DurableBatchItemResult {
  if (result.status === "recorded") {
    const row = rpcRow(result.result);
    const resultStatus = row?.result_status;
    const itemStatus = row?.item_status;
    if (itemStatus === "saved" && resultStatus === "ok") return { participantId: "", status: "saved", fetched: result.fetched, validated: result.validated, message: "A validated snapshot was saved." };
    if (itemStatus === "unchanged" && resultStatus === "ok") return { participantId: "", status: "unchanged", fetched: result.fetched, validated: result.validated, message: "The complete snapshot was unchanged." };
    if (itemStatus === "pending") return { participantId: "", status: "retrying", fetched: result.fetched, validated: result.validated, message: "A transient retrieval failure was saved for retry." };
    if (itemStatus === "skipped" || resultStatus === "stale_claim" || resultStatus === "duplicate_profile") return { participantId: "", status: "stale", fetched: result.fetched, validated: result.validated, message: "The profile or claim changed; the saved snapshot was preserved." };
    return { participantId: "", status: "failed", fetched: result.fetched, validated: result.validated, message: "The result was incomplete or could not be saved; the last successful snapshot was preserved." };
  }
  if (result.status === "write_failed") return { participantId: "", status: "retrying", fetched: result.fetched, validated: result.validated, message: "Persistence did not confirm; this item remains resumable." };
  return { participantId: "", status: "failed", fetched: false, validated: false, message: "This profile attempt did not complete." };
}

function retryDelay(result: ClaimResult): number {
  return result.status === "cooldown" || result.status === "busy" ? Math.max(1, Math.min(3600, result.retryAfterSeconds)) : 30;
}

async function settleUnclaimed(writer: RpcWriter, jobId: string, lockToken: string, item: DurableJobItem, result: ClaimResult): Promise<DurableBatchItemResult> {
  if (result.status === "no_profile" || result.status === "no_participant" || result.status === "duplicate_profile") {
    const category = result.status;
    const saved = await finishDurableJobItem(writer, jobId, lockToken, item, "skipped", category);
    return { participantId: item.participantId, status: saved ? "skipped" : "stale", fetched: false, validated: false, message: saved ? "No unique registered public profile was available." : "The item lease expired; a newer worker owns it." };
  }
  if (result.status === "cooldown" || result.status === "busy") {
    const saved = await finishDurableJobItem(writer, jobId, lockToken, item, "pending", result.status, retryDelay(result));
    return { participantId: item.participantId, status: saved ? "retrying" : "stale", fetched: false, validated: false, message: saved ? `The profile is deferred for ${retryDelay(result)} seconds by its database cooldown or claim.` : "The item lease expired; a newer worker owns it." };
  }
  if (result.status === "claim_failed") {
    const saved = await finishDurableJobItem(writer, jobId, lockToken, item, item.attempt < 3 ? "pending" : "failed", "claim_failed", item.attempt < 3 ? 30 : undefined);
    return { participantId: item.participantId, status: saved ? (item.attempt < 3 ? "retrying" : "failed") : "stale", fetched: false, validated: false, message: saved ? "The database claim did not complete; the item will retry safely." : "The item lease expired; a newer worker owns it." };
  }
  const saved = await finishDurableJobItem(writer, jobId, lockToken, item, "skipped", result.status);
  return { participantId: item.participantId, status: saved ? "skipped" : "stale", fetched: false, validated: false, message: "The item was not eligible for this run; its last successful snapshot was preserved." };
}

export async function executeDurableRefreshBatch(input: {
  writer: RpcWriter;
  jobId: string;
  lockToken: string;
  fetchImpl?: FetchLike;
  provider?: AutoProgressProvider;
  concurrency?: number;
  timeoutMs?: number;
}): Promise<DurableBatchExecution> {
  const items = await claimDurableJobBatch(input.writer, input.jobId, input.lockToken, 8);
  const outcomes = await runDurableBatch(items, async (item, signal) => {
    if (!(await renewRefreshJob(input.writer, input.lockToken))) return { kind: "claim" as const, result: { status: "claim_failed" as const } };
    const result = await refreshParticipantAutoProgress(input.writer, item.participantId, {
      provider: input.provider,
      fetchImpl: input.fetchImpl,
      signal,
      recordFetch: durableJobRecordFetch(input.writer, input.jobId, input.lockToken, item),
    });
    if (result.status === "recorded" || result.status === "write_failed") {
      return { kind: "persist" as const, result: result as PersistResult };
    }
    return { kind: "claim" as const, result: result as ClaimResult };
  }, { concurrency: input.concurrency, timeoutMs: input.timeoutMs });

  const results = await Promise.all(outcomes.map(async (outcome) => {
    if (outcome.error) {
      const retry = outcome.item.attempt < 3;
      const saved = await finishDurableJobItem(input.writer, input.jobId, input.lockToken, outcome.item,
        retry ? "pending" : "failed", outcome.error, retry ? (outcome.error === "timeout" ? 15 : 30) : undefined);
      return {
        participantId: outcome.item.participantId,
        status: saved ? (retry ? "retrying" as const : "failed" as const) : "stale" as const,
        fetched: false,
        validated: false,
        message: saved ? "The attempt did not finish; the previous snapshot was preserved." : "The item lease expired; a newer worker owns it.",
      };
    }
    if (!outcome.value) return { participantId: outcome.item.participantId, status: "stale" as const, fetched: false, validated: false, message: "The batch result was unavailable; the lease will recover this item." };
    if (outcome.value.kind === "claim") return settleUnclaimed(input.writer, input.jobId, input.lockToken, outcome.item, outcome.value.result);
    const result = recordedResult(outcome.value.result);
    result.participantId = outcome.item.participantId;
    if (outcome.value.result.status === "write_failed") {
      const retry = outcome.item.attempt < 3;
      const saved = await finishDurableJobItem(input.writer, input.jobId, input.lockToken, outcome.item,
        retry ? "pending" : "failed", "persistence_error", retry ? 30 : undefined);
      result.status = saved ? (retry ? "retrying" : "failed") : "stale";
    }
    return result;
  }));
  return { items, results };
}

export { startOrResumeDurableJob };

/**
 * Typed access to the badge-sync fetch-queue RPCs.
 *
 * The queue lives beside a badge sync run and is independent of the legacy
 * auto-progress durable-job tables. Every RPC is security definer with a fixed
 * empty search_path and its own private.is_admin() check; nothing here is
 * trusted as authorization, it only shapes results for the route and the UI.
 */

export type BadgeSyncRpcWriter = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

export type BadgeSyncFetchItemStatus = "pending" | "claimed" | "staged" | "failed" | "skipped";
export type BadgeSyncFinishStatus = "staged" | "failed" | "skipped" | "pending";
export type BadgeSyncFinishResult = BadgeSyncFinishStatus | "stale";

export interface BadgeSyncFetchItem {
  id: string;
  participantId: string;
  participantKey: string;
  displayName: string;
  profileUrl: string | null;
  claimToken: string;
  attemptCount: number;
}

export interface BadgeSyncFetchProgress {
  runId: string;
  runStatus: string;
  total: number;
  processed: number;
  remaining: number;
  pendingCount: number;
  claimedCount: number;
  stagedCount: number;
  failedCount: number;
  skippedCount: number;
  complete: boolean;
  paused: boolean;
  pauseReason: string | null;
}

export class BadgeSyncQueueError extends Error {
  readonly code: string;

  constructor(message: string, code = "") {
    super(message);
    this.name = "BadgeSyncQueueError";
    this.code = code;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function rpcError(error: unknown): BadgeSyncQueueError {
  const record = typeof error === "object" && error !== null ? error as Record<string, unknown> : {};
  const message = typeof record.message === "string" ? record.message : "The badge sync queue RPC failed.";
  const code = typeof record.code === "string" ? record.code : "";
  return new BadgeSyncQueueError(message, code);
}

function firstRow(value: unknown): Record<string, unknown> | null {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "object" && first !== null ? first as Record<string, unknown> : null;
}

function integer(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function isBadgeSyncRunId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** Create a profile-evidence run. The source is never labelled an admin import. */
export async function createBadgeSyncFetchRun(
  writer: BadgeSyncRpcWriter,
  note: string | null = null,
): Promise<string> {
  const { data, error } = await writer.rpc("admin_create_badge_sync_fetch_run", { p_note: note });
  if (error) throw rpcError(error);
  if (!isBadgeSyncRunId(data)) throw new BadgeSyncQueueError("The badge sync run was not created.");
  return data;
}

/** Seeds missing active participants, retires removed ones, then claims a batch. */
export async function claimBadgeSyncFetchBatch(
  writer: BadgeSyncRpcWriter,
  runId: string,
  options: { batchSize?: number; leaseSeconds?: number } = {},
): Promise<BadgeSyncFetchItem[]> {
  const { data, error } = await writer.rpc("admin_claim_badge_sync_fetch_batch", {
    p_run_id: runId,
    p_batch_size: options.batchSize ?? 8,
    p_lease_seconds: options.leaseSeconds ?? 120,
  });
  if (error) throw rpcError(error);
  if (!Array.isArray(data)) return [];
  return data.flatMap((entry) => {
    const row = firstRow(entry);
    if (!row) return [];
    const id = text(row.item_id);
    const participantId = text(row.participant_id);
    const participantKey = text(row.participant_key);
    const displayName = text(row.display_name);
    const claimToken = text(row.item_claim_token);
    if (!id || !participantId || !participantKey || !displayName || !claimToken) return [];
    return [{
      id,
      participantId,
      participantKey,
      displayName,
      profileUrl: text(row.profile_url),
      claimToken,
      attemptCount: integer(row.attempt_count),
    } satisfies BadgeSyncFetchItem];
  });
}

export async function finishBadgeSyncFetchItem(
  writer: BadgeSyncRpcWriter,
  runId: string,
  item: Pick<BadgeSyncFetchItem, "id" | "claimToken">,
  status: BadgeSyncFinishStatus,
  options: { errorCategory?: string | null; retryAfterSeconds?: number | null } = {},
): Promise<BadgeSyncFinishResult> {
  const { data, error } = await writer.rpc("admin_finish_badge_sync_fetch_item", {
    p_run_id: runId,
    p_item_id: item.id,
    p_item_claim_token: item.claimToken,
    p_item_status: status,
    p_error_category: options.errorCategory ?? null,
    p_retry_after_seconds: options.retryAfterSeconds ?? null,
  });
  if (error) throw rpcError(error);
  const row = firstRow(data);
  const result = text(row?.item_status);
  if (result === "staged" || result === "failed" || result === "skipped" || result === "pending" || result === "stale") {
    return result;
  }
  return "stale";
}

export async function setBadgeSyncFetchPause(
  writer: BadgeSyncRpcWriter,
  runId: string,
  paused: boolean,
  reason: string | null = null,
): Promise<{ paused: boolean; pauseReason: string | null }> {
  const { data, error } = await writer.rpc("admin_set_badge_sync_fetch_pause", {
    p_run_id: runId,
    p_paused: paused,
    p_reason: paused ? reason : null,
  });
  if (error) throw rpcError(error);
  const row = firstRow(data);
  return { paused: row?.paused === true, pauseReason: text(row?.pause_reason) };
}

export async function readBadgeSyncFetchProgress(
  writer: BadgeSyncRpcWriter,
  runId: string,
): Promise<BadgeSyncFetchProgress> {
  const { data, error } = await writer.rpc("admin_badge_sync_progress", { p_run_id: runId });
  if (error) throw rpcError(error);
  const row = firstRow(data);
  if (!row || !isBadgeSyncRunId(row.run_id)) {
    throw new BadgeSyncQueueError("The badge sync progress could not be read.");
  }
  return {
    runId: row.run_id,
    runStatus: text(row.run_status) ?? "unknown",
    total: integer(row.total),
    processed: integer(row.processed),
    remaining: integer(row.remaining),
    pendingCount: integer(row.pending_count),
    claimedCount: integer(row.claimed_count),
    stagedCount: integer(row.staged_count),
    failedCount: integer(row.failed_count),
    skippedCount: integer(row.skipped_count),
    complete: row.complete === true,
    paused: row.paused === true,
    pauseReason: text(row.pause_reason),
  };
}

/** Auto-approve every catalog-classified skill/arcade badge before preview. */
export async function bulkApproveStagedBadges(writer: BadgeSyncRpcWriter, runId: string): Promise<number> {
  const { data, error } = await writer.rpc("admin_bulk_set_staged_badge_status", {
    p_run_id: runId,
    p_status: "approved",
  });
  if (error) throw rpcError(error);
  return integer(data);
}

/** Clear a previous preview and realign staged categories with the catalog. */
export async function prepareBadgeSyncStaging(writer: BadgeSyncRpcWriter, runId: string): Promise<boolean> {
  const { data, error } = await writer.rpc("admin_prepare_badge_sync_staging", { p_run_id: runId });
  if (error) throw rpcError(error);
  const row = firstRow(data);
  return row?.prepared === true;
}

export async function previewBadgeSyncRun(writer: BadgeSyncRpcWriter, runId: string): Promise<unknown> {
  const { data, error } = await writer.rpc("admin_preview_badge_sync_run", { p_run_id: runId });
  if (error) throw rpcError(error);
  if (!data) throw new BadgeSyncQueueError("The badge sync preview was empty.");
  return data;
}

export async function readBadgeSyncSnapshot(writer: BadgeSyncRpcWriter, runId: string): Promise<unknown> {
  const { data, error } = await writer.rpc("admin_get_badge_sync_snapshot", { p_run_id: runId });
  if (error || !data) throw rpcError(error);
  return data;
}

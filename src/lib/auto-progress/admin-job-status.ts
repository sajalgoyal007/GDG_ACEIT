export type AdminAutoProgressJobStatus = {
  jobId: string;
  triggerSource: "admin" | "scheduled";
  status: "queued" | "running" | "completed" | "partial";
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  total: number;
  fetched: number;
  validated: number;
  saved: number;
  unchanged: number;
  failed: number;
  skipped: number;
  errorCategory: string | null;
};

function nonNegativeInteger(row: Record<string, unknown>, key: string) {
  return typeof row[key] === "number" && Number.isSafeInteger(row[key]) && (row[key] as number) >= 0;
}

function timestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

/** Strictly parse the admin-only, read-only RPC projection. */
export function parseAdminAutoProgressJob(value: unknown): AdminAutoProgressJobStatus | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const row = value[0];
  if (typeof row !== "object" || row === null || Array.isArray(row)) return null;
  const data = row as Record<string, unknown>;
  if (typeof data.job_id !== "string"
    || !(data.trigger_source === "admin" || data.trigger_source === "scheduled")
    || !(data.job_status === "queued" || data.job_status === "running" || data.job_status === "completed" || data.job_status === "partial")
    || !timestamp(data.created_at)
    || !(data.started_at === null || timestamp(data.started_at))
    || !(data.completed_at === null || timestamp(data.completed_at))
    || !["total_count", "fetched_count", "validated_count", "saved_count", "unchanged_count", "failed_count", "skipped_count"].every((key) => nonNegativeInteger(data, key))
    || !(data.error_category === null || typeof data.error_category === "string" && /^[a-z0-9_]{1,80}$/.test(data.error_category))) return null;
  const total = data.total_count as number;
  const fetched = data.fetched_count as number;
  const validated = data.validated_count as number;
  const saved = data.saved_count as number;
  const unchanged = data.unchanged_count as number;
  const failed = data.failed_count as number;
  const skipped = data.skipped_count as number;
  if (fetched > total || validated > fetched || saved + unchanged + failed + skipped > total) return null;
  return {
    jobId: data.job_id,
    triggerSource: data.trigger_source,
    status: data.job_status,
    createdAt: data.created_at,
    startedAt: data.started_at,
    completedAt: data.completed_at,
    total, fetched, validated, saved, unchanged, failed, skipped,
    errorCategory: data.error_category,
  };
}

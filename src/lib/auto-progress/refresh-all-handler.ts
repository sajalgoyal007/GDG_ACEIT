import type { RefreshAllSummary } from "./refresh-all.ts";

export type RefreshAllAuthorization = "admin" | "signed_out" | "not_admin" | "check_failed" | "unconfigured";

export async function handleRefreshAllRequest(input: {
  origin: string | null;
  requestOrigin: string;
  authorize: () => Promise<RefreshAllAuthorization>;
  enabled: boolean;
  providerAvailable: boolean;
  execute: () => Promise<RefreshAllSummary>;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!input.origin || input.origin !== input.requestOrigin) {
    return { status: 403, body: { status: "invalid_origin", message: "This refresh request was rejected." } };
  }
  const authorization = await input.authorize();
  if (authorization === "signed_out") return { status: 401, body: { status: "signed_out", message: "Sign in as an administrator to refresh progress." } };
  if (authorization === "not_admin") return { status: 403, body: { status: "not_admin", message: "Administrator access is required." } };
  if (authorization !== "admin") return { status: 503, body: { status: authorization, message: "Admin authorization could not be verified." } };
  if (!input.enabled) return { status: 503, body: { status: "disabled", message: "Automatic progress refresh is disabled. No profiles were fetched." } };
  if (!input.providerAvailable) return { status: 503, body: { status: "provider_unavailable", message: "Live profile retrieval is unavailable. No profiles were fetched and saved progress is unchanged." } };
  const summary = await input.execute();
  const { status: jobStatus, ...counts } = summary;
  if (jobStatus === "lock_lost") return { status: 409, body: { status: "job_lock_lost", jobStatus, ...counts } };
  if (jobStatus === "running" || jobStatus === "waiting") return {
    status: 202,
    body: { status: jobStatus, message: jobStatus === "running" ? "The durable refresh job has more participant batches to process." : "The durable job is waiting for a safe retry or lease recovery.", jobStatus, ...counts },
  };
  if (summary.total === 0) return { status: 200, body: { status: "empty_roster", message: "No registered profiles were available to refresh.", jobStatus, ...counts } };
  if (jobStatus === "partial") return {
    status: 207,
    body: { status: "partial", message: "The refresh job finished with failures or skipped profiles.", jobStatus, ...counts },
  };
  if (summary.updated === 0 && (summary.unchanged ?? 0) === 0) return {
    status: 207,
    body: { status: "no_updates", message: "The job finished, but no participant snapshots were saved.", jobStatus, ...counts },
  };
  return { status: 200, body: { status: "completed", message: "All registered profile results were processed.", jobStatus, ...counts } };
}

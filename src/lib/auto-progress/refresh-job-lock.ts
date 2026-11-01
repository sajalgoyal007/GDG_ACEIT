import type { RpcWriter } from "./service.ts";

export type RefreshJobClaim = { status: "claimed"; token: string } | { status: "busy"; retryAfterSeconds: number } | { status: "failed" };

function firstRow(data: unknown): Record<string, unknown> | null {
  return Array.isArray(data) && typeof data[0] === "object" && data[0] !== null ? data[0] as Record<string, unknown> : null;
}

function retryAfter(value: unknown): number {
  if (typeof value !== "string") return 60;
  const time = Date.parse(value);
  return Number.isFinite(time) ? Math.max(1, Math.ceil((time - Date.now()) / 1000)) : 60;
}

export async function claimRefreshJob(writer: RpcWriter): Promise<RefreshJobClaim> {
  const { data, error } = await writer.rpc("claim_participant_auto_refresh_job", { p_lease_seconds: 300 });
  if (error) return { status: "failed" };
  const row = firstRow(data);
  if (row?.job_status === "claimed" && typeof row.lock_token === "string") return { status: "claimed", token: row.lock_token };
  if (row?.job_status === "busy") return { status: "busy", retryAfterSeconds: retryAfter(row.lease_expires_at) };
  return { status: "failed" };
}

export async function renewRefreshJob(writer: RpcWriter, token: string): Promise<boolean> {
  const { data, error } = await writer.rpc("renew_participant_auto_refresh_job", { p_lock_token: token, p_lease_seconds: 300 });
  return !error && firstRow(data)?.job_status === "renewed";
}

export async function releaseRefreshJob(writer: RpcWriter, token: string): Promise<boolean> {
  const { data, error } = await writer.rpc("release_participant_auto_refresh_job", { p_lock_token: token });
  return !error && firstRow(data)?.job_status === "released";
}

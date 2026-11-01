import { createHash } from "node:crypto";
import { isAutoProgressEnabled } from "./config.ts";
import { validateGoogleSkillsProfileUrl } from "./profile-url.ts";
import { googleSkillsAutoProgressProvider, validateAutoProgressProviderResult, type AutoProgressProvider, type AutoProgressProviderResult } from "./provider.ts";
import type { FetchLike } from "./safe-fetch.ts";

export type RpcWriter = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

export type RecordFetchArgs = Record<string, unknown>;
export type RecordFetchRpc = (args: RecordFetchArgs) => PromiseLike<{ data: unknown; error: unknown }>;

export type AutoFetchClaim = {
  participantId: string;
  profileUrl: string;
  profileRevision: number;
  claimToken: string;
  leaseExpiresAt: string;
};

export type ClaimResult =
  | { status: "disabled" }
  | { status: "claimed"; claim: AutoFetchClaim }
  | { status: "cooldown" | "busy"; retryAfterSeconds: number }
  | { status: "duplicate_profile" | "no_profile" | "no_participant" | "claim_failed" };

export type PersistResult =
  | { status: "disabled" }
  | { status: "provider_unavailable" }
  | { status: "cancelled" }
  | { status: "not_recorded"; reason: "invalid_url" | "profile_mismatch" }
  | { status: "recorded"; result: unknown; fetched: boolean; validated: boolean }
  | { status: "write_failed"; fetched: boolean; validated: boolean };

const FAILURE_STATUS_MAP: Record<string, string> = {
  unauthorized: "private",
  not_found: "not_found",
  rate_limited: "rate_limited",
  blocked: "blocked",
  timeout: "timeout",
  unavailable: "upstream_error",
  malformed: "incomplete",
  incomplete: "incomplete",
};

function firstRpcRow(data: unknown): Record<string, unknown> | null {
  if (!Array.isArray(data) || !data.length || typeof data[0] !== "object" || data[0] === null) return null;
  return data[0] as Record<string, unknown>;
}

function secondsUntil(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const retryAt = Date.parse(value);
  return Number.isFinite(retryAt) ? Math.max(1, Math.ceil((retryAt - Date.now()) / 1000)) : null;
}

/** Obtains a database-issued claim before a caller is allowed to fetch a profile. */
export async function claimProfileFetch(writer: RpcWriter, participantId: string, leaseSeconds = 120): Promise<ClaimResult> {
  if (!isAutoProgressEnabled()) return { status: "disabled" };
  const { data, error } = await writer.rpc("claim_participant_auto_fetch", {
    p_participant_id: participantId,
    p_lease_seconds: leaseSeconds,
  });
  if (error) return { status: "claim_failed" };
  const row = firstRpcRow(data);
  if (!row || typeof row.claim_status !== "string") return { status: "claim_failed" };
  if (row.claim_status !== "claimed") {
    if (row.claim_status === "cooldown" || row.claim_status === "busy") {
      const retryAfterSeconds = secondsUntil(row.lease_expires_at);
      return retryAfterSeconds === null ? { status: "claim_failed" } : { status: row.claim_status, retryAfterSeconds };
    }
    if (["duplicate_profile", "no_profile", "no_participant"].includes(row.claim_status)) {
      return { status: row.claim_status as "duplicate_profile" | "no_profile" | "no_participant" };
    }
    return { status: "claim_failed" };
  }
  if (typeof row.claim_token !== "string" || typeof row.profile_url !== "string"
    || typeof row.profile_revision !== "number" || typeof row.lease_expires_at !== "string") {
    return { status: "claim_failed" };
  }
  const validated = validateGoogleSkillsProfileUrl(row.profile_url);
  if (!validated.ok) return { status: "claim_failed" };
  return {
    status: "claimed",
    claim: {
      participantId,
      profileUrl: row.profile_url,
      profileRevision: row.profile_revision,
      claimToken: row.claim_token,
      leaseExpiresAt: row.lease_expires_at,
    },
  };
}

/** Finalizes only with a token returned by the database claim RPC. */
export async function persistClaimedProfileFetch(
  writer: RpcWriter,
  claim: AutoFetchClaim,
  fetched: AutoProgressProviderResult,
  options: { parserVersion?: string; recordFetch?: RecordFetchRpc } = {},
): Promise<PersistResult> {
  if (!isAutoProgressEnabled()) return { status: "disabled" };
  const profile = validateGoogleSkillsProfileUrl(claim.profileUrl);
  if (!profile.ok) return { status: "not_recorded", reason: "invalid_url" };
  const validatedResult = validateAutoProgressProviderResult(fetched, profile.value.normalizedUrl);
  if (validatedResult.status === "profile_mismatch") return { status: "not_recorded", reason: "profile_mismatch" };
  fetched = validatedResult;
  if (fetched.status === "invalid_url") return { status: "not_recorded", reason: "invalid_url" };

  const parserVersion = options.parserVersion ?? "typed-provider-v1";
  let status: string;
  let badges: { key: string }[] | null = null;
  let snapshotId: string | null = null;
  let errorCategory: string | null = null;
  let validated = false;
  let retryAfterSeconds: number | null = null;
  if (fetched.status === "complete") {
    status = "ok";
    validated = true;
    badges = fetched.badges.filter((badge) => badge.eligible).map((badge) => ({ key: badge.id }));
    snapshotId = createHash("sha256").update(badges.map((badge) => badge.key).join("\n")).digest("hex");
  } else {
    const mappedStatus = FAILURE_STATUS_MAP[fetched.status];
    if (!mappedStatus) return { status: "not_recorded", reason: "invalid_url" };
    status = mappedStatus;
    errorCategory = mappedStatus;
    if (fetched.status === "rate_limited" && fetched.retryAfter) {
      const seconds = Number(fetched.retryAfter);
      const dateSeconds = Math.ceil((Date.parse(fetched.retryAfter) - Date.now()) / 1000);
      retryAfterSeconds = Number.isFinite(seconds) ? Math.max(1, Math.min(3600, Math.trunc(seconds)))
        : Number.isFinite(dateSeconds) ? Math.max(1, Math.min(3600, dateSeconds)) : null;
    }
  }

  const args = {
    p_participant_id: claim.participantId,
    p_profile_url: claim.profileUrl,
    p_claim_token: claim.claimToken,
    p_profile_revision: claim.profileRevision,
    p_fetch_status: status,
    p_badges: badges,
    p_snapshot_id: snapshotId,
    p_parser_version: status === "ok" ? parserVersion : null,
    p_error_category: errorCategory,
  };
  const { data, error } = await (options.recordFetch ? options.recordFetch({
    ...args,
    p_fetched: fetched.status === "complete",
    p_validated: validated,
    p_retry_after_seconds: retryAfterSeconds,
  }) : writer.rpc("record_participant_auto_fetch", args));
  if (error) return { status: "write_failed", fetched: fetched.status === "complete", validated };
  return { status: "recorded", result: data, fetched: fetched.status === "complete", validated };
}

/** Single supported live path: claim first, fetch second, finalize last. */
export async function refreshParticipantAutoProgress(
  writer: RpcWriter,
  participantId: string,
  options: { fetchImpl?: FetchLike; leaseSeconds?: number; parserVersion?: string; provider?: AutoProgressProvider; signal?: AbortSignal; recordFetch?: RecordFetchRpc } = {},
): Promise<ClaimResult | PersistResult> {
  if (!isAutoProgressEnabled()) return { status: "disabled" };
  const provider = options.provider ?? googleSkillsAutoProgressProvider;
  if (provider.availability !== "available") return { status: "provider_unavailable" };
  const claimResult = await claimProfileFetch(writer, participantId, options.leaseSeconds);
  if (claimResult.status !== "claimed") return claimResult;
  let fetched: AutoProgressProviderResult;
  try {
    fetched = await provider.fetchProfile(claimResult.claim.profileUrl, options.fetchImpl, options.signal);
  } catch {
    fetched = options.signal?.aborted ? { status: "timeout" } : { status: "unavailable" };
  }
  // A provider may fail to honor AbortSignal. Never let work that outlived its
  // batch deadline persist a late success; record timeout only to release the
  // participant claim while leaving its last successful snapshot untouched.
  if (options.signal?.aborted) fetched = { status: "timeout" };
  return persistClaimedProfileFetch(writer, claimResult.claim, fetched, { parserVersion: options.parserVersion, recordFetch: options.recordFetch });
}

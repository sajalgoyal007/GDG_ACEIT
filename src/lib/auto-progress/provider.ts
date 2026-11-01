import type { FetchLike } from "./safe-fetch.ts";

export type AutoProgressBadge = {
  /** Stable identity supplied by the provider, never inferred from a count. */
  id: string;
  title: string | null;
  category: string | null;
  eligible: boolean;
};

export type CompleteAutoProgressSnapshot = {
  status: "complete";
  normalizedProfileUrl: string;
  retrievedAt: string;
  source: string;
  badges: AutoProgressBadge[];
  pagination: {
    pagesFetched: number;
    hasMore: boolean;
    truncated: boolean;
  };
};

export type AutoProgressProviderError =
  | "invalid_url"
  | "unauthorized"
  | "rate_limited"
  | "unavailable"
  | "timeout"
  | "blocked"
  | "not_found"
  | "malformed"
  | "incomplete";

export type AutoProgressProviderResult = CompleteAutoProgressSnapshot
  | { status: AutoProgressProviderError; retryAfter?: string };

export interface AutoProgressProvider {
  readonly availability: "available" | "unavailable";
  fetchProfile(profileUrl: string, fetchImpl?: FetchLike, signal?: AbortSignal): Promise<AutoProgressProviderResult>;
}

const PROVIDER_ERRORS = new Set<AutoProgressProviderError>([
  "invalid_url", "unauthorized", "rate_limited", "unavailable", "timeout",
  "blocked", "not_found", "malformed", "incomplete",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Runtime validation is intentional: JSON is untrusted even when a provider
 * implementation is typed. Incomplete or ambiguous data must never reach the
 * snapshot RPC.
 */
export function validateAutoProgressProviderResult(
  value: unknown,
  expectedNormalizedProfileUrl: string,
): AutoProgressProviderResult | { status: "profile_mismatch" } {
  if (!isRecord(value) || typeof value.status !== "string") return { status: "malformed" };
  if (value.status !== "complete") {
    if (!PROVIDER_ERRORS.has(value.status as AutoProgressProviderError)) return { status: "malformed" };
    return {
      status: value.status as AutoProgressProviderError,
      ...(typeof value.retryAfter === "string" && value.retryAfter.length <= 120 ? { retryAfter: value.retryAfter } : {}),
    };
  }

  if (value.normalizedProfileUrl !== expectedNormalizedProfileUrl) return { status: "profile_mismatch" };
  if (typeof value.retrievedAt !== "string" || !Number.isFinite(Date.parse(value.retrievedAt))) return { status: "malformed" };
  if (typeof value.source !== "string" || !/^[A-Za-z0-9._:-]{1,120}$/.test(value.source)) return { status: "malformed" };
  if (!Array.isArray(value.badges) || value.badges.length > 10_000) return { status: "malformed" };
  if (!isRecord(value.pagination)
    || !Number.isSafeInteger(value.pagination.pagesFetched)
    || Number(value.pagination.pagesFetched) < 1
    || Number(value.pagination.pagesFetched) > 1_000
    || typeof value.pagination.hasMore !== "boolean"
    || typeof value.pagination.truncated !== "boolean") return { status: "malformed" };
  if (value.pagination.hasMore || value.pagination.truncated) return { status: "incomplete" };

  const seen = new Set<string>();
  const badges: AutoProgressBadge[] = [];
  for (const rawBadge of value.badges) {
    if (!isRecord(rawBadge)
      || typeof rawBadge.id !== "string"
      || !/^[A-Za-z0-9._:-]{1,200}$/.test(rawBadge.id)
      || !(rawBadge.title === null || typeof rawBadge.title === "string" && rawBadge.title.length <= 300)
      || !(rawBadge.category === null || typeof rawBadge.category === "string" && rawBadge.category.length <= 120)
      || typeof rawBadge.eligible !== "boolean"
      || seen.has(rawBadge.id)) return { status: "malformed" };
    seen.add(rawBadge.id);
    badges.push({
      id: rawBadge.id,
      title: rawBadge.title,
      category: rawBadge.category,
      eligible: rawBadge.eligible,
    });
  }

  return {
    status: "complete",
    normalizedProfileUrl: expectedNormalizedProfileUrl,
    retrievedAt: value.retrievedAt,
    source: value.source,
    badges,
    pagination: {
      pagesFetched: Number(value.pagination.pagesFetched),
      hasMore: false,
      truncated: false,
    },
  };
}

/** No authorized source is configured; the default provider never fetches. */
export const googleSkillsAutoProgressProvider: AutoProgressProvider = {
  availability: "unavailable",
  async fetchProfile() {
    return { status: "unavailable" };
  },
};

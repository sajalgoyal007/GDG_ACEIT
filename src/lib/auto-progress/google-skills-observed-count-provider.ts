import { validateGoogleSkillsProfileUrl } from "./profile-url.ts";
import { inspectGoogleSkillsPublicProfile } from "./public-profile-observer.ts";
import type { FetchLike } from "./safe-fetch.ts";

export type GoogleSkillsObservedCountResult =
  | {
    status: "unverified";
    normalizedProfileUrl: string;
    retrievedAt: string;
    httpStatus: number;
    candidateCount: number;
    detailCount: number;
  }
  | {
    status:
      | "invalid_url"
      | "identity_mismatch"
      | "identity_unverified"
      | "empty_unconfirmed"
      | "confirmed_zero"
      | "profile_structure_ambiguous"
      | "profile_response_incomplete"
      | "ambiguous_card_structure"
      | "explicit_hidden_markup"
      | "incomplete_relevant_markup";
  }
  | { status: "disabled" | "unsafe_redirect" | "too_many_redirects" | "provider_unavailable" | "timeout" | "too_large" | "private" | "not_found" | "rate_limited" | "blocked" | "upstream_error"; retryAfter?: string };

export type UnverifiedObservationRpcArgs = {
  p_participant_key: string;
  p_profile_url: string;
  p_source_name: "google_skills_public_html";
  p_retrieved_at: string;
  p_http_status: number;
  p_reported_total: number;
  p_detail_count: number;
  p_unique_badge_count: null;
  p_completeness_status: "unverified";
  p_summary_note: string;
};

export const OWNER_APPROVED_ZERO_VERIFICATION_NOTE =
  "Verified zero under owner-approved profile policy: HTTP 200, exactly matching canonical profile identity, no badge container, and no recognized incomplete, loading, challenge, or access-denied markers.";

export type VerifiedZeroRpcArgs = {
  p_participant_id: string;
  p_badge_count: 0;
  p_note: string;
};

/** Only the parser's exact owner-policy zero outcome can reach the audited RPC. */
export function buildVerifiedZeroRpcArgs(result: GoogleSkillsObservedCountResult, participantId: string): VerifiedZeroRpcArgs | null {
  if (result.status !== "confirmed_zero" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(participantId)) return null;
  return { p_participant_id: participantId, p_badge_count: 0, p_note: OWNER_APPROVED_ZERO_VERIFICATION_NOTE };
}

/** Only a clean, identity-matched candidate result can become an observation RPC payload. */
export function buildUnverifiedObservationRpcArgs(
  result: GoogleSkillsObservedCountResult,
  participantKey: string,
  profileUrl: string,
): UnverifiedObservationRpcArgs | null {
  if (result.status !== "unverified"
    || !Number.isSafeInteger(result.candidateCount) || result.candidateCount < 1
    || !Number.isSafeInteger(result.detailCount) || result.detailCount !== result.candidateCount) return null;
  return {
    p_participant_key: participantKey,
    p_profile_url: profileUrl,
    p_source_name: "google_skills_public_html",
    p_retrieved_at: result.retrievedAt,
    p_http_status: result.httpStatus,
    p_reported_total: result.candidateCount,
    p_detail_count: result.detailCount,
    p_unique_badge_count: null,
    p_completeness_status: "unverified",
    p_summary_note: `Observed ${result.candidateCount} rendered badge-card candidates; this is not a confirmed total and page completeness is unverified.`,
  };
}

/**
 * Count-only adapter over the existing guarded public-profile observer. A
 * positive count is only an identity-matched HTML card-candidate observation;
 * this adapter can never emit a complete automatic-progress snapshot.
 */
export async function fetchGoogleSkillsObservedBadgeCount(
  profileUrl: string,
  options: { fetchImpl?: FetchLike; timeoutMs?: number; maxBytes?: number; signal?: AbortSignal } = {},
): Promise<GoogleSkillsObservedCountResult> {
  const validated = validateGoogleSkillsProfileUrl(profileUrl);
  if (!validated.ok) return { status: "invalid_url" };

  const observed = await inspectGoogleSkillsPublicProfile(profileUrl, options);
  if (observed.status !== "incomplete") return observed;
  if (observed.observation.identityStatus === "mismatch") return { status: "identity_mismatch" };
  if (observed.observation.identityStatus !== "matched") return { status: "identity_unverified" };
  if (observed.observation.reason === "empty_unconfirmed") return { status: "empty_unconfirmed" };
  if (observed.observation.reason === "badge_container_missing") {
    return observed.httpStatus === 200 && observed.observation.qualityWarnings.length === 0
      ? { status: "confirmed_zero" }
      : { status: "profile_response_incomplete" };
  }
  if (observed.observation.reason === "badge_container_ambiguous") return { status: "profile_structure_ambiguous" };
  if (observed.observation.qualityWarnings.includes("incomplete_relevant_markup")) return { status: "incomplete_relevant_markup" };
  if (observed.observation.qualityWarnings.some((warning) => [
    "incomplete_document_markup", "loading_indicator", "challenge_indicator", "access_denied_indicator",
  ].includes(warning))) return { status: "profile_response_incomplete" };
  if (observed.observation.qualityWarnings.includes("ambiguous_card_structure")) return { status: "ambiguous_card_structure" };
  if (observed.observation.qualityWarnings.includes("explicit_hidden_markup")) return { status: "explicit_hidden_markup" };
  if (observed.observation.reason !== "completeness_unverified" || observed.observation.badgeCandidates === 0) {
    return { status: "profile_response_incomplete" };
  }

  return {
    status: "unverified",
    normalizedProfileUrl: validated.value.normalizedUrl,
    retrievedAt: observed.retrievedAt,
    httpStatus: observed.httpStatus,
    candidateCount: observed.observation.badgeCandidates,
    detailCount: observed.observation.entries.length,
  };
}

import type { GoogleSkillsObservedCountResult } from "./google-skills-observed-count-provider.ts";

export type ObservationFailureStatus = Exclude<GoogleSkillsObservedCountResult["status"], "unverified" | "confirmed_zero">;

const failureMessages: Record<ObservationFailureStatus, string> = {
  disabled: "Public profile observation is disabled. No request was made.",
  invalid_url: "The registered profile URL is not an allowed Google Skills public profile.",
  identity_mismatch: "The page canonical identity did not match the registered profile. Nothing was recorded.",
  identity_unverified: "The page did not provide enough identity evidence. Nothing was recorded.",
  empty_unconfirmed: "No badge cards were found; the page cannot establish a complete zero. The count is unknown. Nothing was recorded.",
  profile_structure_ambiguous: "The page contained an ambiguous badge-list structure. Nothing was recorded.",
  profile_response_incomplete: "The page did not provide a usable badge-card result. Nothing was recorded.",
  ambiguous_card_structure: "The page contained duplicate-looking or nested badge-card candidates. Nothing was recorded because their identity is ambiguous.",
  explicit_hidden_markup: "The page contained explicitly hidden badge-card markup. Nothing was recorded.",
  incomplete_relevant_markup: "The badge-list or card markup was incomplete. Nothing was recorded.",
  unsafe_redirect: "The profile redirected outside the allowed identity. Nothing was recorded.",
  too_many_redirects: "The profile exceeded the safe redirect limit. Nothing was recorded.",
  provider_unavailable: "The profile source is unavailable. Nothing was recorded.",
  timeout: "The profile request timed out. Nothing was recorded.",
  too_large: "The profile response exceeded the safe size limit. Nothing was recorded.",
  private: "The profile is private or requires access. Nothing was recorded.",
  not_found: "The profile was not found. Nothing was recorded.",
  rate_limited: "The profile source rate-limited the request. Try again later.",
  blocked: "The profile source blocked the request. Nothing was recorded.",
  upstream_error: "The profile source returned an error. Nothing was recorded.",
};

export function getObservationFailureMessage(status: ObservationFailureStatus): string {
  return failureMessages[status];
}

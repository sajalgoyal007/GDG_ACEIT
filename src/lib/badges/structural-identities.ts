/**
 * Bridge from structural HTML extraction to a staged badge observation.
 *
 * This module is the *only* place where a parsed public profile becomes a
 * staged observation for the one-click sync. It never guesses an identity and
 * never turns missing evidence into zero badges:
 *
 *   - every card resolved and unique      -> complete, badges attached
 *   - zero cards / empty / ambiguous      -> incomplete, badges []
 *   - unresolved card, duplicate identity  -> incomplete, badges []
 *   - identity, challenge, access, HTML    -> failed, badges []
 *   - blocked, loading, error, timeout     -> failed, badges []
 *
 * Incomplete and failed rows deliberately carry no badges, so the database can
 * only preserve the previous counts; it can never overwrite them with zero.
 */

import type {
  StructuralBadgeIncompleteReason,
  StructuralBadgeParseResult,
} from "../auto-progress/parser.ts";
import type { ObservationBadgeInput, ObservationParticipantInput } from "./observations.ts";
import type { ObservationStatus } from "./preview.ts";

/** Parse reasons that mean "the evidence itself is untrustworthy", not "empty". */
const FAILED_PARSE_REASONS: ReadonlySet<StructuralBadgeIncompleteReason> = new Set([
  "unexpected_html",
  "identity_unverified",
  "identity_mismatch",
  "incomplete_relevant_markup",
  "loading_indicator",
  "challenge_indicator",
  "access_denied_indicator",
]);

export type StructuralObservationReason =
  | "complete"
  | "empty_unconfirmed"
  | "badge_container_missing"
  | "badge_container_ambiguous"
  | "structural_identity_unresolved"
  | "duplicate_structural_identity"
  | "identity_unverified"
  | "identity_mismatch"
  | "unexpected_html"
  | "incomplete_relevant_markup"
  | "loading_indicator"
  | "challenge_indicator"
  | "access_denied_indicator";

export interface StructuralObservationDecision {
  participant: ObservationParticipantInput;
  status: ObservationStatus;
  reason: StructuralObservationReason;
  /** Cards whose modal resolved to a valid catalog key. */
  resolvedCount: number;
  /** Cards without a usable catalog key. */
  unresolvedCount: number;
  duplicateBadgeKeys: string[];
}

function reviewNote(
  status: ObservationStatus,
  reason: StructuralObservationReason,
  resolvedCount: number,
  totalCards: number,
): string | null {
  if (status === "complete") return null;
  if (reason === "structural_identity_unresolved") {
    const unresolved = totalCards - resolvedCount;
    return `${unresolved} of ${totalCards} structural badge cards had no catalog identity. Counts were not changed.`;
  }
  if (reason === "duplicate_structural_identity") {
    return "The profile contained a duplicate structural badge identity. Counts were not changed.";
  }
  return `Public-profile evidence was not trustworthy (${reason}). Counts were not changed.`;
}

function observationStatusForParseReason(reason: StructuralBadgeIncompleteReason): ObservationStatus {
  return FAILED_PARSE_REASONS.has(reason) ? "failed" : "incomplete";
}

/**
 * Convert one structural parse into exactly one staging row.
 *
 * Identity is always the modal target (`course_template:<id>` / `game:<id>`).
 * The award-scoped `/badges/<id>` value is carried only as `sourceBadgeId`
 * metadata and can never contribute to a count.
 */
export function structuralSignalsToObservation(
  participantId: string,
  result: StructuralBadgeParseResult,
): StructuralObservationDecision {
  if (result.status !== "ok") {
    const status = observationStatusForParseReason(result.reason);
    const reason = result.reason as StructuralObservationReason;
    return {
      participant: {
        participantId,
        observationStatus: status,
        badges: [],
        reviewNote: reviewNote(status, reason, 0, 0),
      },
      status,
      reason,
      resolvedCount: 0,
      unresolvedCount: 0,
      duplicateBadgeKeys: [],
    };
  }

  const totalCards = result.signals.length;
  const resolved = result.signals.filter(
    (signal) => signal.badgeKey !== null && signal.title !== null && signal.unresolvedReason === null,
  );
  const resolvedCount = resolved.length;

  const incomplete = (
    reason: StructuralObservationReason,
  ): StructuralObservationDecision => ({
    participant: {
      participantId,
      observationStatus: "incomplete",
      badges: [],
      reviewNote: reviewNote("incomplete", reason, resolvedCount, totalCards),
    },
    status: "incomplete",
    reason,
    resolvedCount,
    unresolvedCount: totalCards - resolvedCount,
    duplicateBadgeKeys: result.duplicateBadgeKeys,
  });

  if (resolvedCount !== totalCards) return incomplete("structural_identity_unresolved");
  if (result.duplicateBadgeKeys.length > 0) return incomplete("duplicate_structural_identity");

  const badges: ObservationBadgeInput[] = resolved.map((signal) => ({
    badgeKey: signal.badgeKey as string,
    badgeTitle: signal.title as string,
    sourceBadgeId: signal.awardBadgeId,
    earnedOn: signal.earnedOn,
  }));

  return {
    participant: {
      participantId,
      observationStatus: "complete",
      badges,
      reviewNote: null,
    },
    status: "complete",
    reason: "complete",
    resolvedCount,
    unresolvedCount: 0,
    duplicateBadgeKeys: [],
  };
}

/** Fetch-level failures always preserve NULL counts. */
export type BadgeFetchFailureCategory =
  | "disabled"
  | "invalid_url"
  | "unsafe_redirect"
  | "too_many_redirects"
  | "provider_unavailable"
  | "timeout"
  | "too_large"
  | "private"
  | "not_found"
  | "rate_limited"
  | "blocked"
  | "upstream_error"
  | "no_profile_url"
  | "staging_error";

export function failedFetchObservation(
  participantId: string,
  category: BadgeFetchFailureCategory,
): ObservationParticipantInput {
  return {
    participantId,
    observationStatus: "failed",
    badges: [],
    reviewNote: `Public-profile fetch did not produce trustworthy evidence (${category}). Counts were not changed.`,
  };
}

/** 403 and 429 must stop the whole run rather than burn through the roster. */
export function isHaltStatus(status: string): status is "rate_limited" | "blocked" {
  return status === "rate_limited" || status === "blocked";
}

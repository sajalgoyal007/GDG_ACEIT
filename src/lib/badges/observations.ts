/**
 * Validation and shaping for staged badge observations.
 *
 * The database revalidates everything, but rejecting malformed input in the
 * server action keeps the failure local and gives the admin a precise message.
 * Incomplete or failed observations deliberately carry no badge identities, so
 * their counts can never collapse to zero.
 */

import { isValidBadgeKey } from "./identity.ts";
import type { ObservationStatus } from "./preview.ts";

export interface ObservationBadgeInput {
  badgeKey: string;
  badgeTitle: string;
  sourceBadgeId?: string | null;
  observedAt?: string | null;
  earnedOn?: string | null;
}

export interface ObservationParticipantInput {
  participantId: string;
  observationStatus: ObservationStatus;
  badges?: readonly ObservationBadgeInput[];
  reviewNote?: string | null;
}

export interface StagedObservation {
  participantId: string;
  observationStatus: ObservationStatus;
  badges: {
    badgeKey: string;
    badgeTitle: string;
    sourceBadgeId: string | null;
    observedAt: string | null;
    earnedOn: string | null;
  }[];
  reviewNote: string | null;
}

export type ObservationValidation =
  | { ok: true; value: StagedObservation[] }
  | { ok: false; reason: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRINTABLE = /^[^\u0000-\u001F\u007F]+$/;
const SOURCE_BADGE_ID = /^[1-9][0-9]{0,19}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validateObservationBatch(input: readonly ObservationParticipantInput[]): ObservationValidation {
  if (input.length < 1 || input.length > 500) {
    return { ok: false, reason: "A staging batch must contain 1 to 500 participants." };
  }
  const seenParticipants = new Set<string>();
  const value: StagedObservation[] = [];
  for (const participant of input) {
    const participantId = String(participant.participantId ?? "").trim().toLowerCase();
    if (!UUID.test(participantId)) {
      return { ok: false, reason: "A staged participant id is not a valid UUID." };
    }
    if (seenParticipants.has(participantId)) {
      return { ok: false, reason: "A staging batch cannot contain the same participant twice." };
    }
    seenParticipants.add(participantId);

    const observationStatus = participant.observationStatus;
    if (observationStatus !== "complete" && observationStatus !== "incomplete" && observationStatus !== "failed") {
      return { ok: false, reason: "Observation status must be complete, incomplete, or failed." };
    }
    const badges = participant.badges ?? [];
    if (observationStatus !== "complete" && badges.length > 0) {
      return { ok: false, reason: "Incomplete or failed observations cannot include badge identities." };
    }

    const seenBadges = new Set<string>();
    const stagedBadges: StagedObservation["badges"] = [];
    for (const badge of badges) {
      const badgeKey = String(badge.badgeKey ?? "").trim();
      if (!isValidBadgeKey(badgeKey)) {
        return { ok: false, reason: "Badge identity must be course_template:<id> or game:<id>; /badges/<id> is award-scoped and invalid." };
      }
      if (seenBadges.has(badgeKey)) {
        return { ok: false, reason: `Duplicate badge identity in one participant: ${badgeKey}.` };
      }
      seenBadges.add(badgeKey);

      const badgeTitle = String(badge.badgeTitle ?? "").trim();
      if (badgeTitle.length < 1 || badgeTitle.length > 200 || !PRINTABLE.test(badgeTitle)) {
        return { ok: false, reason: "Badge title must be 1 to 200 printable characters." };
      }

      const sourceBadgeId = badge.sourceBadgeId == null ? null : String(badge.sourceBadgeId).trim();
      if (sourceBadgeId !== null && !SOURCE_BADGE_ID.test(sourceBadgeId)) {
        return { ok: false, reason: "Award-scoped badge id is invalid." };
      }

      const observedAt = normalizeObservedAt(badge.observedAt);
      if (observedAt === false) {
        return { ok: false, reason: "Badge observation timestamp is invalid." };
      }
      const earnedOn = normalizeEarnedOn(badge.earnedOn);
      if (earnedOn === false) {
        return { ok: false, reason: "Badge earned date is invalid." };
      }

      stagedBadges.push({ badgeKey, badgeTitle, sourceBadgeId, observedAt, earnedOn });
    }

    const reviewNote = normalizeNote(participant.reviewNote);
    if (reviewNote === false) {
      return { ok: false, reason: "Review note must be 1 to 1000 printable characters." };
    }

    value.push({
      participantId,
      observationStatus,
      badges: stagedBadges,
      reviewNote,
    });
  }
  return { ok: true, value };
}

function normalizeObservedAt(value: string | null | undefined): string | null | false {
  if (value == null || String(value).trim() === "") return null;
  const text = String(value).trim();
  if (!ISO_INSTANT.test(text) || Number.isNaN(Date.parse(text))) return false;
  return new Date(text).toISOString();
}

function normalizeEarnedOn(value: string | null | undefined): string | null | false {
  if (value == null || String(value).trim() === "") return null;
  const text = String(value).trim();
  if (!ISO_DATE.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) return false;
  return text;
}

function normalizeNote(value: string | null | undefined): string | null | false {
  if (value == null || String(value).trim() === "") return null;
  const text = String(value).trim();
  if (text.length > 1000 || !PRINTABLE.test(text)) return false;
  return text;
}

/** Shape the validated batch for the `admin_stage_badge_sync_observations` RPC. */
export function toStagingPayload(batch: readonly StagedObservation[]) {
  return batch.map((participant) => ({
    participant_id: participant.participantId,
    observation_status: participant.observationStatus,
    review_note: participant.reviewNote,
    badges: participant.badges.map((badge) => ({
      badge_key: badge.badgeKey,
      badge_title: badge.badgeTitle,
      source_badge_id: badge.sourceBadgeId,
      observed_at: badge.observedAt,
      earned_on: badge.earnedOn,
    })),
  }));
}

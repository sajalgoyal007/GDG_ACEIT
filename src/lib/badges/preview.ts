/**
 * Deterministic participant-wise badge sync preview.
 *
 * This is the pure, unit-testable mirror of the SQL preview engine. The
 * database fingerprint remains authoritative; this module generates the same
 * shape from input data so preview behavior can be tested without a database.
 *
 * Invariants:
 *   - skill_count + arcade_count = total_count for every complete row.
 *   - incomplete/failed observations carry NULL counts, never zero.
 *   - removed participants are rejected and never applied.
 *   - unclassified badges block the affected participant.
 *   - a proposed total below the previous verified total is a regression.
 */

import { createHash } from "node:crypto";
import type { BadgeCategory } from "./identity.ts";
import { isValidBadgeKey } from "./identity.ts";

export type ObservationStatus = "complete" | "incomplete" | "failed";
export type StagingStatus = "pending" | "approved" | "rejected" | "ignored" | "unclassified";
export type RegistrationStatus = "registered" | "pending" | "removed";
export type BadgeSyncMode = "classified_counts" | "badge_observations";

export interface PreviewBadgeDecision {
  badgeKey: string;
  category: BadgeCategory;
  status: StagingStatus;
}

export interface PreviewParticipantInput {
  participantId: string;
  participantKey: string;
  displayName: string;
  rowNumber: number;
  registrationStatus: RegistrationStatus;
  observationStatus: ObservationStatus;
  previous: {
    verifiedTotal: number;
    skill: number | null;
    arcade: number | null;
    lastVerifiedAt: string | null;
    verificationSource: string | null;
  };
  counts?: { skill: number; arcade: number; total?: number } | null;
  badges?: readonly PreviewBadgeDecision[];
}

export interface PreviewParticipantResult {
  participantId: string;
  participantKey: string;
  displayName: string;
  rowNumber: number;
  registrationStatus: RegistrationStatus;
  isRemoved: boolean;
  observationStatus: ObservationStatus;
  status: StagingStatus;
  skillCount: number | null;
  arcadeCount: number | null;
  totalCount: number | null;
  previousVerifiedTotal: number;
  previousSkillCount: number | null;
  previousArcadeCount: number | null;
  previousLastVerifiedAt: string | null;
  previousVerificationSource: string | null;
  delta: number | null;
  pendingBadgeCount: number;
  unclassifiedBadgeCount: number;
  isRegression: boolean;
  isStale: boolean;
  blockingReason: string | null;
}

export interface BadgeSyncPreviewInput {
  runId: string;
  mode: BadgeSyncMode;
  participants: readonly PreviewParticipantInput[];
}

export interface BadgeSyncPreviewTotals {
  participants: number;
  skill: number;
  arcade: number;
  total: number;
  unclassifiedParticipants: number;
  pendingParticipants: number;
  blockedParticipants: number;
}

export interface BadgeSyncPreview {
  participants: PreviewParticipantResult[];
  totals: BadgeSyncPreviewTotals;
  fingerprint: string;
}

function assertCount(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 10000) {
    throw new Error(`${label} must be an integer from 0 to 10000.`);
  }
  return value;
}

function evaluateParticipant(
  input: PreviewParticipantInput,
  mode: BadgeSyncMode,
): PreviewParticipantResult {
  const isRemoved = input.registrationStatus === "removed";
  const base = {
    participantId: input.participantId,
    participantKey: input.participantKey,
    displayName: input.displayName,
    rowNumber: input.rowNumber,
    registrationStatus: input.registrationStatus,
    isRemoved,
    previousVerifiedTotal: assertCount(input.previous.verifiedTotal, "previous verified total"),
    previousSkillCount: input.previous.skill,
    previousArcadeCount: input.previous.arcade,
    previousLastVerifiedAt: input.previous.lastVerifiedAt,
    previousVerificationSource: input.previous.verificationSource,
    isStale: false,
  };

  if (isRemoved) {
    return {
      ...base,
      observationStatus: "failed",
      status: "rejected",
      skillCount: null,
      arcadeCount: null,
      totalCount: null,
      delta: null,
      pendingBadgeCount: 0,
      unclassifiedBadgeCount: 0,
      isRegression: false,
      blockingReason: "Participant is removed; no count may be applied.",
    };
  }

  if (mode === "classified_counts") {
    if (input.observationStatus !== "complete" || !input.counts) {
      return {
        ...base,
        observationStatus: input.observationStatus,
        status: "rejected",
        skillCount: null,
        arcadeCount: null,
        totalCount: null,
        delta: null,
        pendingBadgeCount: 0,
        unclassifiedBadgeCount: 0,
        isRegression: false,
        blockingReason: "Observation is not complete; counts are unknown, not zero.",
      };
    }
    const skill = assertCount(input.counts.skill, "skill count");
    const arcade = assertCount(input.counts.arcade, "arcade count");
    const total = skill + arcade;
    if (input.counts.total !== undefined && input.counts.total !== total) {
      throw new Error("skill_count + arcade_count must equal total_count.");
    }
    const isRegression = total < base.previousVerifiedTotal;
    return {
      ...base,
      observationStatus: "complete",
      status: isRegression ? "rejected" : "approved",
      skillCount: skill,
      arcadeCount: arcade,
      totalCount: total,
      delta: total - base.previousVerifiedTotal,
      pendingBadgeCount: 0,
      unclassifiedBadgeCount: 0,
      isRegression,
      blockingReason: isRegression
        ? "Regression: the proposed total is below the previous verified total."
        : null,
    };
  }

  if (input.observationStatus !== "complete") {
    return {
      ...base,
      observationStatus: input.observationStatus,
      status: "rejected",
      skillCount: null,
      arcadeCount: null,
      totalCount: null,
      delta: null,
      pendingBadgeCount: 0,
      unclassifiedBadgeCount: 0,
      isRegression: false,
      blockingReason:
        input.observationStatus === "incomplete"
          ? "Observation is incomplete; counts are unknown, not zero."
          : "Observation failed; counts are unknown, not zero.",
    };
  }

  const badges = input.badges ?? [];
  let skill = 0;
  let arcade = 0;
  let pending = 0;
  let unclassified = 0;
  const seen = new Set<string>();
  for (const badge of badges) {
    if (!isValidBadgeKey(badge.badgeKey)) {
      throw new Error(`Invalid badge identity: ${badge.badgeKey}`);
    }
    if (seen.has(badge.badgeKey)) {
      throw new Error(`Duplicate badge identity in staged participant: ${badge.badgeKey}`);
    }
    seen.add(badge.badgeKey);
    if (badge.status === "pending") pending += 1;
    if (badge.category === "unclassified" || badge.status === "unclassified") unclassified += 1;
    if (badge.status === "approved" && badge.category === "skill") skill += 1;
    if (badge.status === "approved" && badge.category === "arcade") arcade += 1;
  }
  const total = skill + arcade;

  let status: StagingStatus;
  let blockingReason: string | null;
  if (unclassified > 0) {
    status = "unclassified";
    blockingReason = "Unclassified badge identities must be classified in the managed catalog.";
  } else if (pending > 0) {
    status = "pending";
    blockingReason = "Pending badge identities require explicit admin approval.";
  } else if (total < base.previousVerifiedTotal) {
    status = "rejected";
    blockingReason = "Regression: the proposed total is below the previous verified total.";
  } else {
    status = "approved";
    blockingReason = null;
  }

  return {
    ...base,
    observationStatus: "complete",
    status,
    skillCount: skill,
    arcadeCount: arcade,
    totalCount: total,
    delta: total - base.previousVerifiedTotal,
    pendingBadgeCount: pending,
    unclassifiedBadgeCount: unclassified,
    isRegression: total < base.previousVerifiedTotal,
    blockingReason,
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function fingerprintPayload(
  input: BadgeSyncPreviewInput,
  participants: readonly PreviewParticipantResult[],
) {
  const badgeRows = input.participants
    .flatMap((participant) =>
      (participant.badges ?? []).map((badge) => ({
        participant_id: participant.participantId,
        badge_key: badge.badgeKey,
        category: badge.category,
        status: badge.status,
      })),
    )
    .sort((left, right) =>
      left.participant_id === right.participant_id
        ? left.badge_key.localeCompare(right.badge_key)
        : left.participant_id.localeCompare(right.participant_id),
    );

  return {
    run_id: input.runId,
    mode: input.mode,
    participants: [...participants]
      .sort((left, right) => left.participantId.localeCompare(right.participantId))
      .map((row) => ({
        participant_id: row.participantId,
        row_number: row.rowNumber,
        registration_status: row.registrationStatus,
        is_removed: row.isRemoved,
        observation_status: row.observationStatus,
        status: row.status,
        skill: row.skillCount,
        arcade: row.arcadeCount,
        total: row.totalCount,
        previous_total: row.previousVerifiedTotal,
        previous_skill: row.previousSkillCount,
        previous_arcade: row.previousArcadeCount,
        previous_verified_at: row.previousLastVerifiedAt,
        previous_source: row.previousVerificationSource,
        pending: row.pendingBadgeCount,
        unclassified: row.unclassifiedBadgeCount,
        regression: row.isRegression,
        blocking_reason: row.blockingReason,
      })),
    badges: badgeRows,
  };
}

export function fingerprintBadgeSyncPreview(
  input: BadgeSyncPreviewInput,
  participants: readonly PreviewParticipantResult[],
): string {
  return createHash("md5").update(stableStringify(fingerprintPayload(input, participants))).digest("hex");
}

/**
 * A participant is applicable exactly when Apply will write it. This mirrors
 * the SQL eligible filter (approved + complete + not removed + all counts
 * present) so preview totals can never exceed what Apply actually writes.
 */
export function isApplicablePreviewRow(row: PreviewParticipantResult): boolean {
  return (
    row.status === "approved" &&
    row.observationStatus === "complete" &&
    !row.isRemoved &&
    row.skillCount !== null &&
    row.arcadeCount !== null &&
    row.totalCount !== null
  );
}

export function computeBadgeSyncPreview(input: BadgeSyncPreviewInput): BadgeSyncPreview {
  const participants = input.participants
    .map((participant) => evaluateParticipant(participant, input.mode))
    .sort((left, right) => left.participantId.localeCompare(right.participantId));
  const applicable = participants.filter(isApplicablePreviewRow);

  const totals: BadgeSyncPreviewTotals = {
    participants: applicable.length,
    skill: applicable.reduce((sum, row) => sum + (row.skillCount ?? 0), 0),
    arcade: applicable.reduce((sum, row) => sum + (row.arcadeCount ?? 0), 0),
    total: 0,
    unclassifiedParticipants: participants.filter((row) => row.status === "unclassified").length,
    pendingParticipants: participants.filter((row) => row.status === "pending").length,
    blockedParticipants: participants.filter((row) => !isApplicablePreviewRow(row)).length,
  };
  totals.total = totals.skill + totals.arcade;

  return {
    participants,
    totals,
    fingerprint: fingerprintBadgeSyncPreview(input, participants),
  };
}

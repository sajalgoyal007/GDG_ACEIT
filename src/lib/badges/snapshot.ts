/**
 * Serialized shapes returned by the badge sync RPCs.
 *
 * These are transport types only. The database still re-validates every run,
 * fingerprint and lifecycle guard; nothing here is trusted as authorization.
 */

import type { ClassifiedBadgeImportRow, ClassifiedBadgePreviewStatus } from "@/app/admin/classified-badge-import-state";

export interface BadgeSyncSnapshotRun {
  id: string;
  mode: "classified_counts" | "badge_observations";
  status: string;
  source: string;
  source_filename: string | null;
  source_sha256: string | null;
  note: string | null;
  preview_fingerprint: string | null;
  previewed_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  applied_at: string | null;
  apply_request_id: string | null;
  apply_result: BadgeSyncApplyResult | null;
  rolled_back_at: string | null;
  rollback_result: BadgeSyncRollbackResult | null;
  total_participants: number;
  total_skill: number;
  total_arcade: number;
  total_badges: number;
  unclassified_participant_count: number;
  pending_participant_count: number;
  blocked_participant_count: number;
  created_at: string;
}

export interface BadgeSyncSnapshotParticipant {
  id: string;
  participant_id: string;
  participant_key: string;
  display_name: string;
  row_number: number;
  registration_status: "registered" | "pending" | "removed";
  is_removed: boolean;
  observation_status: "complete" | "incomplete" | "failed";
  status: ClassifiedBadgePreviewStatus;
  skill_count: number | null;
  arcade_count: number | null;
  total_count: number | null;
  previous_verified_total: number;
  previous_skill_count: number | null;
  previous_arcade_count: number | null;
  previous_last_verified_at: string | null;
  previous_verification_source: string | null;
  delta: number | null;
  pending_badge_count: number;
  unclassified_badge_count: number;
  is_regression: boolean;
  is_stale: boolean;
  blocking_reason: string | null;
  review_note: string | null;
  /** Post-apply snapshot recorded by the apply RPC; null before apply. */
  applied_total?: number | null;
  applied_skill_count?: number | null;
  applied_arcade_count?: number | null;
  applied_verified_at?: string | null;
  applied_source?: string | null;
  applied_at?: string | null;
}

export interface BadgeSyncSnapshotBadge {
  id: string;
  participant_id: string;
  participant_staging_id: string;
  badge_key: string;
  badge_title: string;
  source_badge_id: string | null;
  category: "skill" | "arcade" | "ignored" | "unclassified";
  status: ClassifiedBadgePreviewStatus;
  observed_at: string | null;
  earned_on: string | null;
}

export interface BadgeSyncSnapshot {
  run: BadgeSyncSnapshotRun;
  participants: BadgeSyncSnapshotParticipant[];
  badges: BadgeSyncSnapshotBadge[];
}

export interface BadgeSyncApplyRow {
  row_number: number;
  participant_id: string;
  previous_total: number;
  new_total: number;
  new_skill_count: number;
  new_arcade_count: number;
  verified_at: string;
}

export interface BadgeSyncBlockedRow {
  participant_id: string;
  row_number: number;
  status: ClassifiedBadgePreviewStatus;
  blocking_reason: string | null;
}

export interface BadgeSyncApplyResult {
  rows: BadgeSyncApplyRow[];
  blocked: BadgeSyncBlockedRow[];
  run_id: string;
  request_id: string;
  status: "applied";
  applied_count: number;
  blocked_count: number;
  applied_at: string;
}

export interface BadgeSyncRollbackRow {
  participant_id: string;
  restored_total: number;
  restored_skill: number | null;
  restored_arcade: number | null;
  restored_at: string | null;
}

export interface BadgeSyncRollbackResult {
  rows: BadgeSyncRollbackRow[];
  run_id: string;
  request_id: string;
  status: "rolled_back";
  restored_count: number;
  rolled_back_at: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseBadgeSyncSnapshot(value: unknown): BadgeSyncSnapshot {
  if (!isRecord(value) || !isRecord(value.run) || typeof value.run.id !== "string") {
    throw new Error("The badge sync snapshot is malformed.");
  }
  return {
    run: value.run as unknown as BadgeSyncSnapshotRun,
    participants: Array.isArray(value.participants)
      ? (value.participants as BadgeSyncSnapshotParticipant[])
      : [],
    badges: Array.isArray(value.badges) ? (value.badges as BadgeSyncSnapshotBadge[]) : [],
  };
}

export function parseBadgeSyncApplyResult(value: unknown): BadgeSyncApplyResult {
  if (!isRecord(value) || !Array.isArray(value.rows)) {
    throw new Error("The badge sync apply result is malformed.");
  }
  return {
    ...(value as unknown as BadgeSyncApplyResult),
    rows: value.rows as BadgeSyncApplyRow[],
    blocked: Array.isArray(value.blocked) ? (value.blocked as BadgeSyncBlockedRow[]) : [],
  };
}

/**
 * Convert the server snapshot back into the row shape the existing classified
 * import table already renders.
 */
export function snapshotToClassifiedRows(
  participants: readonly BadgeSyncSnapshotParticipant[],
): ClassifiedBadgeImportRow[] {
  return participants.map((participant) => ({
    rowNumber: participant.row_number,
    participantId: participant.participant_id,
    // Preserve NULL. A blocked or incomplete row has no counts; rendering it as
    // zero would silently claim the participant has zero badges.
    skillBadgeCount: participant.skill_count,
    arcadeGameBadgeCount: participant.arcade_count,
    totalBadgeCount: participant.total_count,
    reviewNote: participant.review_note ?? "",
    id: participant.participant_id,
    displayName: participant.display_name,
    verifiedBadgeCount: participant.previous_verified_total,
    currentSkillBadgeCount: participant.previous_skill_count,
    currentArcadeGameBadgeCount: participant.previous_arcade_count,
    lastVerifiedAt: participant.previous_last_verified_at,
    verificationSource: participant.previous_verification_source,
    registrationStatus: participant.registration_status,
    previewStatus: participant.status,
    delta: participant.delta,
    pendingBadgeCount: participant.pending_badge_count,
    unclassifiedBadgeCount: participant.unclassified_badge_count,
    isRemoved: participant.is_removed,
    isRegression: participant.is_regression,
    isStale: participant.is_stale,
    blockingReason: participant.blocking_reason,
  }));
}

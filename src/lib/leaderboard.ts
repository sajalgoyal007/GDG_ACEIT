import type { PublicParticipant } from "./types";

export type Milestone = "in_progress" | "five_badge" | "ten_badge";

export function hasMilestone(count: number, threshold: 5 | 10) {
  return count >= threshold;
}

/** Stored zero is not a verified zero until a manual verification timestamp exists. */
export function getReviewedBadgeCount(count: number, lastVerifiedAt: string | null | undefined): number | null {
  return lastVerifiedAt ? count : null;
}

export function formatVerifiedBadgeCount(count: number, lastVerifiedAt: string | null | undefined): string {
  const reviewedCount = getReviewedBadgeCount(count, lastVerifiedAt);
  return reviewedCount === null ? "Not reviewed" : reviewedCount.toLocaleString("en-IN");
}

/**
 * Milestone is computed from skillBadgeCount when available,
 * falling back to verifiedBadgeCount for un-classified participants.
 */
export function getMilestone(count: number): Milestone {
  if (hasMilestone(count, 10)) return "ten_badge";
  if (hasMilestone(count, 5)) return "five_badge";
  return "in_progress";
}

/**
 * Returns the count used for milestone and primary ranking: Skill Badge count
 * when classified data exists, otherwise the total verified count.
 */
export function getPrimaryRankCount(participant: PublicParticipant): number | null {
  if (!participant.lastCheckedAt) return null;
  if (participant.skillBadgeCount !== null && participant.skillBadgeCount !== undefined) {
    return participant.skillBadgeCount;
  }
  // Fall back to total for un-classified participants (preserves backward compat).
  return participant.verifiedBadgeCount;
}

/** Milestone filters only include participants whose counts have been reviewed. */
export function matchesMilestoneFilter(participant: PublicParticipant, threshold: 5 | 10 | null) {
  const primary = getPrimaryRankCount(participant);
  return threshold === null || (primary !== null && hasMilestone(primary, threshold));
}

/**
 * Ranking rules (in priority order):
 * 1. Reviewed participants rank before unreviewed.
 * 2. Among reviewed: sort by skillBadgeCount DESC (nulls last — un-classified reviewed participants
 *    sort after classified ones but still have a rank from their total).
 * 3. Within the same skill count: sort by verifiedBadgeCount DESC (total as tiebreak).
 * 4. Final stable tiebreak: UUID ascending.
 *
 * "Reviewed" is determined by lastCheckedAt — the existing convention is preserved.
 */
export function compareLeaderboardParticipants(a: PublicParticipant, b: PublicParticipant) {
  const aIsUnreviewed = !a.lastCheckedAt;
  const bIsUnreviewed = !b.lastCheckedAt;
  if (aIsUnreviewed !== bIsUnreviewed) return Number(aIsUnreviewed) - Number(bIsUnreviewed);
  if (aIsUnreviewed) return compareStableId(a.id, b.id);

  // Both reviewed: rank by skill badges first (nulls last).
  const aSkill = a.skillBadgeCount ?? null;
  const bSkill = b.skillBadgeCount ?? null;
  if (aSkill !== bSkill) {
    if (aSkill === null) return 1;   // a has no classification → sort after b
    if (bSkill === null) return -1;  // b has no classification → sort after a
    return bSkill - aSkill;
  }
  // Same skill count (or both null): tiebreak on total then UUID.
  return b.verifiedBadgeCount - a.verifiedBadgeCount || compareStableId(a.id, b.id);
}

function compareStableId(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Rank is determined by skillBadgeCount (when available) or verifiedBadgeCount.
 * Two participants share a rank only when their primary sort key is identical.
 */
export function rankParticipants(participants: readonly PublicParticipant[]) {
  const sorted = [...participants].sort(compareLeaderboardParticipants);
  let previousSkill: number | null | undefined;
  let previousTotal: number | undefined;
  let previousRank = 0;
  return sorted.map((participant, index) => {
    if (!participant.lastCheckedAt) return { participant, rank: null };
    const skill = participant.skillBadgeCount ?? null;
    const total = participant.verifiedBadgeCount;
    // Two participants share a rank only if both their skill count AND total match.
    const sameAsPrevious = skill === previousSkill && total === previousTotal;
    const rank = sameAsPrevious ? previousRank : index + 1;
    previousSkill = skill;
    previousTotal = total;
    previousRank = rank;
    return { participant, rank };
  });
}

export function getMilestoneLabel(count: number) {
  const milestone = getMilestone(count);
  if (milestone === "ten_badge") return "10-Badge Milestone";
  if (milestone === "five_badge") return "5-Badge Milestone";
  return "In Progress";
}

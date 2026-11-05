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
 * 2. If participants have an established frozenRank (milestone freeze), that rank is strictly honored.
 * 3. Primary criterion: Skill Badges DESC (nulls last).
 * 4. For participants with >= 10 Skill Badges, earlier milestone completion timestamp ranks ahead if available.
 * 5. Secondary tiebreaker: Arcade Game Badges DESC.
 * 6. Tertiary tiebreaker: Total Badges DESC.
 * 7. Final tiebreaker: Deterministic stable ordering by participant ID ascending.
 *
 * Every reviewed participant receives a strictly unique sequential rank: 1, 2, 3, 4...
 * No participants share a rank.
 */
export function compareLeaderboardParticipants(a: PublicParticipant, b: PublicParticipant): number {
  const aIsUnreviewed = !a.lastCheckedAt;
  const bIsUnreviewed = !b.lastCheckedAt;
  if (aIsUnreviewed !== bIsUnreviewed) return Number(aIsUnreviewed) - Number(bIsUnreviewed);
  if (aIsUnreviewed) return compareStableId(a.id, b.id);

  // 1. If both have established frozen ranks, sort by frozenRank
  const aFrozen = a.frozenRank ?? null;
  const bFrozen = b.frozenRank ?? null;
  if (aFrozen !== null && bFrozen !== null) {
    if (aFrozen !== bFrozen) return aFrozen - bFrozen;
  } else if (aFrozen !== null) {
    // a was frozen earlier
    return -1;
  } else if (bFrozen !== null) {
    // b was frozen earlier
    return 1;
  }

  // 2. Primary criterion: Skill Badges DESC
  const aSkill = a.skillBadgeCount ?? null;
  const bSkill = b.skillBadgeCount ?? null;
  if (aSkill !== bSkill) {
    if (aSkill === null) return 1;
    if (bSkill === null) return -1;
    return bSkill - aSkill;
  }

  // 3. For participants who have reached the 10-skill milestone, earlier milestone timestamp wins
  const aReached10 = aSkill !== null && aSkill >= 10;
  const bReached10 = bSkill !== null && bSkill >= 10;
  if (aReached10 && bReached10) {
    const aTime = a.milestoneCompletedAt ?? null;
    const bTime = b.milestoneCompletedAt ?? null;
    if (aTime && bTime && aTime !== bTime) {
      return aTime < bTime ? -1 : 1;
    }
  }

  // 4. Secondary tiebreaker: Arcade Game Badges DESC
  const aArcade = a.arcadeGameBadgeCount ?? 0;
  const bArcade = b.arcadeGameBadgeCount ?? 0;
  if (aArcade !== bArcade) {
    return bArcade - aArcade;
  }

  // 5. Tertiary tiebreaker: Total Badges DESC
  if (a.verifiedBadgeCount !== b.verifiedBadgeCount) {
    return b.verifiedBadgeCount - a.verifiedBadgeCount;
  }

  // 6. Final tiebreaker: Deterministic stable ordering by ID ascending
  return compareStableId(a.id, b.id);
}

function compareStableId(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Ranks participants with unique sequential ranks (1, 2, 3, 4...).
 * - Never generates duplicate ranks or skips numbers.
 * - Freezes rank when a participant reaches the 10 Skill Badge milestone.
 * - Preserves existing frozen ranks and milestone timestamps.
 * - Dynamic ranking for participants who have not reached 10 Skill Badges.
 */
export function rankParticipants(participants: readonly PublicParticipant[]) {
  const sorted = [...participants].sort(compareLeaderboardParticipants);
  return sorted.map((participant, index) => {
    if (!participant.lastCheckedAt) return { participant, rank: null };
    const sequentialRank = index + 1;
    const rank = participant.frozenRank ?? sequentialRank;
    const isMilestone10 = participant.skillBadgeCount !== null && participant.skillBadgeCount >= 10;
    const frozenRank = participant.frozenRank ?? (isMilestone10 ? rank : null);
    const milestoneCompletedAt = participant.milestoneCompletedAt ?? (isMilestone10 ? (participant.lastCheckedAt ?? null) : null);

    return {
      participant: {
        ...participant,
        frozenRank,
        milestoneCompletedAt,
      },
      rank,
    };
  });
}

export function getMilestoneLabel(count: number) {
  const milestone = getMilestone(count);
  if (milestone === "ten_badge") return "10-Badge Milestone";
  if (milestone === "five_badge") return "5-Badge Milestone";
  return "In Progress";
}

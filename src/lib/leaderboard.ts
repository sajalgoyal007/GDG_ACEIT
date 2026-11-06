import type { PublicParticipant } from "./types";

/** The only threshold that freezes a leaderboard rank. Arcade badges never count. */
export const RANK_FREEZE_SKILL_BADGE_THRESHOLD = 10;

export function qualifiesForRankFreeze(skillBadgeCount: number | null | undefined): boolean {
  return typeof skillBadgeCount === "number" && skillBadgeCount >= RANK_FREEZE_SKILL_BADGE_THRESHOLD;
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
 * Rank-freeze filter uses Skill Badges only. Total badges are deliberately
 * ignored so Arcade badges can never qualify a participant.
 */
export function matchesRankFreezeFilter(participant: PublicParticipant, threshold: 10 | null) {
  if (threshold === null) return true;
  return Boolean(participant.lastCheckedAt) && qualifiesForRankFreeze(participant.skillBadgeCount);
}

/**
 * Ranking rules (in priority order):
 * 1. Reviewed participants rank before unreviewed participants.
 * 2. A persisted frozenRank (captured once at 10+ Skill Badges) is strictly honored.
 * 3. Primary criterion for unfrozen participants: Skill Badges DESC (nulls last).
 * 4. Secondary tiebreaker: Arcade Game Badges DESC.
 * 5. Tertiary tiebreaker: Total Badges DESC.
 * 6. Final tiebreaker: Deterministic stable ordering by participant ID ascending.
 *
 * Every reviewed participant receives a strictly unique sequential rank.
 * Frozen ranks are never derived or recalculated here; they come only from the
 * persisted database column.
 */
export function compareLeaderboardParticipants(a: PublicParticipant, b: PublicParticipant): number {
  const aIsUnreviewed = !a.lastCheckedAt;
  const bIsUnreviewed = !b.lastCheckedAt;
  if (aIsUnreviewed !== bIsUnreviewed) return Number(aIsUnreviewed) - Number(bIsUnreviewed);
  if (aIsUnreviewed) return compareStableId(a.id, b.id);

  // Persisted frozen ranks take priority and are never recomputed.
  const aFrozen = a.frozenRank ?? null;
  const bFrozen = b.frozenRank ?? null;
  if (aFrozen !== null && bFrozen !== null) {
    if (aFrozen !== bFrozen) return aFrozen - bFrozen;
  } else if (aFrozen !== null) {
    return -1;
  } else if (bFrozen !== null) {
    return 1;
  }

  // Primary criterion: Skill Badges DESC (nulls last).
  const aSkill = a.skillBadgeCount ?? null;
  const bSkill = b.skillBadgeCount ?? null;
  if (aSkill !== bSkill) {
    if (aSkill === null) return 1;
    if (bSkill === null) return -1;
    return bSkill - aSkill;
  }

  // Secondary tiebreaker: Arcade Game Badges DESC.
  const aArcade = a.arcadeGameBadgeCount ?? 0;
  const bArcade = b.arcadeGameBadgeCount ?? 0;
  if (aArcade !== bArcade) {
    return bArcade - aArcade;
  }

  // Tertiary tiebreaker: Total Badges DESC.
  if (a.verifiedBadgeCount !== b.verifiedBadgeCount) {
    return b.verifiedBadgeCount - a.verifiedBadgeCount;
  }

  // Final tiebreaker: Deterministic stable ordering by ID ascending.
  return compareStableId(a.id, b.id);
}

function compareStableId(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Ranks participants with unique sequential ranks (1, 2, 3, 4...).
 * - Persisted frozen ranks are read verbatim and are never regenerated.
 * - Unfrozen reviewed participants receive the next distinct ranks after the
 *   highest persisted frozen rank, in deterministic leaderboard order.
 * - Unreviewed participants remain unranked.
 */
export function rankParticipants(participants: readonly PublicParticipant[]) {
  const sorted = [...participants].sort(compareLeaderboardParticipants);
  const highestFrozenRank = participants.reduce(
    (highest, participant) => participant.frozenRank != null && participant.frozenRank > highest
      ? participant.frozenRank
      : highest,
    0,
  );
  let nextDynamicRank = highestFrozenRank + 1;

  return sorted.map((participant) => {
    if (!participant.lastCheckedAt) return { participant, rank: null };
    if (participant.frozenRank != null) return { participant, rank: participant.frozenRank };
    const rank = nextDynamicRank;
    nextDynamicRank += 1;
    return { participant, rank };
  });
}

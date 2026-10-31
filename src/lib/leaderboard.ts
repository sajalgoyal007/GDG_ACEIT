import type { PublicParticipant } from "./types";

export type Milestone = "in_progress" | "five_badge" | "ten_badge";

export function hasMilestone(count: number, threshold: 5 | 10) {
  return count >= threshold;
}

export function getMilestone(count: number): Milestone {
  if (hasMilestone(count, 10)) return "ten_badge";
  if (hasMilestone(count, 5)) return "five_badge";
  return "in_progress";
}

/** Milestone filters only include participants whose counts have been reviewed. */
export function matchesMilestoneFilter(participant: PublicParticipant, threshold: 5 | 10 | null) {
  return threshold === null || Boolean(participant.lastCheckedAt && hasMilestone(participant.verifiedBadgeCount, threshold));
}

/** Verified counts rank first; unreviewed registrations remain visible but unranked. */
export function compareLeaderboardParticipants(a: PublicParticipant, b: PublicParticipant) {
  const aIsUnreviewed = !a.lastCheckedAt;
  const bIsUnreviewed = !b.lastCheckedAt;
  if (aIsUnreviewed !== bIsUnreviewed) return Number(aIsUnreviewed) - Number(bIsUnreviewed);
  if (aIsUnreviewed) return compareStableId(a.id, b.id);
  return b.verifiedBadgeCount - a.verifiedBadgeCount || compareStableId(a.id, b.id);
}

function compareStableId(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function rankParticipants(participants: readonly PublicParticipant[]) {
  const sorted = [...participants].sort(compareLeaderboardParticipants);
  let previousCount: number | undefined;
  let previousRank = 0;
  return sorted.map((participant, index) => {
    if (!participant.lastCheckedAt) return { participant, rank: null };
    const rank = participant.verifiedBadgeCount === previousCount ? previousRank : index + 1;
    previousCount = participant.verifiedBadgeCount;
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

import assert from "node:assert/strict";
import test from "node:test";
import { formatVerifiedBadgeCount, getMilestone, getMilestoneLabel, getReviewedBadgeCount, hasMilestone, matchesMilestoneFilter, rankParticipants } from "./leaderboard.ts";
import { parseVerifiedBadgeCount } from "./admin-validation.ts";

for (const [count, milestone, label] of [
  [0, "in_progress", "In Progress"],
  [4, "in_progress", "In Progress"],
  [5, "five_badge", "5-Badge Milestone"],
  [9, "five_badge", "5-Badge Milestone"],
  [10, "ten_badge", "10-Badge Milestone"],
  [13, "ten_badge", "10-Badge Milestone"],
] as const) {
  test(`${count} verified badges maps to ${label}`, () => {
    assert.equal(getMilestone(count), milestone);
    assert.equal(getMilestoneLabel(count), label);
  });
}

test("ranking assigns unique sequential ranks and breaks ties with Arcade, Total, and stable ID", () => {
  const records = [
    { id: "c", displayName: "Zulu", verifiedBadgeCount: 10, skillBadgeCount: 10, arcadeGameBadgeCount: 0, lastCheckedAt: "2026-10-30T10:00:00Z" },
    { id: "b", displayName: "Beta", verifiedBadgeCount: 10, skillBadgeCount: 10, arcadeGameBadgeCount: 0, lastCheckedAt: "2026-10-30T10:00:00Z" },
    { id: "a", displayName: "Alpha", verifiedBadgeCount: 5, skillBadgeCount: 5, arcadeGameBadgeCount: 0, lastCheckedAt: "2026-10-30T10:00:00Z" },
    { id: "d", displayName: "Delta", verifiedBadgeCount: 5, skillBadgeCount: 5, arcadeGameBadgeCount: 0, lastCheckedAt: "2026-10-30T10:00:00Z" },
  ].map((record) => ({ ...record, initials: "X", color: "blue" }));
  assert.deepEqual(rankParticipants(records).map(({ participant, rank }) => [participant.id, rank]), [
    ["b", 1], ["c", 2], ["a", 3], ["d", 4],
  ]);
});

test("specification example: unique ranking with skill primary, arcade secondary tiebreaker, stable ID final", () => {
  // Example from specification:
  // Participant A: Skill 12, Arcade 2 -> Rank 1
  // Participant B: Skill 12, Arcade 1 -> Rank 2
  // Participant C: Skill 10, Arcade 3 -> Rank 3
  // Participant D: Skill 10, Arcade 3 -> Rank 4
  const records = [
    { id: "part-d", displayName: "Participant D", verifiedBadgeCount: 13, skillBadgeCount: 10, arcadeGameBadgeCount: 3, lastCheckedAt: "2026-10-30T10:00:00Z" },
    { id: "part-b", displayName: "Participant B", verifiedBadgeCount: 13, skillBadgeCount: 12, arcadeGameBadgeCount: 1, lastCheckedAt: "2026-10-30T10:00:00Z" },
    { id: "part-a", displayName: "Participant A", verifiedBadgeCount: 14, skillBadgeCount: 12, arcadeGameBadgeCount: 2, lastCheckedAt: "2026-10-30T10:00:00Z" },
    { id: "part-c", displayName: "Participant C", verifiedBadgeCount: 13, skillBadgeCount: 10, arcadeGameBadgeCount: 3, lastCheckedAt: "2026-10-30T10:00:00Z" },
  ].map((record) => ({ ...record, initials: "P", color: "blue" }));

  assert.deepEqual(rankParticipants(records).map(({ participant, rank }) => [participant.id, rank]), [
    ["part-a", 1],
    ["part-b", 2],
    ["part-c", 3],
    ["part-d", 4],
  ]);
});

test("rank freeze at 10 Skill Badges preserves original rank despite subsequent badge updates", () => {
  // Participant Alpha reached 10 skill badges earlier and was ranked #1
  const alphaFrozen = {
    id: "alpha",
    displayName: "Alpha Learner",
    verifiedBadgeCount: 10,
    skillBadgeCount: 10,
    arcadeGameBadgeCount: 0,
    frozenRank: 1,
    milestoneCompletedAt: "2026-10-25T10:00:00Z",
    lastCheckedAt: "2026-10-25T10:00:00Z",
    initials: "AL",
    color: "blue",
  };

  // Participant Beta later earns 15 skill badges
  const betaLater = {
    id: "beta",
    displayName: "Beta Learner",
    verifiedBadgeCount: 15,
    skillBadgeCount: 15,
    arcadeGameBadgeCount: 0,
    lastCheckedAt: "2026-11-01T10:00:00Z",
    initials: "BL",
    color: "green",
  };

  // Alpha's frozen rank of 1 is preserved; Beta cannot take Alpha's rank 1
  const ranked = rankParticipants([betaLater, alphaFrozen]);
  assert.equal(ranked.find((r) => r.participant.id === "alpha")?.rank, 1);
  assert.equal(ranked.find((r) => r.participant.id === "beta")?.rank, 2);

  // Even if Alpha earns additional badges (10 -> 14), Alpha's frozen rank remains 1
  const alphaUpdated = { ...alphaFrozen, skillBadgeCount: 14, verifiedBadgeCount: 14 };
  const rankedAfterUpdate = rankParticipants([betaLater, alphaUpdated]);
  assert.equal(rankedAfterUpdate.find((r) => r.participant.id === "alpha")?.rank, 1);
  assert.equal(rankedAfterUpdate.find((r) => r.participant.id === "beta")?.rank, 2);
});

test("participants below 10 Skill Badges remain dynamically ranked", () => {
  const p1 = { id: "p1", displayName: "Learner 1", verifiedBadgeCount: 4, skillBadgeCount: 4, arcadeGameBadgeCount: 0, lastCheckedAt: "2026-10-30T10:00:00Z", initials: "L1", color: "blue" };
  const p2 = { id: "p2", displayName: "Learner 2", verifiedBadgeCount: 7, skillBadgeCount: 7, arcadeGameBadgeCount: 0, lastCheckedAt: "2026-10-30T10:00:00Z", initials: "L2", color: "blue" };

  // Initial: p2 (7 skill) is rank 1, p1 (4 skill) is rank 2
  let ranked = rankParticipants([p1, p2]);
  assert.deepEqual(ranked.map((r) => [r.participant.id, r.rank]), [["p2", 1], ["p1", 2]]);

  // When p1 earns more badges (4 -> 9 skill), p1 dynamically overtakes p2
  const p1Updated = { ...p1, skillBadgeCount: 9, verifiedBadgeCount: 9 };
  ranked = rankParticipants([p1Updated, p2]);
  assert.deepEqual(ranked.map((r) => [r.participant.id, r.rank]), [["p1", 1], ["p2", 2]]);
});

test("ranking prioritizes skill badge count over total badge count", () => {
  const records = [
    // Alice has 8 skill, 2 arcade = 10 total
    { id: "alice", displayName: "Alice", verifiedBadgeCount: 10, skillBadgeCount: 8, arcadeGameBadgeCount: 2, lastCheckedAt: "2026-10-30T10:00:00Z" },
    // Bob has 6 skill, 6 arcade = 12 total (higher total, but lower skill!)
    { id: "bob", displayName: "Bob", verifiedBadgeCount: 12, skillBadgeCount: 6, arcadeGameBadgeCount: 6, lastCheckedAt: "2026-10-30T10:00:00Z" },
    // Charlie has 8 skill, 4 arcade = 12 total (same skill as Alice, but higher total tiebreak!)
    { id: "charlie", displayName: "Charlie", verifiedBadgeCount: 12, skillBadgeCount: 8, arcadeGameBadgeCount: 4, lastCheckedAt: "2026-10-30T10:00:00Z" },
  ].map((record) => ({ ...record, initials: "X", color: "blue" }));

  // Charlie should be rank 1 (skill 8, total 12), Alice rank 2 (skill 8, total 10), Bob rank 3 (skill 6, total 12)
  assert.deepEqual(rankParticipants(records).map(({ participant, rank }) => [participant.id, rank]), [
    ["charlie", 1],
    ["alice", 2],
    ["bob", 3],
  ]);
});

test("unreviewed zero-count registrations remain visible but unranked after verified records", () => {
  const records = [
    { id: "unreviewed-b", displayName: "Awaiting review B", verifiedBadgeCount: 100, skillBadgeCount: null, arcadeGameBadgeCount: null },
    { id: "unreviewed-a", displayName: "Awaiting review A", verifiedBadgeCount: 0, skillBadgeCount: null, arcadeGameBadgeCount: null },
    { id: "verified", displayName: "Verified zero", verifiedBadgeCount: 0, skillBadgeCount: 0, arcadeGameBadgeCount: 0, lastCheckedAt: "2026-10-30T10:00:00Z" },
  ].map((record) => ({ ...record, initials: "X", color: "blue" }));

  assert.deepEqual(rankParticipants(records).map(({ participant, rank }) => [participant.id, rank]), [
    ["verified", 1],
    ["unreviewed-a", null],
    ["unreviewed-b", null],
  ]);
});

test("stored zero and nonzero counts remain unknown until verification is recorded", () => {
  assert.equal(getReviewedBadgeCount(0, null), null);
  assert.equal(formatVerifiedBadgeCount(0, null), "Not reviewed");
  assert.equal(getReviewedBadgeCount(0, "2026-10-30T10:00:00Z"), 0);
  assert.equal(formatVerifiedBadgeCount(0, "2026-10-30T10:00:00Z"), "0");
  assert.equal(getReviewedBadgeCount(12, undefined), null);
});

test("unreviewed stored counts cannot match badge milestone filters", () => {
  const unreviewed = { id: "unreviewed", displayName: "Awaiting review", verifiedBadgeCount: 100, skillBadgeCount: 100, arcadeGameBadgeCount: 0, initials: "AR", color: "blue" };
  const reviewed = { ...unreviewed, id: "reviewed", lastCheckedAt: "2026-10-30T10:00:00Z" };

  assert.equal(matchesMilestoneFilter(unreviewed, null), true);
  assert.equal(matchesMilestoneFilter(unreviewed, 5), false);
  assert.equal(matchesMilestoneFilter(unreviewed, 10), false);
  assert.equal(matchesMilestoneFilter(reviewed, 5), true);
  assert.equal(matchesMilestoneFilter(reviewed, 10), true);
});

test("classified milestone filter uses skill badge count, not arcade or total", () => {
  // Participant with 4 skill and 6 arcade = 10 total. Does NOT meet 5-skill milestone!
  const participantWithArcade = {
    id: "p1",
    displayName: "Player 1",
    verifiedBadgeCount: 10,
    skillBadgeCount: 4,
    arcadeGameBadgeCount: 6,
    initials: "P1",
    color: "blue",
    lastCheckedAt: "2026-10-30T10:00:00Z",
  };
  assert.equal(matchesMilestoneFilter(participantWithArcade, 5), false);
  assert.equal(matchesMilestoneFilter(participantWithArcade, 10), false);

  // Participant with 5 skill and 0 arcade = 5 total. Meets 5-skill milestone!
  const participantWithSkill = {
    ...participantWithArcade,
    id: "p2",
    verifiedBadgeCount: 5,
    skillBadgeCount: 5,
    arcadeGameBadgeCount: 0,
  };
  assert.equal(matchesMilestoneFilter(participantWithSkill, 5), true);
  assert.equal(matchesMilestoneFilter(participantWithSkill, 10), false);
});

test("the 10-badge milestone also qualifies for the 5-badge threshold", () => {
  assert.equal(hasMilestone(10, 5), true);
  assert.equal(hasMilestone(10, 10), true);
  assert.equal(hasMilestone(9, 10), false);
});

test("server badge-count validation rejects missing, fractional, negative, and out-of-range counts", () => {
  assert.equal(parseVerifiedBadgeCount("0"), 0);
  assert.equal(parseVerifiedBadgeCount("10000"), 10000);
  for (const value of [null, 5, "", "-1", "1.5", "10001", "1e2", " 5"]) {
    assert.equal(parseVerifiedBadgeCount(value), null);
  }
});

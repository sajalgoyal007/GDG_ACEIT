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

test("ranking uses UUID order for ties and competition rank numbering", () => {
  const records = [
    { id: "c", displayName: "Zulu", verifiedBadgeCount: 10, skillBadgeCount: 10, arcadeGameBadgeCount: 0, lastCheckedAt: "2026-10-30T10:00:00Z" },
    { id: "b", displayName: "Beta", verifiedBadgeCount: 10, skillBadgeCount: 10, arcadeGameBadgeCount: 0, lastCheckedAt: "2026-10-30T10:00:00Z" },
    { id: "a", displayName: "Alpha", verifiedBadgeCount: 5, skillBadgeCount: 5, arcadeGameBadgeCount: 0, lastCheckedAt: "2026-10-30T10:00:00Z" },
    { id: "d", displayName: "Delta", verifiedBadgeCount: 5, skillBadgeCount: 5, arcadeGameBadgeCount: 0, lastCheckedAt: "2026-10-30T10:00:00Z" },
  ].map((record) => ({ ...record, initials: "X", color: "blue" }));
  assert.deepEqual(rankParticipants(records).map(({ participant, rank }) => [participant.id, rank]), [
    ["b", 1], ["c", 1], ["a", 3], ["d", 3],
  ]);
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

import assert from "node:assert/strict";
import test from "node:test";
import { getMilestone, getMilestoneLabel, hasMilestone, rankParticipants } from "./leaderboard.ts";
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
    { id: "c", displayName: "Zulu", verifiedBadgeCount: 10 },
    { id: "b", displayName: "Beta", verifiedBadgeCount: 10 },
    { id: "a", displayName: "Alpha", verifiedBadgeCount: 5 },
    { id: "d", displayName: "Delta", verifiedBadgeCount: 5 },
  ].map((record) => ({ ...record, initials: "X", color: "blue" }));
  assert.deepEqual(rankParticipants(records).map(({ participant, rank }) => [participant.id, rank]), [
    ["b", 1], ["c", 1], ["a", 3], ["d", 3],
  ]);
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

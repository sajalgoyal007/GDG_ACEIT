import assert from "node:assert/strict";
import test from "node:test";
import type { PublicParticipant } from "./types.ts";
import {
  RANK_FREEZE_SKILL_BADGE_THRESHOLD,
  formatVerifiedBadgeCount,
  getReviewedBadgeCount,
  matchesRankFreezeFilter,
  qualifiesForRankFreeze,
  rankParticipants,
} from "./leaderboard.ts";
import * as leaderboard from "./leaderboard.ts";
import { parseVerifiedBadgeCount } from "./admin-validation.ts";

const CHECKED_AT = "2026-10-30T10:00:00Z";

function makeParticipant(
  overrides: Partial<PublicParticipant> & Pick<PublicParticipant, "id">,
): PublicParticipant {
  return {
    displayName: overrides.displayName ?? overrides.id,
    initials: "XX",
    color: "blue",
    verifiedBadgeCount: overrides.verifiedBadgeCount ?? 0,
    skillBadgeCount: overrides.skillBadgeCount === undefined ? 0 : overrides.skillBadgeCount,
    arcadeGameBadgeCount: overrides.arcadeGameBadgeCount === undefined ? 0 : overrides.arcadeGameBadgeCount,
    lastCheckedAt: CHECKED_AT,
    ...overrides,
  };
}

// Scenario 1: nine Skill Badges do not freeze a rank.
test("9 Skill Badges stay dynamically ranked and are not frozen", () => {
  const participant = makeParticipant({
    id: "nine-skill",
    skillBadgeCount: 9,
    verifiedBadgeCount: 9,
  });

  assert.equal(qualifiesForRankFreeze(participant.skillBadgeCount), false);
  const ranked = rankParticipants([participant]);
  assert.equal(ranked[0]?.rank, 1);
  assert.equal(ranked[0]?.participant.frozenRank ?? null, null);
});

// Scenario 2: exactly 10 Skill Badges is the threshold.
test("exactly 10 Skill Badges qualifies for rank freeze", () => {
  assert.equal(RANK_FREEZE_SKILL_BADGE_THRESHOLD, 10);
  assert.equal(qualifiesForRankFreeze(9), false);
  assert.equal(qualifiesForRankFreeze(10), true);
  assert.equal(qualifiesForRankFreeze(11), true);
  assert.equal(qualifiesForRankFreeze(null), false);
  assert.equal(qualifiesForRankFreeze(undefined), false);
});

// Scenario 3: Arcade badges never count toward the 10-Skill-Badge threshold.
test("Arcade Game Badges never qualify a participant for rank freeze", () => {
  const arcadeHeavy = makeParticipant({
    id: "arcade-heavy",
    skillBadgeCount: 9,
    arcadeGameBadgeCount: 9,
    verifiedBadgeCount: 18,
  });

  assert.equal(qualifiesForRankFreeze(arcadeHeavy.skillBadgeCount), false);
  assert.equal(matchesRankFreezeFilter(arcadeHeavy, 10), false);
  assert.equal(rankParticipants([arcadeHeavy])[0]?.participant.frozenRank ?? null, null);
});

// Scenario 4: total badges alone never qualify.
test("total badge count alone never satisfies the rank-freeze threshold", () => {
  const totalOnly = makeParticipant({
    id: "total-only",
    skillBadgeCount: 0,
    arcadeGameBadgeCount: 12,
    verifiedBadgeCount: 12,
  });

  assert.equal(matchesRankFreezeFilter(totalOnly, 10), false);
  assert.equal(rankParticipants([totalOnly])[0]?.rank, 1);
});

// Scenario 5: a persisted frozen rank is authoritative, even against a higher current skill count.
test("persisted frozen rank is honored over a higher current skill count", () => {
  const frozen = makeParticipant({
    id: "alpha",
    skillBadgeCount: 10,
    verifiedBadgeCount: 10,
    frozenRank: 1,
    rankFrozenAt: "2026-10-25T10:00:00Z",
  });
  const laterHigher = makeParticipant({
    id: "beta",
    skillBadgeCount: 30,
    verifiedBadgeCount: 30,
  });

  const ranked = rankParticipants([laterHigher, frozen]);
  assert.deepEqual(ranked.map(({ participant, rank }) => [participant.id, rank]), [
    ["alpha", 1],
    ["beta", 2],
  ]);
});

// Scenario 6: later badge gains do not change an existing frozen rank.
test("frozen rank survives later badge gains", () => {
  const initial = makeParticipant({
    id: "grower",
    skillBadgeCount: 10,
    verifiedBadgeCount: 10,
    frozenRank: 2,
    rankFrozenAt: "2026-10-25T10:00:00Z",
  });
  const afterGrowth = { ...initial, skillBadgeCount: 40, verifiedBadgeCount: 40 };

  assert.equal(rankParticipants([initial])[0]?.rank, 2);
  assert.equal(rankParticipants([afterGrowth])[0]?.rank, 2);
  assert.equal(rankParticipants([afterGrowth])[0]?.participant.frozenRank, 2);
  assert.equal(rankParticipants([afterGrowth])[0]?.participant.rankFrozenAt, "2026-10-25T10:00:00Z");
});

// Scenario 7: other participants' gains cannot displace a frozen rank.
test("frozen rank is unaffected by another participant's later badge gains", () => {
  const frozen = makeParticipant({
    id: "frozen",
    skillBadgeCount: 10,
    verifiedBadgeCount: 10,
    frozenRank: 1,
    rankFrozenAt: "2026-10-25T10:00:00Z",
  });
  const other = makeParticipant({
    id: "other",
    skillBadgeCount: 15,
    verifiedBadgeCount: 15,
  });
  const otherAfterGain = { ...other, skillBadgeCount: 99, verifiedBadgeCount: 99 };

  assert.equal(rankParticipants([frozen, otherAfterGain])[0]?.rank, 1);
  assert.equal(rankParticipants([frozen, otherAfterGain]).find(({ participant }) => participant.id === "frozen")?.rank, 1);
  assert.equal(rankParticipants([frozen, otherAfterGain]).find(({ participant }) => participant.id === "other")?.rank, 2);
});

// Scenario 8: repeated reads/render passes never rewrite the persisted rank.
test("ranking never derives or overwrites a frozen rank in memory", () => {
  const participant = makeParticipant({
    id: "not-yet-frozen",
    skillBadgeCount: 10,
    verifiedBadgeCount: 10,
  });

  const first = rankParticipants([participant]);
  const second = rankParticipants(first.map(({ participant: current }) => current));

  assert.equal(first[0]?.rank, 1);
  assert.equal(first[0]?.participant.frozenRank ?? null, null);
  assert.equal(second[0]?.rank, 1);
  assert.equal(second[0]?.participant.frozenRank ?? null, null);
});

// Scenario 9: simultaneous crossings use distinct, deterministic sequential ranks.
test("simultaneous threshold crossings keep deterministic distinct sequential ranks", () => {
  // The database allocates these in one deterministic pass:
  // higher Skill first, then Arcade, then Total, then stable UUID.
  const first = makeParticipant({
    id: "cross-b",
    skillBadgeCount: 12,
    verifiedBadgeCount: 12,
    frozenRank: 1,
    rankFrozenAt: "2026-11-05T10:00:00Z",
  });
  const second = makeParticipant({
    id: "cross-a",
    skillBadgeCount: 10,
    verifiedBadgeCount: 10,
    frozenRank: 2,
    rankFrozenAt: "2026-11-05T10:00:00Z",
  });

  const ranked = rankParticipants([second, first]);
  assert.deepEqual(ranked.map(({ participant, rank }) => [participant.id, rank]), [
    ["cross-b", 1],
    ["cross-a", 2],
  ]);
  assert.equal(new Set(ranked.map(({ rank }) => rank)).size, ranked.length);
});

// Scenario 10: tie order is deterministic and every rank is unique.
test("ranking assigns unique sequential ranks and breaks ties with Arcade, Total, and stable ID", () => {
  const records = [
    makeParticipant({ id: "c", skillBadgeCount: 10, verifiedBadgeCount: 10 }),
    makeParticipant({ id: "b", skillBadgeCount: 10, verifiedBadgeCount: 10 }),
    makeParticipant({ id: "a", skillBadgeCount: 5, verifiedBadgeCount: 5 }),
    makeParticipant({ id: "d", skillBadgeCount: 5, verifiedBadgeCount: 5 }),
  ];
  const ranked = rankParticipants(records);
  assert.deepEqual(ranked.map(({ participant, rank }) => [participant.id, rank]), [
    ["b", 1], ["c", 2], ["a", 3], ["d", 4],
  ]);
  assert.equal(new Set(ranked.map(({ rank }) => rank)).size, ranked.length);
});

test("specification example: skill primary, arcade secondary tiebreaker, stable ID final", () => {
  const records = [
    makeParticipant({ id: "part-d", skillBadgeCount: 10, arcadeGameBadgeCount: 3, verifiedBadgeCount: 13 }),
    makeParticipant({ id: "part-b", skillBadgeCount: 12, arcadeGameBadgeCount: 1, verifiedBadgeCount: 13 }),
    makeParticipant({ id: "part-a", skillBadgeCount: 12, arcadeGameBadgeCount: 2, verifiedBadgeCount: 14 }),
    makeParticipant({ id: "part-c", skillBadgeCount: 10, arcadeGameBadgeCount: 3, verifiedBadgeCount: 13 }),
  ];

  assert.deepEqual(rankParticipants(records).map(({ participant, rank }) => [participant.id, rank]), [
    ["part-a", 1],
    ["part-b", 2],
    ["part-c", 3],
    ["part-d", 4],
  ]);
});

test("dynamic ranks start after the highest frozen rank and never reuse a retired position", () => {
  // A soft-removed participant can leave a permanent gap (for example rank 3).
  const records = [
    makeParticipant({ id: "frozen-1", skillBadgeCount: 10, verifiedBadgeCount: 10, frozenRank: 1, rankFrozenAt: CHECKED_AT }),
    makeParticipant({ id: "frozen-2", skillBadgeCount: 10, verifiedBadgeCount: 10, frozenRank: 2, rankFrozenAt: CHECKED_AT }),
    makeParticipant({ id: "frozen-11", skillBadgeCount: 10, verifiedBadgeCount: 10, frozenRank: 11, rankFrozenAt: CHECKED_AT }),
    makeParticipant({ id: "dynamic-9", skillBadgeCount: 9, verifiedBadgeCount: 9 }),
  ];

  const ranked = rankParticipants(records);
  assert.deepEqual(ranked.map(({ participant, rank }) => [participant.id, rank]), [
    ["frozen-1", 1],
    ["frozen-2", 2],
    ["frozen-11", 11],
    ["dynamic-9", 12],
  ]);
  assert.equal(new Set(ranked.map(({ rank }) => rank)).size, ranked.length);
});

test("frozen ranks and dynamic ranks never collide", () => {
  const records = [
    makeParticipant({ id: "frozen-2", skillBadgeCount: 10, verifiedBadgeCount: 10, frozenRank: 2, rankFrozenAt: CHECKED_AT }),
    makeParticipant({ id: "frozen-1", skillBadgeCount: 10, verifiedBadgeCount: 10, frozenRank: 1, rankFrozenAt: CHECKED_AT }),
    makeParticipant({ id: "dynamic-9", skillBadgeCount: 9, verifiedBadgeCount: 9 }),
    makeParticipant({ id: "dynamic-8", skillBadgeCount: 8, verifiedBadgeCount: 8 }),
  ];

  const ranked = rankParticipants(records);
  assert.deepEqual(ranked.map(({ participant, rank }) => [participant.id, rank]), [
    ["frozen-1", 1],
    ["frozen-2", 2],
    ["dynamic-9", 3],
    ["dynamic-8", 4],
  ]);
  assert.equal(new Set(ranked.map(({ rank }) => rank)).size, ranked.length);
});

// Scenario 11: all 5-badge ranking/milestone/filter helpers are gone.
test("removed 5-badge milestone and filter helpers are no longer exported", () => {
  assert.equal("hasMilestone" in leaderboard, false);
  assert.equal("getMilestone" in leaderboard, false);
  assert.equal("getMilestoneLabel" in leaderboard, false);
  assert.equal("matchesMilestoneFilter" in leaderboard, false);
  assert.equal("Milestone" in leaderboard, false);

  const fiveSkill = makeParticipant({ id: "five-skill", skillBadgeCount: 5, verifiedBadgeCount: 5 });
  const tenSkill = makeParticipant({ id: "ten-skill", skillBadgeCount: 10, verifiedBadgeCount: 10 });
  assert.equal(matchesRankFreezeFilter(fiveSkill, null), true);
  assert.equal(matchesRankFreezeFilter(fiveSkill, 10), false);
  assert.equal(matchesRankFreezeFilter(tenSkill, 10), true);
});

test("ranking prioritizes skill badge count over total badge count", () => {
  const records = [
    makeParticipant({ id: "alice", skillBadgeCount: 8, arcadeGameBadgeCount: 2, verifiedBadgeCount: 10 }),
    makeParticipant({ id: "bob", skillBadgeCount: 6, arcadeGameBadgeCount: 6, verifiedBadgeCount: 12 }),
    makeParticipant({ id: "charlie", skillBadgeCount: 8, arcadeGameBadgeCount: 4, verifiedBadgeCount: 12 }),
  ];

  assert.deepEqual(rankParticipants(records).map(({ participant, rank }) => [participant.id, rank]), [
    ["charlie", 1],
    ["alice", 2],
    ["bob", 3],
  ]);
});

test("unreviewed zero-count registrations remain visible but unranked after verified records", () => {
  const records = [
    makeParticipant({ id: "unreviewed-b", skillBadgeCount: null, arcadeGameBadgeCount: null, verifiedBadgeCount: 100, lastCheckedAt: undefined }),
    makeParticipant({ id: "unreviewed-a", skillBadgeCount: null, arcadeGameBadgeCount: null, verifiedBadgeCount: 0, lastCheckedAt: undefined }),
    makeParticipant({ id: "verified", skillBadgeCount: 0, arcadeGameBadgeCount: 0, verifiedBadgeCount: 0 }),
  ];

  assert.deepEqual(rankParticipants(records).map(({ participant, rank }) => [participant.id, rank]), [
    ["verified", 1],
    ["unreviewed-a", null],
    ["unreviewed-b", null],
  ]);
});

test("unreviewed participants cannot match the rank-freeze filter", () => {
  const unreviewed = makeParticipant({
    id: "unreviewed",
    skillBadgeCount: 100,
    verifiedBadgeCount: 100,
    lastCheckedAt: undefined,
  });

  assert.equal(matchesRankFreezeFilter(unreviewed, null), true);
  assert.equal(matchesRankFreezeFilter(unreviewed, 10), false);
});

test("stored zero and nonzero counts remain unknown until verification is recorded", () => {
  assert.equal(getReviewedBadgeCount(0, null), null);
  assert.equal(formatVerifiedBadgeCount(0, null), "Not reviewed");
  assert.equal(getReviewedBadgeCount(0, "2026-10-30T10:00:00Z"), 0);
  assert.equal(formatVerifiedBadgeCount(0, "2026-10-30T10:00:00Z"), "0");
  assert.equal(getReviewedBadgeCount(12, undefined), null);
});

test("server badge-count validation rejects missing, fractional, negative, and out-of-range counts", () => {
  assert.equal(parseVerifiedBadgeCount("0"), 0);
  assert.equal(parseVerifiedBadgeCount("10000"), 10000);
  for (const value of [null, 5, "", "-1", "1.5", "10001", "1e2", " 5"]) {
    assert.equal(parseVerifiedBadgeCount(value), null);
  }
});

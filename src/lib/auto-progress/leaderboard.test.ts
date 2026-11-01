import assert from "node:assert/strict";
import test from "node:test";
import { sortAutoProgressRows, toAutoProgressRow } from "./leaderboard.ts";

const base = {
  participantId: "p1",
  displayName: "Learner",
  fetchStatus: "ok" as const,
  eligibleBadgeCount: 7,
  lastSuccessfulCheckAt: "2026-10-31T11:55:00Z",
  lastProgressChangeAt: "2026-10-31T11:00:00Z",
  tenBadgeFirstObservedAt: null,
  tenBadgeFinishRank: null,
};

test("shows successful zero distinctly from unavailable data", () => {
  const zero = toAutoProgressRow({ ...base, eligibleBadgeCount: 0 }, Date.parse("2026-10-31T12:00:00Z"));
  const unavailable = toAutoProgressRow({ ...base, fetchStatus: "timeout", eligibleBadgeCount: null, lastSuccessfulCheckAt: null }, Date.parse("2026-10-31T12:00:00Z"));
  assert.equal(zero.progressLabel, "0 / 10");
  assert.equal(zero.displayState, "current");
  assert.equal(unavailable.progressLabel, "Unavailable / 10");
  assert.equal(unavailable.displayState, "unavailable");
});

test("retains a last-known count with stale labeling after a failed or old fetch", () => {
  const failed = toAutoProgressRow({ ...base, fetchStatus: "timeout" }, Date.parse("2026-10-31T12:00:00Z"));
  const old = toAutoProgressRow({ ...base, lastSuccessfulCheckAt: "2026-10-30T12:00:00Z" }, Date.parse("2026-10-31T12:00:00Z"));
  assert.equal(failed.eligibleBadgeCount, 7);
  assert.equal(failed.displayState, "stale");
  assert.equal(old.displayState, "stale");
});

test("labels milestone as first observed and sorts by count, change time, then stable ID", () => {
  const milestone = toAutoProgressRow({ ...base, eligibleBadgeCount: 10, tenBadgeFirstObservedAt: "2026-10-31T11:00:00Z" }, Date.parse("2026-10-31T12:00:00Z"));
  assert.equal(milestone.milestoneLabel, "10 badges first observed 2026-10-31T11:00:00Z");
  const sorted = sortAutoProgressRows([
    { participantId: "b", eligibleBadgeCount: 3, lastProgressChangeAt: "2026-10-31T10:00:00Z" },
    { participantId: "c", eligibleBadgeCount: 3, lastProgressChangeAt: "2026-10-31T11:00:00Z" },
    { participantId: "a", eligibleBadgeCount: 3, lastProgressChangeAt: "2026-10-31T11:00:00Z" },
    { participantId: "z", eligibleBadgeCount: null, lastProgressChangeAt: null },
  ]);
  assert.deepEqual(sorted.map((row) => row.participantId), ["a", "c", "b", "z"]);
});

test("hides an observed count while the profile is duplicated", () => {
  const duplicate = toAutoProgressRow({ ...base, fetchStatus: "duplicate_profile" }, Date.parse("2026-10-31T12:00:00Z"));
  assert.equal(duplicate.eligibleBadgeCount, null);
  assert.equal(duplicate.displayState, "unavailable");
});

test("a profile identity invalidation is unavailable while its locked rank remains visible", () => {
  const invalidated = toAutoProgressRow({
    ...base,
    fetchStatus: "unavailable",
    eligibleBadgeCount: null,
    lastSuccessfulCheckAt: null,
    lastProgressChangeAt: null,
    tenBadgeFirstObservedAt: "2026-10-31T11:00:00Z",
    tenBadgeFinishRank: 1,
  }, Date.parse("2026-10-31T12:00:00Z"));
  assert.equal(invalidated.displayState, "unavailable");
  assert.equal(invalidated.progressLabel, "Unavailable / 10");
  assert.equal(invalidated.eligibleBadgeCount, null);
  assert.equal(invalidated.tenBadgeFinishRank, 1);
});

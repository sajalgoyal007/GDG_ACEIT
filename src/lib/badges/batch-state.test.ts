import assert from "node:assert/strict";
import test from "node:test";
import type { BadgeSyncFetchProgress } from "./fetch-queue.ts";
import type { BadgeSyncSnapshot } from "./snapshot.ts";
import {
  badgeSyncProgressPercent,
  badgeSyncUnclassifiedBadges,
  badgeSyncViewReducer,
  initialBadgeSyncViewState,
  shouldContinueBadgeSyncLoop,
  type BadgeSyncBatchResponse,
} from "./batch-state.ts";

const runId = "00000000-0000-4000-8000-000000000301";

function progress(overrides: Partial<BadgeSyncFetchProgress> = {}): BadgeSyncFetchProgress {
  return {
    runId,
    runStatus: "staged",
    total: 10,
    processed: 4,
    remaining: 6,
    pendingCount: 6,
    claimedCount: 0,
    stagedCount: 4,
    failedCount: 0,
    skippedCount: 0,
    complete: false,
    paused: false,
    pauseReason: null,
    ...overrides,
  };
}

function snapshot(status: string): BadgeSyncSnapshot {
  return {
    run: {
      id: runId,
      status,
      total_participants: 2,
      total_skill: 4,
      total_arcade: 1,
      unclassified_participant_count: 0,
      blocked_participant_count: 0,
    },
    participants: [],
    badges: [],
  } as unknown as BadgeSyncSnapshot;
}

test("start clears previous state and enters starting", () => {
  const state = badgeSyncViewReducer(
    { ...initialBadgeSyncViewState, phase: "previewed", message: "old", batches: 3 },
    { type: "start" },
  );
  assert.equal(state.phase, "starting");
  assert.equal(state.batches, 0);
  assert.equal(state.message, "Creating a profile-evidence run…");
});

test("a running response updates progress and keeps the loop alive", () => {
  const state = badgeSyncViewReducer(initialBadgeSyncViewState, {
    type: "response",
    response: { status: "running", message: "Working", runId, progress: progress() },
  });
  assert.equal(state.phase, "running");
  assert.equal(state.runId, runId);
  assert.equal(state.progress?.processed, 4);
  assert.equal(state.batches, 1);
  assert.equal(shouldContinueBadgeSyncLoop(state), true);
  assert.equal(shouldContinueBadgeSyncLoop(state, 1), false);
});

test("paused, previewed, disabled, and error responses stop the loop", () => {
  const cases: { response: BadgeSyncBatchResponse; phase: string }[] = [
    { response: { status: "paused", message: "Paused", runId, progress: progress({ paused: true }), halted: "rate_limited" }, phase: "paused" },
    { response: { status: "previewed", message: "Ready", runId, snapshot: snapshot("previewed") }, phase: "previewed" },
    { response: { status: "disabled", message: "Off" }, phase: "disabled" },
    { response: { status: "error", message: "Bad" }, phase: "error" },
    { response: { status: "temporarily_unavailable", message: "Later" }, phase: "error" },
  ];
  for (const entry of cases) {
    const state = badgeSyncViewReducer(initialBadgeSyncViewState, { type: "response", response: entry.response });
    assert.equal(state.phase, entry.phase);
    assert.equal(shouldContinueBadgeSyncLoop(state), false);
  }
});

test("the pause reason and halted category survive into the view", () => {
  const state = badgeSyncViewReducer(initialBadgeSyncViewState, {
    type: "response",
    response: {
      status: "paused",
      message: "Paused",
      runId,
      progress: progress({ paused: true, pauseReason: "HTTP 429" }),
      halted: "rate_limited",
    },
  });
  assert.equal(state.halted, "rate_limited");
  assert.equal(state.progress?.pauseReason, "HTTP 429");
});

test("apply and rollback snapshots map to their run status", () => {
  const applied = badgeSyncViewReducer(initialBadgeSyncViewState, {
    type: "snapshot",
    snapshot: snapshot("applied"),
    message: "Applied",
  });
  assert.equal(applied.phase, "applied");
  assert.equal(applied.snapshot?.run.status, "applied");

  const rolledBack = badgeSyncViewReducer(applied, {
    type: "snapshot",
    snapshot: snapshot("rolled_back"),
  });
  assert.equal(rolledBack.phase, "rolled_back");
});

test("progress percentage is bounded and NULL-safe", () => {
  assert.equal(badgeSyncProgressPercent(null), 0);
  assert.equal(badgeSyncProgressPercent(progress({ total: 0, processed: 0 })), 0);
  assert.equal(badgeSyncProgressPercent(progress({ total: 10, processed: 5 })), 50);
  assert.equal(badgeSyncProgressPercent(progress({ total: 10, processed: 99 })), 100);
});

test("unclassified panel groups identities across participants", () => {
  const base = {
    id: "badge",
    participant_id: "participant",
    participant_staging_id: "staging",
    badge_title: "Mystery",
    source_badge_id: null,
    status: "unclassified",
    observed_at: null,
    earned_on: null,
  };
  const value = {
    ...snapshot("previewed"),
    badges: [
      { ...base, badge_key: "course_template:623", participant_id: "a", category: "unclassified" },
      { ...base, badge_key: "course_template:623", participant_id: "b", category: "unclassified", badge_title: "Mystery 2" },
      { ...base, badge_key: "game:1", participant_id: "a", category: "skill" },
    ],
  } as BadgeSyncSnapshot;
  assert.deepEqual(badgeSyncUnclassifiedBadges(value), [
    { badgeKey: "course_template:623", badgeTitle: "Mystery", participants: 2 },
  ]);
  assert.deepEqual(badgeSyncUnclassifiedBadges(null), []);
});

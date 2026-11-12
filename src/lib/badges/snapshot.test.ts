import assert from "node:assert/strict";
import test from "node:test";
import {
  parseBadgeSyncApplyResult,
  parseBadgeSyncSnapshot,
  snapshotToClassifiedRows,
} from "./snapshot.ts";

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    run: {
      id: "11111111-1111-4111-8111-111111111111",
      mode: "classified_counts",
      status: "previewed",
      source: "admin_import",
      source_filename: "classified.csv",
      source_sha256: null,
      note: null,
      preview_fingerprint: "0123456789abcdef0123456789abcdef",
      previewed_at: null,
      approved_at: null,
      approved_by: null,
      applied_at: null,
      apply_request_id: null,
      apply_result: null,
      rolled_back_at: null,
      rollback_result: null,
      total_participants: 1,
      total_skill: 2,
      total_arcade: 1,
      total_badges: 3,
      unclassified_participant_count: 0,
      pending_participant_count: 0,
      blocked_participant_count: 0,
      created_at: "2026-11-09T00:00:00.000000Z",
    },
    participants: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        participant_id: "33333333-3333-4333-8333-333333333333",
        participant_key: "participant-one",
        display_name: "Participant One",
        row_number: 2,
        registration_status: "registered",
        is_removed: false,
        observation_status: "complete",
        status: "approved",
        skill_count: 2,
        arcade_count: 1,
        total_count: 3,
        previous_verified_total: 0,
        previous_skill_count: null,
        previous_arcade_count: null,
        previous_last_verified_at: null,
        previous_verification_source: null,
        delta: 3,
        pending_badge_count: 0,
        unclassified_badge_count: 0,
        is_regression: false,
        is_stale: false,
        blocking_reason: null,
        review_note: "reviewed",
      },
    ],
    badges: [],
    ...overrides,
  };
}

test("a snapshot is parsed and mapped into the classified row shape", () => {
  const parsed = parseBadgeSyncSnapshot(snapshot());
  assert.equal(parsed.run.id, "11111111-1111-4111-8111-111111111111");
  const rows = snapshotToClassifiedRows(parsed.participants);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.skillBadgeCount, 2);
  assert.equal(rows[0]!.arcadeGameBadgeCount, 1);
  assert.equal(rows[0]!.totalBadgeCount, 3);
  assert.equal(rows[0]!.previewStatus, "approved");
  assert.equal(rows[0]!.delta, 3);
  assert.equal(rows[0]!.blockingReason, null);
});

test("blocked snapshot rows keep null counts instead of becoming zero", () => {
  const parsed = parseBadgeSyncSnapshot(
    snapshot({
      participants: [
        {
          ...(snapshot().participants as Record<string, unknown>[])[0],
          status: "unclassified",
          skill_count: null,
          arcade_count: null,
          total_count: null,
          blocking_reason: "Unclassified badge identities must be classified.",
        },
      ],
    }),
  );
  const rows = snapshotToClassifiedRows(parsed.participants);
  assert.equal(rows[0]!.skillBadgeCount, null);
  assert.equal(rows[0]!.arcadeGameBadgeCount, null);
  assert.equal(rows[0]!.totalBadgeCount, null);
  assert.equal(rows[0]!.previewStatus, "unclassified");
});

test("malformed snapshots are rejected", () => {
  assert.throws(() => parseBadgeSyncSnapshot(null));
  assert.throws(() => parseBadgeSyncSnapshot({}));
  assert.throws(() => parseBadgeSyncSnapshot({ run: { id: 1 } }));
});

test("a snapshot without optional collections still parses", () => {
  const parsed = parseBadgeSyncSnapshot(snapshot({ participants: undefined, badges: undefined }));
  assert.deepEqual(parsed.participants, []);
  assert.deepEqual(parsed.badges, []);
});

test("apply results parse and default a missing blocked array", () => {
  const result = parseBadgeSyncApplyResult({
    rows: [
      {
        row_number: 2,
        participant_id: "33333333-3333-4333-8333-333333333333",
        previous_total: 0,
        new_total: 3,
        new_skill_count: 2,
        new_arcade_count: 1,
        verified_at: "2026-11-09T00:00:00.000000Z",
      },
    ],
    run_id: "11111111-1111-4111-8111-111111111111",
    request_id: "44444444-4444-4444-8444-444444444444",
    status: "applied",
    applied_count: 1,
    blocked_count: 0,
    applied_at: "2026-11-09T00:00:00.000000Z",
  });
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.blocked, []);
  assert.equal(result.applied_count, 1);
});

test("apply results keep blocked rows when present", () => {
  const result = parseBadgeSyncApplyResult({
    rows: [],
    blocked: [
      {
        participant_id: "33333333-3333-4333-8333-333333333333",
        row_number: 2,
        status: "unclassified",
        blocking_reason: "Unclassified badge identities must be classified.",
      },
    ],
    status: "applied",
    applied_count: 0,
    blocked_count: 1,
  });
  assert.equal(result.blocked.length, 1);
  assert.equal(result.blocked[0]!.status, "unclassified");
});

test("malformed apply results are rejected", () => {
  assert.throws(() => parseBadgeSyncApplyResult(null));
  assert.throws(() => parseBadgeSyncApplyResult({ rows: null }));
});

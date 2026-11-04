import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAdminParticipantRows,
  type RawAdminParticipantRow,
  type RawAuditEventRow,
} from "./admin-data-helper.ts";

const mockParticipants: RawAdminParticipantRow[] = [
  {
    id: "p1",
    participant_key: "key-1",
    display_name: "Participant One",
    profile_url: "https://www.skills.google/public_profiles/1",
    registration_status: "registered",
    verified_badge_count: 5,
    last_verified_at: "2026-11-01T10:00:00Z",
    verification_source: "admin_manual",
    created_at: "2026-10-31T00:00:00Z",
    updated_at: "2026-11-01T10:00:00Z",
  },
  {
    id: "p2",
    participant_key: "key-2",
    display_name: "Participant Two",
    profile_url: null,
    registration_status: "pending",
    verified_badge_count: 0,
    last_verified_at: null,
    verification_source: null,
    created_at: "2026-10-31T00:00:00Z",
    updated_at: "2026-10-31T00:00:00Z",
  },
];

const mockAuditEvents: RawAuditEventRow[] = [
  {
    id: "audit-1",
    participant_id: "p1",
    event_type: "badge_count_updated",
    source: "admin_manual",
    previous_badge_count: 0,
    new_badge_count: 5,
    note: "Reviewed manually",
    actor_user_id: "admin-uuid",
    created_at: "2026-11-01T10:00:00Z",
    verified_at: "2026-11-01T10:00:00Z",
  },
];

test("buildAdminParticipantRows matches audit events to participants by participant_id", () => {
  const rows = buildAdminParticipantRows(mockParticipants, mockAuditEvents);
  assert.equal(rows.length, 2);

  const p1 = rows.find((r) => r.id === "p1");
  assert.ok(p1);
  assert.equal(p1.audit.length, 1);
  assert.equal(p1.audit[0].id, "audit-1");
  assert.equal(p1.audit[0].newBadgeCount, 5);

  const p2 = rows.find((r) => r.id === "p2");
  assert.ok(p2);
  assert.equal(p2.audit.length, 0);
});

test("buildAdminParticipantRows safely handles null or empty audit events without failing", () => {
  const rowsWithNull = buildAdminParticipantRows(mockParticipants, null);
  assert.equal(rowsWithNull.length, 2);
  assert.deepEqual(rowsWithNull[0].audit, []);
  assert.deepEqual(rowsWithNull[1].audit, []);

  const rowsWithEmpty = buildAdminParticipantRows(mockParticipants, []);
  assert.equal(rowsWithEmpty.length, 2);
  assert.deepEqual(rowsWithEmpty[0].audit, []);
  assert.deepEqual(rowsWithEmpty[1].audit, []);
});

test("buildAdminParticipantRows preserves all participant fields", () => {
  const rows = buildAdminParticipantRows(mockParticipants, mockAuditEvents);
  assert.equal(rows[0].participant_key, "key-1");
  assert.equal(rows[0].display_name, "Participant One");
  assert.equal(rows[0].profile_url, "https://www.skills.google/public_profiles/1");
  assert.equal(rows[0].registration_status, "registered");
  assert.equal(rows[0].verified_badge_count, 5);
  assert.equal(rows[0].last_verified_at, "2026-11-01T10:00:00Z");
});

test("buildAdminParticipantRows handles empty participant list", () => {
  const rows = buildAdminParticipantRows([], mockAuditEvents);
  assert.deepEqual(rows, []);
});

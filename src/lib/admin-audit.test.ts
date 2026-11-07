import assert from "node:assert/strict";
import test from "node:test";
import { filterAuditActivities, paginateAuditActivities, type AuditActivity } from "./admin-audit.ts";

const activities: AuditActivity[] = [
  { eventType: "badge_count_updated", participantName: "Yogesh Kumawat", actionLabel: "Badge count verified", sourceLabel: "Manual admin update", note: "11 Skill Badge(s)", actorUserId: "admin-1" },
  { eventType: "participant_imported", participantName: "New Learner", actionLabel: "Participant registered", sourceLabel: "CSV import", note: null, actorUserId: "admin-2" },
  { eventType: "badge_count_updated", participantName: "Ishan Suthar", actionLabel: "Badge count verified", sourceLabel: "Manual admin update", note: "10 Skill Badge(s)", actorUserId: "admin-1" },
  { eventType: "participant_removed", participantName: "Removed Learner", actionLabel: "Participant removed", sourceLabel: "Manual admin update", note: "duplicate", actorUserId: "admin-3" },
];

test("audit history filters by action while keeping newest-first order", () => {
  const filtered = filterAuditActivities(activities, { query: "", filter: "badge_count_updated" });
  assert.deepEqual(filtered.map((event) => event.participantName), ["Yogesh Kumawat", "Ishan Suthar"]);
});

test("audit search matches participant, action, source, note, and actor", () => {
  assert.equal(filterAuditActivities(activities, { query: "ishan", filter: "all" }).length, 1);
  assert.equal(filterAuditActivities(activities, { query: "registered", filter: "all" }).length, 1);
  assert.equal(filterAuditActivities(activities, { query: "csv import", filter: "all" }).length, 1);
  assert.equal(filterAuditActivities(activities, { query: "duplicate", filter: "all" }).length, 1);
  assert.equal(filterAuditActivities(activities, { query: "admin-3", filter: "all" }).length, 1);
});

test("audit search is trimmed and case-insensitive", () => {
  assert.equal(filterAuditActivities(activities, { query: "  YoGeSh  ", filter: "all" }).length, 1);
});

test("action and search filters combine", () => {
  const filtered = filterAuditActivities(activities, { query: "10 skill", filter: "badge_count_updated" });
  assert.deepEqual(filtered.map((event) => event.participantName), ["Ishan Suthar"]);
  assert.equal(filterAuditActivities(activities, { query: "10 skill", filter: "participant_removed" }).length, 0);
});

test("pagination exposes 15 rows initially and reports whether more remain", () => {
  const page = paginateAuditActivities(activities, 15);
  assert.equal(page.visible.length, 4);
  assert.equal(page.total, 4);
  assert.equal(page.hasMore, false);

  const large = Array.from({ length: 40 }, () => activities[0]);
  const first = paginateAuditActivities(large, 15);
  assert.equal(first.visible.length, 15);
  assert.equal(first.hasMore, true);
  const loaded = paginateAuditActivities(large, 30);
  assert.equal(loaded.visible.length, 30);
  assert.equal(loaded.hasMore, true);
  const all = paginateAuditActivities(large, 45);
  assert.equal(all.visible.length, 40);
  assert.equal(all.hasMore, false);
});

test("pagination normalizes invalid limits without losing the full count", () => {
  const negative = paginateAuditActivities(activities, -5);
  assert.equal(negative.visible.length, 0);
  assert.equal(negative.hasMore, true);
  assert.equal(negative.total, 4);
});

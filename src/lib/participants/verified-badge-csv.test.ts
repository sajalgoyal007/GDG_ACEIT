import assert from "node:assert/strict";
import test from "node:test";
import { parseVerifiedBadgeCsv, resolveVerifiedBadgeCsvRows } from "./verified-badge-csv.ts";

const idOne = "11111111-1111-4111-8111-111111111111";
const idTwo = "22222222-2222-4222-8222-222222222222";
const header = "participant_id,verified_badge_count,review_note\n";

test("verified badge CSV accepts audited zero and positive counts", () => {
  const parsed = parseVerifiedBadgeCsv(`${header}${idOne},0,Manually verified zero\n${idTwo},12,Reviewed current evidence\n`);
  assert.equal(parsed.issues.length, 0);
  assert.deepEqual(parsed.rows.map((row) => row.badgeCount), [0, 12]);
});

test("verified badge CSV rejects malformed schema, UUIDs, counts, and missing notes", () => {
  assert.equal(parseVerifiedBadgeCsv("participant_id,count\na,1").rows.length, 0);
  const result = parseVerifiedBadgeCsv(`${header}bad-id,1,note\n${idOne},-1,note\n${idTwo},1.5,note\n${idOne},10001,note\n${idTwo},2,\n`);
  assert.equal(result.rows.length, 0);
  assert.equal(result.issues.length, 5);
  assert.ok(result.issues.every((issue) => issue.kind === "invalid"));
});

test("duplicate UUIDs and conflicting counts exclude every matching row", () => {
  const same = parseVerifiedBadgeCsv(`${header}${idOne},4,First note\n${idOne},4,Second note\n`);
  assert.equal(same.rows.length, 0);
  assert.ok(same.issues.every((issue) => issue.kind === "duplicate"));
  const conflict = parseVerifiedBadgeCsv(`${header}${idOne},4,First note\n${idOne},5,Second note\n`);
  assert.equal(conflict.rows.length, 0);
  assert.ok(conflict.issues.every((issue) => issue.kind === "conflict"));
});

test("resolver separates unknown participant UUIDs and never falls back to names", () => {
  const parsed = parseVerifiedBadgeCsv(`${header}${idOne},0,Reviewed zero\n${idTwo},7,Reviewed positive\n`);
  const resolved = resolveVerifiedBadgeCsvRows(parsed.rows, [{
    id: idOne, displayName: "Roster name", verifiedBadgeCount: 3,
    lastVerifiedAt: null, verificationSource: null,
  }]);
  assert.equal(resolved.rows.length, 1);
  assert.equal(resolved.rows[0]?.participantId, idOne);
  assert.equal(resolved.issues[0]?.kind, "unknown");
});

test("CSV parser handles quoted notes and rejects broken quotes", () => {
  const quoted = parseVerifiedBadgeCsv(`${header}${idOne},0,"Reviewed, confirmed zero"\n`);
  assert.equal(quoted.rows[0]?.reviewNote, "Reviewed, confirmed zero");
  assert.equal(parseVerifiedBadgeCsv(`${header}${idOne},0,"unfinished`).rows.length, 0);
});

test("CSV parser bounds row issue creation at the documented limit", () => {
  const body = Array.from({ length: 501 }, (_, index) => `${idOne},${index % 10},Reviewed row ${index}`).join("\n");
  const parsed = parseVerifiedBadgeCsv(`${header}${body}\n`);
  assert.equal(parsed.rows.length, 0);
  assert.equal(parsed.issues.length, 1);
  assert.match(parsed.issues[0]!.message, /limited to 500/);
});

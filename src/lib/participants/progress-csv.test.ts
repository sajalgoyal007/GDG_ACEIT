import assert from "node:assert/strict";
import test from "node:test";
import { parseProgressCsv, resolveProgressCsvRows } from "./progress-csv.ts";

const header = "participant_key,profile_url,badge_count\n";

test("progress CSV accepts canonical URLs and preserves a zero count", () => {
  const parsed = parseProgressCsv(`${header}aceit-001,https://www.skills.google/public_profiles/abc,0\n`);
  assert.equal(parsed.issues.length, 0);
  assert.equal(parsed.rows[0]?.badgeCount, 0);
  assert.equal(parsed.rows[0]?.normalizedProfileUrl, "https://skills.google/public_profiles/abc");
});

test("progress CSV rejects malformed headers, URLs, negative, fractional, and oversized counts", () => {
  assert.equal(parseProgressCsv("participant_key,count\na,1").rows.length, 0);
  const parsed = parseProgressCsv(`${header}a,http://skills.google/public_profiles/a,2\nb,https://skills.google/public_profiles/b,-1\nc,https://skills.google/public_profiles/c,1.5\nd,https://skills.google/public_profiles/d,10001\n`);
  assert.equal(parsed.rows.length, 0);
  assert.equal(parsed.issues.length, 4);
});

test("duplicate keys and normalized profile URLs exclude every matching row", () => {
  const parsed = parseProgressCsv(`${header}a,https://skills.google/public_profiles/a,2\na,https://skills.google/public_profiles/b,3\nb,https://skills.google/public_profiles/c,1\nc,https://www.cloudskillsboost.google/public_profiles/c,4\n`);
  assert.deepEqual(parsed.rows, []);
  assert.equal(parsed.issues.length, 4);
  assert.ok(parsed.issues.every((issue) => issue.kind === "duplicate"));
});

test("resolver excludes unknown participants and profile URL mismatches", () => {
  const parsed = parseProgressCsv(`${header}known,https://skills.google/public_profiles/one,3\nunknown,https://skills.google/public_profiles/unknown,2\nknown2,https://skills.google/public_profiles/other,5\n`);
  const resolved = resolveProgressCsvRows(parsed.rows, [
    { id: "p1", participantKey: "known", displayName: "Known Person", profileUrl: "https://www.cloudskillsboost.google/public_profiles/one" },
    { id: "p2", participantKey: "known2", displayName: "Second Person", profileUrl: "https://skills.google/public_profiles/current" },
  ]);
  assert.equal(resolved.rows.length, 1);
  assert.equal(resolved.rows[0]?.participantId, "p1");
  assert.equal(resolved.issues.length, 2);
  assert.match(resolved.issues[0]!.message, /not registered/);
  assert.match(resolved.issues[1]!.message, /does not match/);
});

test("ambiguous registered profile URLs are excluded", () => {
  const parsed = parseProgressCsv(`${header}known,https://skills.google/public_profiles/one,3\n`);
  const resolved = resolveProgressCsvRows(parsed.rows, [
    { id: "p1", participantKey: "known", displayName: "Known Person", profileUrl: "https://skills.google/public_profiles/one" },
    { id: "p2", participantKey: "other", displayName: "Other Person", profileUrl: "https://www.cloudskillsboost.google/public_profiles/one" },
  ]);
  assert.equal(resolved.rows.length, 0);
  assert.equal(resolved.issues[0]?.kind, "duplicate");
});

test("quoted CSV fields, empty files, and broken quoting are handled", () => {
  const quoted = parseProgressCsv(`${header}"aceit,one",https://skills.google/public_profiles/one,10\n`);
  assert.equal(quoted.rows.length, 0);
  assert.equal(quoted.issues[0]?.kind, "invalid");
  assert.equal(parseProgressCsv("").issues[0]?.message, "CSV is empty.");
  assert.equal(parseProgressCsv(`${header}a,"https://skills.google/public_profiles/a,2`).rows.length, 0);
});

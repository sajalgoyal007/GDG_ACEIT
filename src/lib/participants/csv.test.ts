import assert from "node:assert/strict";
import test from "node:test";
import { parseParticipantCsv } from "./csv.ts";

test("parses quoted names and normalizes stable participant keys", () => {
  const result = parseParticipantCsv("\uFEFFparticipant_key,display_name,profile_url\r\n ACEIT-001 ,\"Learner, One\",https://www.cloudskillsboost.google/public_profiles/abc");
  assert.equal(result.issues.length, 0);
  assert.deepEqual(result.rows, [{
    rowNumber: 2,
    participantKey: "aceit-001",
    displayName: "Learner, One",
    profileUrl: "https://www.cloudskillsboost.google/public_profiles/abc",
  }]);
});

test("reports duplicate keys in a file and keeps the first valid row", () => {
  const result = parseParticipantCsv("participant_key,display_name,profile_url\naceit-1,First,\nACEIT-1,Second,");
  assert.equal(result.rows.length, 1);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].kind, "duplicate");
  assert.equal(result.issues[0].rowNumber, 3);
});

test("rejects malformed names, URLs, row widths, and headers", () => {
  const result = parseParticipantCsv([
    "participant_key,display_name,profile_url",
    "bad key,Invalid key,",
    "aceit-2,Invalid URL,https://example.com/profile",
    "aceit-3,Extra column,,unexpected",
  ].join("\n"));
  assert.equal(result.rows.length, 0);
  assert.deepEqual(result.issues.map((issue) => issue.rowNumber), [2, 3, 4]);
  assert.equal(parseParticipantCsv("email,name\na@b.test,Somebody").issues[0].kind, "invalid");
});

test("rejects unclosed quoted fields and oversized CSV input", () => {
  assert.match(parseParticipantCsv('participant_key,display_name,profile_url\nkey-1,"Unclosed,').issues[0].message, /Unclosed quoted field/);
  assert.equal(parseParticipantCsv(`participant_key,display_name,profile_url\n${"x".repeat(1_000_001)}`).issues[0].message, "CSV must be 1 MB or smaller.");
});

test("parses and normalizes skills.google profile URLs", () => {
  const result = parseParticipantCsv("\uFEFFparticipant_key,display_name,profile_url\r\n ACEIT-002 ,\"Learner, Two\",https://www.skills.google/public_profiles/xyz-999");
  assert.equal(result.issues.length, 0);
  assert.deepEqual(result.rows, [{
    rowNumber: 2,
    participantKey: "aceit-002",
    displayName: "Learner, Two",
    profileUrl: "https://www.skills.google/public_profiles/xyz-999",
  }]);
});

test("regression: roster importer rejects classified badge CSV and directs to classified importer", () => {
  const classifiedCsv = "participant_id,skill_badge_count,arcade_game_badge_count,total_badge_count,review_note\n11111111-1111-4111-8111-111111111111,5,2,7,Reviewed evidence";
  const result = parseParticipantCsv(classifiedCsv);
  assert.equal(result.rows.length, 0);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0]?.kind, "invalid");
  assert.match(result.issues[0]!.message, /classified badge-count CSV/);
  assert.match(result.issues[0]!.message, /Bulk import Skill & Arcade badge counts/);
});

test("regression: roster importer rejects verified badge CSV and directs to badge verification importer", () => {
  const verifiedCsv = "participant_id,verified_badge_count,review_note\n11111111-1111-4111-8111-111111111111,7,Reviewed evidence";
  const result = parseParticipantCsv(verifiedCsv);
  assert.equal(result.rows.length, 0);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0]?.kind, "invalid");
  assert.match(result.issues[0]!.message, /verified badge-count CSV/);
  assert.match(result.issues[0]!.message, /Bulk verify badge counts/);
});

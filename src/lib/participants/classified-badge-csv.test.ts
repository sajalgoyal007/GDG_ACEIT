import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  parseClassifiedBadgeCsv,
  resolveClassifiedBadgeCsvRows,
} from "./classified-badge-csv.ts";

function dataFile(name: string) {
  return new URL(`../../../data/${name}`, import.meta.url);
}

const idOne = "11111111-1111-4111-8111-111111111111";
const idTwo = "22222222-2222-4222-8222-222222222222";
const header = "participant_id,skill_badge_count,arcade_game_badge_count,total_badge_count,review_note\n";

test("classified badge CSV accepts audited zero and positive counts", () => {
  const csv = `${header}${idOne},0,0,0,Manually verified zero\n${idTwo},5,2,7,Reviewed 5 skill and 2 arcade\n`;
  const parsed = parseClassifiedBadgeCsv(csv);
  assert.equal(parsed.issues.length, 0);
  assert.equal(parsed.rows.length, 2);
  assert.deepEqual(
    parsed.rows.map((row) => ({
      skill: row.skillBadgeCount,
      arcade: row.arcadeGameBadgeCount,
      total: row.totalBadgeCount,
    })),
    [
      { skill: 0, arcade: 0, total: 0 },
      { skill: 5, arcade: 2, total: 7 },
    ],
  );
});

test("classified badge CSV rejects sum mismatch when skill + arcade != total", () => {
  const csv = `${header}${idOne},4,1,6,Sum mismatch row\n`;
  const parsed = parseClassifiedBadgeCsv(csv);
  assert.equal(parsed.rows.length, 0);
  assert.equal(parsed.issues.length, 1);
  assert.equal(parsed.issues[0]?.kind, "sum_mismatch");
  assert.match(parsed.issues[0]!.message, /must equal total_badge_count/);
});

test("classified badge CSV rejects malformed schema, UUIDs, counts, and missing notes", () => {
  // Bad header
  assert.equal(parseClassifiedBadgeCsv("participant_id,count\na,1").rows.length, 0);

  // Bad data rows
  const result = parseClassifiedBadgeCsv(
    `${header}` +
      `bad-uuid,0,0,0,note\n` +
      `${idOne},-1,0,0,note\n` +
      `${idTwo},0,-1,0,note\n` +
      `${idOne},1,1,-2,note\n` +
      `${idTwo},10001,0,10001,note\n` +
      `${idOne},1.5,0,1.5,note\n` +
      `${idTwo},2,1,3,\n`,
  );
  assert.equal(result.rows.length, 0);
  assert.equal(result.issues.length, 7);
  assert.ok(result.issues.every((issue) => issue.kind === "invalid"));
});

test("duplicate UUIDs and conflicting counts exclude every matching row", () => {
  // Duplicate identical counts
  const same = parseClassifiedBadgeCsv(
    `${header}${idOne},3,1,4,First note\n${idOne},3,1,4,Second note\n`,
  );
  assert.equal(same.rows.length, 0);
  assert.equal(same.issues.length, 2);
  assert.ok(same.issues.every((issue) => issue.kind === "duplicate"));

  // Duplicate conflicting counts
  const conflict = parseClassifiedBadgeCsv(
    `${header}${idOne},3,1,4,First note\n${idOne},4,0,4,Second note\n`,
  );
  assert.equal(conflict.rows.length, 0);
  assert.equal(conflict.issues.length, 2);
  assert.ok(conflict.issues.every((issue) => issue.kind === "conflict"));
});

test("resolver separates unknown participant UUIDs and preserves current DB state", () => {
  const parsed = parseClassifiedBadgeCsv(
    `${header}${idOne},0,0,0,Reviewed zero\n${idTwo},5,2,7,Reviewed positive\n`,
  );
  const resolved = resolveClassifiedBadgeCsvRows(parsed.rows, [
    {
      id: idOne,
      displayName: "Roster participant",
      verifiedBadgeCount: 0,
      currentSkillBadgeCount: null,
      currentArcadeGameBadgeCount: null,
      lastVerifiedAt: null,
      verificationSource: null,
    },
  ]);
  assert.equal(resolved.rows.length, 1);
  assert.equal(resolved.rows[0]?.participantId, idOne);
  assert.equal(resolved.rows[0]?.displayName, "Roster participant");
  assert.equal(resolved.issues.length, 1);
  assert.equal(resolved.issues[0]?.kind, "unknown");
});

test("CSV parser handles quoted notes and rejects broken quotes", () => {
  const quoted = parseClassifiedBadgeCsv(
    `${header}${idOne},2,1,3,"Reviewed, confirmed 2 skill and 1 arcade"\n`,
  );
  assert.equal(quoted.rows[0]?.reviewNote, "Reviewed, confirmed 2 skill and 1 arcade");
  assert.equal(parseClassifiedBadgeCsv(`${header}${idOne},2,1,3,"unfinished`).rows.length, 0);
});

test("CSV parser bounds row issue creation at 500 data rows", () => {
  const body = Array.from(
    { length: 501 },
    (_, index) => `${idOne},1,0,1,Reviewed row ${index}`,
  ).join("\n");
  const parsed = parseClassifiedBadgeCsv(`${header}${body}\n`);
  assert.equal(parsed.rows.length, 0);
  assert.equal(parsed.issues.length, 1);
  assert.match(parsed.issues[0]!.message, /limited to 500/);
});

function firstColumn(fileName: string) {
  return readFileSync(dataFile(fileName), "utf8")
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.split(",")[0]?.trim())
    .filter((value): value is string => Boolean(value));
}

test("production classified import matches the finalized 195-participant roster", () => {
  const parsed = parseClassifiedBadgeCsv(readFileSync(dataFile("classified-badge-import.csv"), "utf8"));
  assert.equal(parsed.issues.length, 0);
  assert.equal(parsed.rows.length, 195);
  const byId = new Map(parsed.rows.map((row) => [row.participantId, row]));
  assert.equal(byId.size, 195);

  const manifestIds = firstColumn("final-reconciliation-05nov-2026/participant-manifest.csv");
  assert.equal(manifestIds.length, 195);
  for (const participantId of manifestIds) {
    assert.ok(byId.has(participantId), `missing final participant ${participantId}`);
  }

  const removalIds = firstColumn("final-reconciliation-05nov-2026/removal-proposals.csv");
  assert.equal(removalIds.length, 7);
  for (const participantId of removalIds) {
    assert.ok(!byId.has(participantId), `removal proposal leaked into import ${participantId}`);
  }

  const totals = parsed.rows.reduce((accumulator, row) => ({
    skill: accumulator.skill + row.skillBadgeCount,
    arcade: accumulator.arcade + row.arcadeGameBadgeCount,
    total: accumulator.total + row.totalBadgeCount,
  }), { skill: 0, arcade: 0, total: 0 });
  assert.deepEqual(totals, { skill: 200, arcade: 16, total: 216 });
});


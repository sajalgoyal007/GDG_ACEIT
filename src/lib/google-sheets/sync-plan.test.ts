import assert from "node:assert/strict";
import test from "node:test";
import { classifyGoogleFormSync, prepareGoogleFormRows, type GoogleFormHeaderMap } from "./sync-plan.ts";

const mapping: GoogleFormHeaderMap = {
  headerRow: 1,
  name: "Name",
  email: "Email",
  profileUrl: "Google Skills profile URL",
};
const identityMap = new Map<string, string>();
const identity = (email: string) => {
  if (!identityMap.has(email)) identityMap.set(email, `test-identity-${identityMap.size + 1}`);
  return identityMap.get(email)!;
};

test("maps configurable headers independent of spreadsheet column order", () => {
  const result = prepareGoogleFormRows([
    ["Timestamp", "Email", "Google Skills profile URL", "Name", "Mobile number"],
    ["today", "learner@example.test", "https://www.cloudskillsboost.google/public_profiles/abc", "Learner One", "private"],
  ], mapping, identity);
  assert.deepEqual(result.issues, []);
  assert.equal(result.rows[0].displayName, "Learner One");
  assert.equal(result.rows[0].profileUrl, "https://www.cloudskillsboost.google/public_profiles/abc");
  assert.equal(JSON.stringify(result).includes("learner@example.test"), false);
  assert.equal(JSON.stringify(result).includes("private"), false);
});

test("reports missing or ambiguous configured headers", () => {
  const missing = prepareGoogleFormRows([["Name", "Email"], ["A", "a@example.test"]], mapping, identity);
  assert.equal(missing.rows.length, 0);
  assert.equal(missing.issues[0].kind, "invalid");
  const ambiguous = prepareGoogleFormRows([["Name", "Email", "Email", "Google Skills profile URL"]], mapping, identity);
  assert.match(ambiguous.issues[0].message, /ambiguous/);
});

test("rejects invalid profile URLs and required fields without returning private values", () => {
  const result = prepareGoogleFormRows([
    ["Name", "Email", "Google Skills profile URL"],
    ["Learner", "learner@example.test", "http://cloudskillsboost.google/public_profiles/abc"],
    ["", "missing-name@example.test", ""],
    ["No Email", "", ""],
  ], mapping, identity);
  assert.equal(result.rows.length, 0);
  assert.equal(result.issues.length, 3);
  assert.ok(result.issues.every((issue) => issue.kind === "invalid"));
  assert.equal(JSON.stringify(result).includes("example.test"), false);
});

test("accepts canonical public profile URLs from both Google Skills domains and rejects invalid values", () => {
  const validProfileUrls = [
    "https://www.cloudskillsboost.google/public_profiles/abc-123_X",
    "https://www.skills.google/public_profiles/profile_456-XYZ",
  ];
  const invalidProfileUrls = [
    "",
    "   ",
    "Nothing",
    "https://www.skills.google/public_profiles/",
    "https://www.cloudskillsboost.google/public_profiles/%",
    "http://www.cloudskillsboost.google/public_profiles/abc",
    "https://skills.google/public_profiles/abc",
    "https://example.com/public_profiles/abc",
    "https://cloudskillsboost.google/public_profiles/abc",
    "https://www.cloudskillsboost.google/profile/abc",
    "https://www.cloudskillsboost.google/public_profiles/abc/extra",
    "https://www.cloudskillsboost.google/public_profiles/abc?source=form",
    "https://%zz/public_profiles/abc",
  ];
  const allProfileUrls = [...validProfileUrls, ...invalidProfileUrls];
  const result = prepareGoogleFormRows([
    ["Name", "Email", "Google Skills profile URL"],
    ...allProfileUrls.map((profileUrl, index) => [`Learner ${index}`, `learner${index}@example.test`, profileUrl]),
  ], mapping, identity);

  assert.equal(result.rows.length, validProfileUrls.length);
  assert.equal(result.rows[0].rowNumber, 2);
  assert.deepEqual(result.rows.map((row) => row.profileUrl), validProfileUrls);
  assert.equal(result.rows[1].rowNumber, 3);
  assert.equal(result.issues.length, invalidProfileUrls.length);
  assert.ok(result.issues.every((issue) => issue.kind === "invalid"));
  assert.deepEqual(result.issues.map((issue) => issue.rowNumber), invalidProfileUrls.map((_, index) => index + validProfileUrls.length + 2));
  assert.ok(result.issues.every((issue) => /Google Skills profile URL/.test(issue.message)));
});

test("skips empty response rows and reports an empty sheet as no records", () => {
  const result = prepareGoogleFormRows([
    ["Name", "Email", "Google Skills profile URL"],
    ["", "", ""],
    [],
  ], mapping, identity);
  assert.deepEqual(result, { rows: [], issues: [] });
  assert.deepEqual(classifyGoogleFormSync(result.rows, result.issues, []).counts, { new: 0, updated: 0, duplicate: 0, invalid: 0 });
});

test("all repeated same-email responses are excluded for manual review", () => {
  const repeated = prepareGoogleFormRows([
    ["Name", "Email", "Google Skills profile URL"],
    ["Learner", "learner@example.test", "https://www.cloudskillsboost.google/public_profiles/first"],
    ["Learner", "learner@example.test", "https://www.cloudskillsboost.google/public_profiles/second"],
  ], mapping, identity);
  assert.equal(repeated.rows.length, 0);
  assert.equal(repeated.issues.length, 2);
  assert.ok(repeated.issues.every((issue) => issue.kind === "duplicate"));

  const conflicting = prepareGoogleFormRows([
    ["Name", "Email", "Google Skills profile URL"],
    ["Learner A", "shared@example.test", "https://www.cloudskillsboost.google/public_profiles/first"],
    ["Learner B", "shared@example.test", "https://www.cloudskillsboost.google/public_profiles/second"],
  ], mapping, identity);
  assert.equal(conflicting.rows.length, 0);
  assert.equal(conflicting.issues.filter((issue) => issue.kind === "duplicate").length, 2);
});

test("different matching identities sharing a profile URL are excluded for manual review", () => {
  const prepared = prepareGoogleFormRows([
    ["Name", "Email", "Google Skills profile URL"],
    ["Learner A", "a@example.test", "https://www.cloudskillsboost.google/public_profiles/shared"],
    ["Learner B", "b@example.test", "https://www.cloudskillsboost.google/public_profiles/shared"],
  ], mapping, identity);
  assert.equal(prepared.rows.length, 0);
  assert.equal(prepared.issues.length, 2);
  assert.ok(prepared.issues.every((issue) => issue.kind === "duplicate"));
});

test("repeated sync is idempotent and registration updates omit badge-count writes", () => {
  const prepared = prepareGoogleFormRows([
    ["Name", "Email", "Google Skills profile URL"],
    ["Learner", "learner@example.test", "https://www.cloudskillsboost.google/public_profiles/abc"],
  ], mapping, identity);
  const existing = [{
    id: "participant-1",
    participantKey: prepared.rows[0].participantKey,
    displayName: "Learner",
    profileUrl: "https://www.cloudskillsboost.google/public_profiles/abc",
    verifiedBadgeCount: 9,
  }];
  const repeated = classifyGoogleFormSync(prepared.rows, prepared.issues, existing);
  assert.equal(repeated.counts.duplicate, 1);
  assert.equal(repeated.rowsToApply.length, 0);

  const changed = prepareGoogleFormRows([
    ["Name", "Email", "Google Skills profile URL"],
    ["Learner Updated", "learner@example.test", "https://www.cloudskillsboost.google/public_profiles/abc"],
  ], mapping, identity);
  const updatePlan = classifyGoogleFormSync(changed.rows, changed.issues, existing);
  assert.equal(updatePlan.counts.updated, 1);
  assert.equal(updatePlan.rowsToApply[0].displayName, "Learner Updated");
  assert.equal("verifiedBadgeCount" in updatePlan.rowsToApply[0], false);
  assert.equal(existing[0].verifiedBadgeCount, 9);

  const omittedProfile = prepareGoogleFormRows([
    ["Name", "Email", "Google Skills profile URL"],
    ["Learner Updated", "learner@example.test", ""],
  ], mapping, identity);
  const profilePreservingPlan = classifyGoogleFormSync(omittedProfile.rows, omittedProfile.issues, existing);
  assert.equal(profilePreservingPlan.rowsToApply.length, 0);
  assert.equal(profilePreservingPlan.counts.invalid, 1);
});

test("new rows are classified without badge data and invalid rows remain visible", () => {
  const prepared = prepareGoogleFormRows([
    ["Name", "Email", "Google Skills profile URL"],
    ["New Learner", "new@example.test", "https://www.cloudskillsboost.google/public_profiles/new"],
    ["Invalid Profile", "bad@example.test", "https://example.com/profile"],
  ], mapping, identity);
  const plan = classifyGoogleFormSync(prepared.rows, prepared.issues, []);
  assert.equal(plan.counts.new, 1);
  assert.equal(plan.counts.invalid, 1);
  assert.equal("verifiedBadgeCount" in plan.rowsToApply[0], false);
});

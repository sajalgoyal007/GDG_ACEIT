import assert from "node:assert/strict";
import test from "node:test";
import {
  isAwardScopedBadgeHref,
  isValidBadgeKey,
  normalizeBadgeSignal,
  parseBadgeKey,
} from "./identity.ts";

test("structural course template signals normalize to skill catalog keys", () => {
  assert.deepEqual(normalizeBadgeSignal("/course_templates/754"), {
    badgeKey: "course_template:754",
    structuralType: "course_template",
    structuralCategory: "skill",
  });
  assert.equal(normalizeBadgeSignal("  /course_templates/1585  ")?.badgeKey, "course_template:1585");
});

test("structural game signals normalize to arcade catalog keys", () => {
  assert.deepEqual(normalizeBadgeSignal("/games/76266"), {
    badgeKey: "game:76266",
    structuralType: "game",
    structuralCategory: "arcade",
  });
});

test("award-scoped /badges/<id> URLs are never catalog identities", () => {
  assert.equal(normalizeBadgeSignal("/badges/29485277"), null);
  assert.equal(normalizeBadgeSignal("https://www.skills.google/public_profiles/x/badges/29485277"), null);
  assert.equal(isAwardScopedBadgeHref("/badges/29485277"), true);
  assert.equal(isAwardScopedBadgeHref("https://www.skills.google/public_profiles/x/badges/29485277"), false);
});

test("titles and free text are not badge identities", () => {
  assert.equal(normalizeBadgeSignal("Build a Website on Google Cloud"), null);
  assert.equal(normalizeBadgeSignal(""), null);
  assert.equal(normalizeBadgeSignal(null), null);
  assert.equal(normalizeBadgeSignal("/course_templates/0"), null);
  assert.equal(normalizeBadgeSignal("/course_templates/01"), null);
  assert.equal(normalizeBadgeSignal("/games/"), null);
});

test("catalog keys round-trip and reject malformed ids", () => {
  assert.deepEqual(parseBadgeKey("course_template:754"), {
    structuralType: "course_template",
    id: "754",
    structuralCategory: "skill",
  });
  assert.deepEqual(parseBadgeKey("game:102804"), {
    structuralType: "game",
    id: "102804",
    structuralCategory: "arcade",
  });
  for (const invalid of ["course_template:0", "game:01", "course_template:", "/badges/1", "game:1:2", ""]) {
    assert.equal(parseBadgeKey(invalid), null, invalid);
    assert.equal(isValidBadgeKey(invalid), false, invalid);
  }
});

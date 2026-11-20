import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_VERIFIED_SKILL_BADGES,
  NON_SYLLABUS_COURSE_DETAIL,
  OFFICIAL_SKILL_BADGE_SYLLABUS,
  SYLLABUS_CORRECTION_DETAIL,
  capVerifiedSkillCount,
  isNonSyllabusCourseBadgeKey,
  isOfficialSyllabusBadge,
  isOfficialSyllabusBadgeKey,
  officialSyllabusDisplayName,
  shouldClearFrozenRank,
} from "./syllabus.ts";

test("official campaign syllabus is exactly ten structural course identities", () => {
  assert.equal(OFFICIAL_SKILL_BADGE_SYLLABUS.length, 10);
  assert.equal(MAX_VERIFIED_SKILL_BADGES, 10);
  assert.deepEqual(
    OFFICIAL_SKILL_BADGE_SYLLABUS.map((badge) => badge.badgeKey).sort(),
    [
      "course_template:1426",
      "course_template:1586",
      "course_template:633",
      "course_template:658",
      "course_template:700",
      "course_template:702",
      "course_template:754",
      "course_template:756",
      "course_template:959",
      "course_template:638",
    ].sort(),
  );
  for (const badge of OFFICIAL_SKILL_BADGE_SYLLABUS) {
    assert.equal(isOfficialSyllabusBadgeKey(badge.badgeKey), true);
    assert.equal(isNonSyllabusCourseBadgeKey(badge.badgeKey), false);
    assert.equal(isOfficialSyllabusBadge(badge.badgeKey, badge.displayName), true);
    assert.equal(officialSyllabusDisplayName(badge.badgeKey), badge.displayName);
  }
});

test("every other course template is non-syllabus and games are not courses", () => {
  assert.equal(isNonSyllabusCourseBadgeKey("course_template:1080"), true);
  assert.equal(isNonSyllabusCourseBadgeKey("course_template:999999"), true);
  assert.equal(isOfficialSyllabusBadgeKey("course_template:1080"), false);
  assert.equal(isOfficialSyllabusBadge("course_template:754", "Wrong title"), false);
  assert.equal(officialSyllabusDisplayName("course_template:1080"), null);
  assert.equal(isNonSyllabusCourseBadgeKey("game:76266"), false);
  assert.equal(isOfficialSyllabusBadgeKey("game:76266"), false);
});

test("verified Skill counts are capped at ten", () => {
  assert.equal(capVerifiedSkillCount(0), 0);
  assert.equal(capVerifiedSkillCount(9), 9);
  assert.equal(capVerifiedSkillCount(10), 10);
  assert.equal(capVerifiedSkillCount(17), 10);
});

test("false Frozen Ranks clear only for sub-ten verified Skill counts", () => {
  assert.equal(shouldClearFrozenRank(null), false);
  assert.equal(shouldClearFrozenRank(0), true);
  assert.equal(shouldClearFrozenRank(9), true);
  assert.equal(shouldClearFrozenRank(10), false);
  assert.equal(shouldClearFrozenRank(12), false);
});

test("preview detail strings are exact and stable", () => {
  assert.equal(NON_SYLLABUS_COURSE_DETAIL, "Non-syllabus course (ignored)");
  assert.equal(SYLLABUS_CORRECTION_DETAIL, "Official syllabus correction; previous Skill total exceeded 10.");
});

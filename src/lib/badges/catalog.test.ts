import assert from "node:assert/strict";
import test from "node:test";
import {
  changeCatalogCategory,
  defaultCategoryForUnknownBadge,
  defaultCategoryForUnknownBadgeKey,
  isCategoryAllowedForBadgeKey,
  resolveCatalogCategory,
  validateCatalogEntry,
  validateCategoryChange,
} from "./catalog.ts";
import type { CatalogEntry } from "./catalog.ts";
import { OFFICIAL_SKILL_BADGE_SYLLABUS } from "./syllabus.ts";

const skillEntry: CatalogEntry = {
  badgeKey: "course_template:754",
  displayName: "The Basics of Google Cloud Compute",
  category: "skill",
  source: "evidence:2026-11-09",
};

const nonSyllabusEntry: CatalogEntry = {
  badgeKey: "course_template:1080",
  displayName: "Machine Learning Operations (MLOps) with Agent Platform: Model Evaluation",
  category: "ignored",
  source: "evidence:2026-11-09",
};

const gameEntry: CatalogEntry = {
  badgeKey: "game:76266",
  displayName: "A verified Arcade badge",
  category: "ignored",
  source: "evidence:2026-11-09",
};

test("unknown games stay unclassified while unknown courses are ignored", () => {
  assert.equal(defaultCategoryForUnknownBadge(), "unclassified");
  assert.equal(defaultCategoryForUnknownBadgeKey("game:999999"), "unclassified");
  assert.equal(defaultCategoryForUnknownBadgeKey("course_template:999999"), "ignored");
  assert.equal(resolveCatalogCategory("game:999999", new Map()), "unclassified");
  assert.equal(resolveCatalogCategory("course_template:999999", new Map()), "ignored");
  assert.equal(
    resolveCatalogCategory("course_template:754", new Map([[skillEntry.badgeKey, skillEntry]])),
    "skill",
  );
});

test("course templates cannot become arcade and games cannot become skill", () => {
  assert.equal(isCategoryAllowedForBadgeKey("course_template:754", "skill"), true);
  assert.equal(isCategoryAllowedForBadgeKey("course_template:754", "ignored"), true);
  assert.equal(isCategoryAllowedForBadgeKey("course_template:754", "unclassified"), true);
  assert.equal(isCategoryAllowedForBadgeKey("course_template:754", "arcade"), false);
  assert.equal(isCategoryAllowedForBadgeKey("game:1", "arcade"), true);
  assert.equal(isCategoryAllowedForBadgeKey("game:1", "skill"), false);
});

test("catalog entry validation rejects malformed keys and names", () => {
  assert.equal(validateCatalogEntry(skillEntry).ok, true);
  assert.equal(
    validateCatalogEntry({ ...skillEntry, badgeKey: "/badges/29485277" }).ok,
    false,
  );
  assert.equal(validateCatalogEntry({ ...skillEntry, category: "arcade" }).ok, false);
  assert.equal(validateCatalogEntry({ ...skillEntry, displayName: "   " }).ok, false);
  assert.equal(validateCatalogEntry({ ...skillEntry, displayName: "Bad\u0001Name" }).ok, false);
  assert.equal(validateCatalogEntry({ ...skillEntry, source: "" }).ok, false);
});

test("only the exact ten syllabus courses can be skill", () => {
  for (const badge of OFFICIAL_SKILL_BADGE_SYLLABUS) {
    const result = validateCatalogEntry({
      badgeKey: badge.badgeKey,
      displayName: badge.displayName,
      category: "skill",
      source: "official:campaign_syllabus",
    });
    assert.equal(result.ok, true, badge.badgeKey);
  }

  const outsideSkill = validateCatalogEntry({ ...nonSyllabusEntry, category: "skill" });
  assert.equal(outsideSkill.ok, false);
  if (!outsideSkill.ok) assert.match(outsideSkill.reason, /official 10-badge campaign syllabus/);

  const outsideUnclassified = validateCatalogEntry({ ...nonSyllabusEntry, category: "unclassified" });
  assert.equal(outsideUnclassified.ok, false);
  if (!outsideUnclassified.ok) assert.match(outsideUnclassified.reason, /always ignored/);

  const syllabusIgnored = validateCatalogEntry({ ...skillEntry, category: "ignored" });
  assert.equal(syllabusIgnored.ok, false);
  if (!syllabusIgnored.ok) assert.match(syllabusIgnored.reason, /must remain skill/);

  const renamedSyllabus = validateCatalogEntry({ ...skillEntry, displayName: "Renamed course" });
  assert.equal(renamedSyllabus.ok, false);
  if (!renamedSyllabus.ok) assert.match(renamedSyllabus.reason, /exact campaign title/);
});

test("category changes preserve the catalog lock", () => {
  assert.equal(changeCatalogCategory(skillEntry, "ignored", "No longer official").ok, false);
  assert.equal(changeCatalogCategory(nonSyllabusEntry, "skill", "Looks official").ok, false);
  assert.equal(changeCatalogCategory(nonSyllabusEntry, "unclassified", "Needs review").ok, false);
  assert.equal(
    validateCategoryChange({
      badgeKey: skillEntry.badgeKey,
      nextCategory: "skill",
      reason: "No change",
      nextDisplayName: "Renamed course",
    }).ok,
    false,
  );
});

test("category changes require a reason and emit an audit event", () => {
  const missingReason = changeCatalogCategory(gameEntry, "arcade", "   ");
  assert.equal(missingReason.ok, false);

  const changed = changeCatalogCategory(gameEntry, "arcade", "Verified Arcade evidence");
  assert.equal(changed.ok, true);
  if (!changed.ok) return;
  assert.equal(changed.value.entry.category, "arcade");
  assert.deepEqual(changed.value.audit, {
    badgeKey: "game:76266",
    previousCategory: "ignored",
    newCategory: "arcade",
    previousDisplayName: "A verified Arcade badge",
    newDisplayName: "A verified Arcade badge",
    reason: "Verified Arcade evidence",
  });

  const unchanged = changeCatalogCategory(gameEntry, "ignored", "No change", gameEntry.displayName);
  assert.equal(unchanged.ok, true);
  if (!unchanged.ok) return;
  assert.equal(unchanged.value.audit, null);
});

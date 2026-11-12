import assert from "node:assert/strict";
import test from "node:test";
import {
  changeCatalogCategory,
  defaultCategoryForUnknownBadge,
  isCategoryAllowedForBadgeKey,
  resolveCatalogCategory,
  validateCatalogEntry,
} from "./catalog.ts";
import type { CatalogEntry } from "./catalog.ts";

const skillEntry: CatalogEntry = {
  badgeKey: "course_template:754",
  displayName: "The Basics of Google Cloud Compute",
  category: "skill",
  source: "evidence:2026-11-09",
};

test("unknown structural badges always default to unclassified", () => {
  assert.equal(defaultCategoryForUnknownBadge(), "unclassified");
  assert.equal(resolveCatalogCategory("game:999999", new Map()), "unclassified");
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

test("category changes require a reason and emit an audit event", () => {
  const missingReason = changeCatalogCategory(skillEntry, "ignored", "   ");
  assert.equal(missingReason.ok, false);

  const changed = changeCatalogCategory(skillEntry, "ignored", "Duplicate award family");
  assert.equal(changed.ok, true);
  if (!changed.ok) return;
  assert.equal(changed.value.entry.category, "ignored");
  assert.deepEqual(changed.value.audit, {
    badgeKey: "course_template:754",
    previousCategory: "skill",
    newCategory: "ignored",
    previousDisplayName: "The Basics of Google Cloud Compute",
    newDisplayName: "The Basics of Google Cloud Compute",
    reason: "Duplicate award family",
  });

  const unchanged = changeCatalogCategory(skillEntry, "skill", "No change", skillEntry.displayName);
  assert.equal(unchanged.ok, true);
  if (!unchanged.ok) return;
  assert.equal(unchanged.value.audit, null);
});

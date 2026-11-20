/**
 * Managed badge catalog rules.
 *
 * The catalog is the only authority for whether a structural badge identity
 * contributes to Skill or Arcade counts. Skill is locked to the official
 * 10-Badge Campaign Syllabus; every other course template is ignored. Unknown
 * games remain `unclassified` until an admin classifies them, and nothing is
 * ever guessed from a badge title.
 */

import {
  isValidBadgeKey,
  parseBadgeKey,
  type BadgeCategory,
  type BadgeStructuralCategory,
} from "./identity.ts";
import {
  isNonSyllabusCourseBadgeKey,
  isOfficialSyllabusBadgeKey,
  officialSyllabusDisplayName,
} from "./syllabus.ts";

export const BADGE_CATEGORIES = ["skill", "arcade", "ignored", "unclassified"] as const;

export type CatalogCategory = BadgeCategory;
export type CatalogEntry = {
  badgeKey: string;
  displayName: string;
  category: CatalogCategory;
  source: string;
};
export type CatalogAuditEvent = {
  badgeKey: string;
  previousCategory: CatalogCategory | null;
  newCategory: CatalogCategory;
  previousDisplayName: string | null;
  newDisplayName: string;
  reason: string;
};

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; reason: string };

const PRINTABLE_NAME = /^[^\u0000-\u001F\u007F]+$/;

export function isCatalogCategory(value: unknown): value is CatalogCategory {
  return typeof value === "string" && (BADGE_CATEGORIES as readonly string[]).includes(value);
}

export function isStructuralCategory(value: unknown): value is BadgeStructuralCategory {
  return value === "skill" || value === "arcade";
}

/** Unknown game identities stay unclassified; never guessed from a title. */
export function defaultCategoryForUnknownBadge(): "unclassified" {
  return "unclassified";
}

/**
 * Unknown course templates can never pollute Skill totals or block a preview.
 * Unknown games keep the original unclassified behaviour.
 */
export function defaultCategoryForUnknownBadgeKey(badgeKey: string): CatalogCategory {
  return isNonSyllabusCourseBadgeKey(badgeKey) ? "ignored" : "unclassified";
}

export function resolveCatalogCategory(
  badgeKey: string,
  catalog: ReadonlyMap<string, { category: CatalogCategory }>,
): CatalogCategory {
  return catalog.get(badgeKey)?.category ?? defaultCategoryForUnknownBadgeKey(badgeKey);
}

/** The fixed structural family a catalog key can ever belong to. */
export function structuralCategoryForKey(badgeKey: string): BadgeStructuralCategory | null {
  return parseBadgeKey(badgeKey)?.structuralCategory ?? null;
}

/**
 * A course_template can be skill/ignored/unclassified. A game can be
 * arcade/ignored/unclassified. A structural identity can never be flipped to
 * the opposite award type.
 */
export function isCategoryAllowedForBadgeKey(badgeKey: string, category: CatalogCategory): boolean {
  const structural = structuralCategoryForKey(badgeKey);
  if (!structural) return false;
  if (category === "ignored" || category === "unclassified") return true;
  return category === structural;
}

/** Skill membership is exclusive to the 10 exact official syllabus identities. */
function validateSyllabusCategory(
  badgeKey: string,
  category: CatalogCategory,
  displayName?: string,
): ValidationResult<true> {
  const isSyllabus = isOfficialSyllabusBadgeKey(badgeKey);
  if (category === "skill" && !isSyllabus) {
    return {
      ok: false,
      reason: "Only the official 10-badge campaign syllabus can be categorized as skill.",
    };
  }
  if (isNonSyllabusCourseBadgeKey(badgeKey) && category !== "ignored") {
    return {
      ok: false,
      reason: "Non-syllabus course templates are always ignored.",
    };
  }
  if (isSyllabus) {
    if (category !== "skill") {
      return {
        ok: false,
        reason: "An official 10-badge campaign syllabus course must remain skill.",
      };
    }
    if (displayName !== undefined && displayName.trim() !== officialSyllabusDisplayName(badgeKey)) {
      return {
        ok: false,
        reason: "An official syllabus course must keep its exact campaign title.",
      };
    }
  }
  return { ok: true, value: true };
}

export function validateCatalogEntry(entry: CatalogEntry): ValidationResult<CatalogEntry> {
  const badgeKey = entry.badgeKey.trim();
  const displayName = entry.displayName.trim();
  const source = entry.source.trim();
  if (!isValidBadgeKey(badgeKey)) {
    return { ok: false, reason: "Catalog key must be course_template:<id> or game:<id>." };
  }
  if (displayName.length < 1 || displayName.length > 200 || !PRINTABLE_NAME.test(displayName)) {
    return { ok: false, reason: "Catalog display name must be 1 to 200 printable characters." };
  }
  if (!isCatalogCategory(entry.category)) {
    return { ok: false, reason: "Catalog category is invalid." };
  }
  if (!isCategoryAllowedForBadgeKey(badgeKey, entry.category)) {
    return { ok: false, reason: "Catalog category conflicts with the structural badge type." };
  }
  const syllabusValidation = validateSyllabusCategory(badgeKey, entry.category, displayName);
  if (!syllabusValidation.ok) return syllabusValidation;
  if (source.length < 1 || source.length > 120) {
    return { ok: false, reason: "Catalog source must be 1 to 120 characters." };
  }
  return { ok: true, value: { badgeKey, displayName, category: entry.category, source } };
}

export function validateCategoryChange(input: {
  badgeKey: string;
  nextCategory: CatalogCategory;
  reason: string;
  nextDisplayName?: string;
}): ValidationResult<{ reason: string }> {
  if (!isValidBadgeKey(input.badgeKey)) {
    return { ok: false, reason: "Catalog key must be course_template:<id> or game:<id>." };
  }
  if (!isCatalogCategory(input.nextCategory)) {
    return { ok: false, reason: "Catalog category is invalid." };
  }
  if (!isCategoryAllowedForBadgeKey(input.badgeKey, input.nextCategory)) {
    return { ok: false, reason: "Catalog category conflicts with the structural badge type." };
  }
  const syllabusValidation = validateSyllabusCategory(
    input.badgeKey,
    input.nextCategory,
    input.nextDisplayName,
  );
  if (!syllabusValidation.ok) return syllabusValidation;
  const reason = input.reason.trim();
  if (reason.length < 1 || reason.length > 1000) {
    return { ok: false, reason: "Category change reason must be 1 to 1000 characters." };
  }
  return { ok: true, value: { reason } };
}

/**
 * Pure category-change transition. Returns null when nothing changed, which
 * means no audit event is written.
 */
export function changeCatalogCategory(
  entry: CatalogEntry,
  nextCategory: CatalogCategory,
  reason: string,
  nextDisplayName?: string,
): ValidationResult<{ entry: CatalogEntry; audit: CatalogAuditEvent | null }> {
  const validation = validateCategoryChange({
    badgeKey: entry.badgeKey,
    nextCategory,
    reason,
    nextDisplayName,
  });
  if (!validation.ok) return validation;

  const displayName = (nextDisplayName ?? entry.displayName).trim();
  if (displayName.length < 1 || displayName.length > 200 || !PRINTABLE_NAME.test(displayName)) {
    return { ok: false, reason: "Catalog display name must be 1 to 200 printable characters." };
  }
  if (entry.category === nextCategory && entry.displayName === displayName) {
    return { ok: true, value: { entry, audit: null } };
  }
  return {
    ok: true,
    value: {
      entry: { ...entry, category: nextCategory, displayName },
      audit: {
        badgeKey: entry.badgeKey,
        previousCategory: entry.category,
        newCategory: nextCategory,
        previousDisplayName: entry.displayName,
        newDisplayName: displayName,
        reason: validation.value.reason,
      },
    },
  };
}

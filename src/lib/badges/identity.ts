/**
 * Badge identity normalization.
 *
 * The catalog identity is the structural modal target shown on a public Google
 * Skills profile, never the award-scoped `/badges/<id>` URL:
 *
 *   /course_templates/<id> -> course_template:<id>  (Skill)
 *   /games/<id>            -> game:<id>             (Arcade)
 *
 * Classification is always structural. Titles are never inspected for
 * keywords, because the same title can be reissued as a different award type.
 */

export type BadgeCategory = "skill" | "arcade" | "ignored" | "unclassified";
export type BadgeStructuralType = "course_template" | "game";
export type BadgeStructuralCategory = "skill" | "arcade";

export interface NormalizedBadgeSignal {
  badgeKey: string;
  structuralType: BadgeStructuralType;
  structuralCategory: BadgeStructuralCategory;
}

const COURSE_SIGNAL = /^\/course_templates\/([1-9][0-9]*)$/;
const GAME_SIGNAL = /^\/games\/([1-9][0-9]*)$/;
const CATALOG_KEY = /^(course_template|game):([1-9][0-9]{0,19})$/;
const AWARD_SCOPED = /^\/badges\/[0-9]+$/;

/**
 * Convert a structural modal target into a stable catalog identity.
 * Returns null for anything that is not a structural course/game target,
 * including the award-scoped `/badges/<id>` form.
 */
export function normalizeBadgeSignal(signal: string | null | undefined): NormalizedBadgeSignal | null {
  const value = String(signal ?? "").trim();
  const course = COURSE_SIGNAL.exec(value);
  if (course) {
    return {
      badgeKey: `course_template:${course[1]}`,
      structuralType: "course_template",
      structuralCategory: "skill",
    };
  }
  const game = GAME_SIGNAL.exec(value);
  if (game) {
    return {
      badgeKey: `game:${game[1]}`,
      structuralType: "game",
      structuralCategory: "arcade",
    };
  }
  return null;
}

/** True only for the award-scoped URL that must never become a catalog key. */
export function isAwardScopedBadgeHref(value: string | null | undefined): boolean {
  return AWARD_SCOPED.test(String(value ?? "").trim());
}

export function parseBadgeKey(
  key: string | null | undefined,
): { structuralType: BadgeStructuralType; id: string; structuralCategory: BadgeStructuralCategory } | null {
  const match = CATALOG_KEY.exec(String(key ?? "").trim());
  if (!match) return null;
  const structuralType = match[1] as BadgeStructuralType;
  return {
    structuralType,
    id: match[2]!,
    structuralCategory: structuralType === "course_template" ? "skill" : "arcade",
  };
}

export function isValidBadgeKey(key: string | null | undefined): boolean {
  return parseBadgeKey(key) !== null;
}

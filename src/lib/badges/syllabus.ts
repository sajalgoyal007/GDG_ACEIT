/**
 * Official 10-Badge Campaign Syllabus.
 *
 * This is the single source of truth for the only course-template identities
 * that may contribute to a verified Skill count or unlock the Frozen Rank
 * milestone. The database mirrors these rows in
 * `public.official_campaign_syllabus`; this module is the client-safe copy used
 * by the pure preview engine and the admin classifier UI.
 *
 * Identity is structural (`course_template:<id>`), never the award-scoped
 * `/badges/<id>` URL and never a fuzzy title match.
 */

export const MAX_VERIFIED_SKILL_BADGES = 10;

export const NON_SYLLABUS_COURSE_DETAIL = "Non-syllabus course (ignored)";

export const SYLLABUS_CORRECTION_DETAIL =
  "Official syllabus correction; previous Skill total exceeded 10.";

export interface OfficialSyllabusBadge {
  badgeKey: string;
  displayName: string;
}

export const OFFICIAL_SKILL_BADGE_SYLLABUS: readonly OfficialSyllabusBadge[] = [
  {
    badgeKey: "course_template:633",
    displayName: "Analyze Images with the Cloud Vision API",
  },
  {
    badgeKey: "course_template:638",
    displayName: "Build a Website on Google Cloud",
  },
  {
    badgeKey: "course_template:702",
    displayName: "Configure Service Accounts and IAM Roles for Google Cloud",
  },
  {
    badgeKey: "course_template:1586",
    displayName: "Create Your First Gemini Enterprise Application",
  },
  {
    badgeKey: "course_template:1426",
    displayName: "Develop AI-Powered Prototypes in Google AI Studio",
  },
  {
    badgeKey: "course_template:959",
    displayName: "Explore Generative AI in Agent Platform",
  },
  {
    badgeKey: "course_template:700",
    displayName: "Implement Speech and Language Solutions with Pre-trained APIs",
  },
  {
    badgeKey: "course_template:658",
    displayName: "Store, Process, and Manage Data on Google Cloud - Console",
  },
  {
    badgeKey: "course_template:754",
    displayName: "The Basics of Google Cloud Compute",
  },
  {
    badgeKey: "course_template:756",
    displayName: "Using the Google Cloud Speech API",
  },
];

const SYLLABUS_BY_KEY = new Map(
  OFFICIAL_SKILL_BADGE_SYLLABUS.map((badge) => [badge.badgeKey, badge.displayName] as const),
);

/** A course is in the syllabus only when its exact structural key is whitelisted. */
export function isOfficialSyllabusBadgeKey(badgeKey: string): boolean {
  return SYLLABUS_BY_KEY.has(badgeKey);
}

/** Every other course template is ignored automatically, including unknown keys. */
export function isNonSyllabusCourseBadgeKey(badgeKey: string): boolean {
  return badgeKey.startsWith("course_template:") && !isOfficialSyllabusBadgeKey(badgeKey);
}

/** Used when creating a missing catalog row; the title must match the whitelist exactly. */
export function isOfficialSyllabusBadge(badgeKey: string, displayName: string): boolean {
  return SYLLABUS_BY_KEY.get(badgeKey) === displayName;
}

export function officialSyllabusDisplayName(badgeKey: string): string | null {
  return SYLLABUS_BY_KEY.get(badgeKey) ?? null;
}

/** A false Frozen Rank is removed only on explicit apply with a sub-10 verified Skill count. */
export function shouldClearFrozenRank(verifiedSkillCount: number | null): boolean {
  return verifiedSkillCount !== null && verifiedSkillCount < MAX_VERIFIED_SKILL_BADGES;
}

/** Store counts are bounded by the number of official syllabus identities. */
export function capVerifiedSkillCount(skillCount: number): number {
  return Math.min(Math.max(0, skillCount), MAX_VERIFIED_SKILL_BADGES);
}

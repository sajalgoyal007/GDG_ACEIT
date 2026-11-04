import type { CsvIssue } from "./csv.ts";

/**
 * Classified Badge CSV format:
 *   participant_id, skill_badge_count, arcade_game_badge_count, total_badge_count, review_note
 *
 * Invariants enforced by the parser (not the DB):
 *   - skill_badge_count + arcade_game_badge_count = total_badge_count
 *   - all counts are non-negative integers ≤ 10000
 *   - participant_id is a canonical UUID
 *   - review_note is 1–1000 printable characters
 *   - no duplicate participant IDs (all matching rows excluded)
 *   - no conflicting counts for the same participant ID
 *
 * Unknown badges are explicitly excluded from classified imports:
 * the total_badge_count field must equal the sum of the two category columns.
 * Any unknown classification not resolved must be excluded from this CSV.
 */

export interface ClassifiedBadgeCsvRow {
  rowNumber: number;
  participantId: string;
  skillBadgeCount: number;
  arcadeGameBadgeCount: number;
  totalBadgeCount: number;
  reviewNote: string;
}

export interface ClassifiedBadgeCsvParticipant {
  id: string;
  displayName: string;
  verifiedBadgeCount: number;
  currentSkillBadgeCount: number | null;
  currentArcadeGameBadgeCount: number | null;
  lastVerifiedAt: string | null;
  verificationSource: string | null;
}

export interface ResolvedClassifiedBadgeCsvRow
  extends ClassifiedBadgeCsvRow,
    ClassifiedBadgeCsvParticipant {}

export type ClassifiedBadgeCsvIssueKind = CsvIssue["kind"] | "conflict" | "unknown" | "sum_mismatch";
export interface ClassifiedBadgeCsvIssue {
  rowNumber: number;
  kind: ClassifiedBadgeCsvIssueKind;
  message: string;
}

export const CLASSIFIED_BADGE_ISSUE_MESSAGES: Record<ClassifiedBadgeCsvIssueKind, string> = {
  invalid: "CSV formatting or row contents are invalid.",
  duplicate: "This participant appears more than once in the file; all matching rows were excluded.",
  conflict: "This participant has conflicting counts in the file; all matching rows were excluded.",
  unknown: "Participant UUID is not present in the current roster; this row was excluded.",
  sum_mismatch: "Skill badge count + arcade game badge count must equal total badge count. Unknown badges must be resolved before import.",
};

export const MAX_CLASSIFIED_BADGE_CSV_BYTES = 1_000_000;
export const MAX_CLASSIFIED_BADGE_CSV_ROWS = 500;

const HEADERS = [
  "participant_id",
  "skill_badge_count",
  "arcade_game_badge_count",
  "total_badge_count",
  "review_note",
] as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readRecords(source: string): string[][] {
  const text = source.replace(/^\uFEFF/, "");
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;
  const finishField = () => {
    row.push(field);
    field = "";
    afterQuote = false;
  };
  const finishRow = () => {
    finishField();
    if (row.some((value) => value.trim() !== "")) {
      records.push(row);
      if (records.length > MAX_CLASSIFIED_BADGE_CSV_ROWS + 1) throw new Error("CSV row limit exceeded.");
    }
    row = [];
  };
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
        afterQuote = true;
      } else field += character;
      continue;
    }
    if (afterQuote && character !== "," && character !== "\r" && character !== "\n" && character.trim() !== "") {
      throw new Error("Unexpected character after a quoted field.");
    }
    if (character === ",") finishField();
    else if (character === "\r" || character === "\n") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      finishRow();
    } else if (character === '"') {
      if (field.length > 0 || afterQuote) throw new Error("Unexpected quote in a field.");
      quoted = true;
    } else if (!afterQuote) field += character;
  }
  if (quoted) throw new Error("Unclosed quoted field.");
  if (field.length > 0 || row.length > 0 || afterQuote) finishRow();
  return records;
}

export function parseClassifiedBadgeCsv(source: string): {
  rows: ClassifiedBadgeCsvRow[];
  issues: ClassifiedBadgeCsvIssue[];
} {
  if (Buffer.byteLength(source, "utf8") > MAX_CLASSIFIED_BADGE_CSV_BYTES) {
    return { rows: [], issues: [{ rowNumber: 1, kind: "invalid", message: "CSV must be 1 MB or smaller." }] };
  }
  let records: string[][];
  try {
    records = readRecords(source);
  } catch (error) {
    return {
      rows: [],
      issues: [
        {
          rowNumber: 1,
          kind: "invalid",
          message:
            error instanceof Error && error.message === "CSV row limit exceeded."
              ? `Import is limited to ${MAX_CLASSIFIED_BADGE_CSV_ROWS} data rows.`
              : "CSV formatting is invalid.",
        },
      ],
    };
  }
  if (records.length === 0) return { rows: [], issues: [{ rowNumber: 1, kind: "invalid", message: "CSV is empty." }] };
  const header = records[0]!.map((value) => value.trim().toLowerCase());
  if (
    header.length !== HEADERS.length ||
    new Set(header).size !== HEADERS.length ||
    !HEADERS.every((value) => header.includes(value))
  ) {
    return {
      rows: [],
      issues: [{ rowNumber: 1, kind: "invalid", message: `Header must contain exactly: ${HEADERS.join(", ")}.` }],
    };
  }
  const index = Object.fromEntries(HEADERS.map((value) => [value, header.indexOf(value)])) as Record<
    (typeof HEADERS)[number],
    number
  >;
  const rows: ClassifiedBadgeCsvRow[] = [];
  const issues: ClassifiedBadgeCsvIssue[] = [];
  for (const [offset, values] of records.slice(1).entries()) {
    const rowNumber = offset + 2;
    if (offset >= MAX_CLASSIFIED_BADGE_CSV_ROWS) {
      issues.push({ rowNumber, kind: "invalid", message: `Import is limited to ${MAX_CLASSIFIED_BADGE_CSV_ROWS} data rows.` });
      continue;
    }
    if (values.length !== HEADERS.length) {
      issues.push({ rowNumber, kind: "invalid", message: `Expected ${HEADERS.length} columns; found ${values.length}.` });
      continue;
    }
    const participantId = values[index.participant_id]!.trim().toLowerCase();
    const skillText = values[index.skill_badge_count]!.trim();
    const arcadeText = values[index.arcade_game_badge_count]!.trim();
    const totalText = values[index.total_badge_count]!.trim();
    const reviewNote = values[index.review_note]!.trim();

    if (!UUID_PATTERN.test(participantId)) {
      issues.push({ rowNumber, kind: "invalid", message: "Participant ID must be a canonical UUID." });
      continue;
    }
    const countPattern = /^(0|[1-9][0-9]*)$/;
    const parseCount = (text: string): number | null => {
      if (!countPattern.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) > 10000) return null;
      return Number(text);
    };
    const skillCount = parseCount(skillText);
    const arcadeCount = parseCount(arcadeText);
    const totalCount = parseCount(totalText);
    if (skillCount === null) {
      issues.push({ rowNumber, kind: "invalid", message: "skill_badge_count must be a whole number from 0 to 10000." });
      continue;
    }
    if (arcadeCount === null) {
      issues.push({ rowNumber, kind: "invalid", message: "arcade_game_badge_count must be a whole number from 0 to 10000." });
      continue;
    }
    if (totalCount === null) {
      issues.push({ rowNumber, kind: "invalid", message: "total_badge_count must be a whole number from 0 to 10000." });
      continue;
    }
    if (skillCount + arcadeCount !== totalCount) {
      issues.push({ rowNumber, kind: "sum_mismatch", message: `skill_badge_count (${skillCount}) + arcade_game_badge_count (${arcadeCount}) must equal total_badge_count (${totalCount}). Unknown badges must be resolved before import.` });
      continue;
    }
    if (reviewNote.length < 1 || reviewNote.length > 1000 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(reviewNote)) {
      issues.push({ rowNumber, kind: "invalid", message: "Review note must contain 1 to 1000 printable characters." });
      continue;
    }
    rows.push({ rowNumber, participantId, skillBadgeCount: skillCount, arcadeGameBadgeCount: arcadeCount, totalBadgeCount: totalCount, reviewNote });
  }
  // Duplicate / conflict detection.
  const grouped = new Map<string, ClassifiedBadgeCsvRow[]>();
  for (const row of rows) grouped.set(row.participantId, [...(grouped.get(row.participantId) ?? []), row]);
  const excluded = new Set<number>();
  for (const duplicateRows of grouped.values()) {
    if (duplicateRows.length < 2) continue;
    const conflictingCounts = new Set(duplicateRows.map((row) => `${row.skillBadgeCount}/${row.arcadeGameBadgeCount}`)).size > 1;
    for (const row of duplicateRows) {
      excluded.add(row.rowNumber);
      issues.push({
        rowNumber: row.rowNumber,
        kind: conflictingCounts ? "conflict" : "duplicate",
        message: conflictingCounts
          ? "This participant has conflicting counts in the file; all matching rows were excluded."
          : "This participant appears more than once in the file; all matching rows were excluded.",
      });
    }
  }
  return { rows: rows.filter((row) => !excluded.has(row.rowNumber)), issues: issues.sort((a, b) => a.rowNumber - b.rowNumber) };
}

export function resolveClassifiedBadgeCsvRows(
  rows: readonly ClassifiedBadgeCsvRow[],
  participants: readonly ClassifiedBadgeCsvParticipant[],
): { rows: ResolvedClassifiedBadgeCsvRow[]; issues: ClassifiedBadgeCsvIssue[] } {
  const byId = new Map(participants.map((participant) => [participant.id.toLowerCase(), participant]));
  const resolved: ResolvedClassifiedBadgeCsvRow[] = [];
  const issues: ClassifiedBadgeCsvIssue[] = [];
  for (const row of rows) {
    const participant = byId.get(row.participantId);
    if (!participant) {
      issues.push({ rowNumber: row.rowNumber, kind: "unknown", message: "Participant UUID is not present in the current roster; this row was excluded." });
      continue;
    }
    resolved.push({ ...row, ...participant });
  }
  return { rows: resolved, issues };
}


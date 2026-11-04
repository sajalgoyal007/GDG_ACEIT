import type { CsvIssue } from "./csv.ts";

export interface VerifiedBadgeCsvRow {
  rowNumber: number;
  participantId: string;
  badgeCount: number;
  reviewNote: string;
}

export interface VerifiedBadgeCsvParticipant {
  id: string;
  displayName: string;
  verifiedBadgeCount: number;
  lastVerifiedAt: string | null;
  verificationSource: string | null;
}

export interface ResolvedVerifiedBadgeCsvRow extends VerifiedBadgeCsvRow, VerifiedBadgeCsvParticipant {}

export type VerifiedBadgeCsvIssueKind = CsvIssue["kind"] | "conflict" | "unknown";
export interface VerifiedBadgeCsvIssue {
  rowNumber: number;
  kind: VerifiedBadgeCsvIssueKind;
  message: string;
}

export const MAX_VERIFIED_BADGE_CSV_BYTES = 1_000_000;
export const MAX_VERIFIED_BADGE_CSV_ROWS = 500;
const HEADERS = ["participant_id", "verified_badge_count", "review_note"] as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readRecords(source: string): string[][] {
  const text = source.replace(/^\uFEFF/, "");
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;
  const finishField = () => { row.push(field); field = ""; afterQuote = false; };
  const finishRow = () => {
    finishField();
    if (row.some((value) => value.trim() !== "")) {
      records.push(row);
      if (records.length > MAX_VERIFIED_BADGE_CSV_ROWS + 1) throw new Error("CSV row limit exceeded.");
    }
    row = [];
  };
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') { quoted = false; afterQuote = true; }
      else field += character;
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

export function parseVerifiedBadgeCsv(source: string): { rows: VerifiedBadgeCsvRow[]; issues: VerifiedBadgeCsvIssue[] } {
  if (Buffer.byteLength(source, "utf8") > MAX_VERIFIED_BADGE_CSV_BYTES) {
    return { rows: [], issues: [{ rowNumber: 1, kind: "invalid", message: "CSV must be 1 MB or smaller." }] };
  }
  let records: string[][];
  try { records = readRecords(source); }
  catch (error) {
    return { rows: [], issues: [{ rowNumber: 1, kind: "invalid", message: error instanceof Error && error.message === "CSV row limit exceeded."
      ? `Import is limited to ${MAX_VERIFIED_BADGE_CSV_ROWS} data rows.`
      : "CSV formatting is invalid." }] };
  }
  if (records.length === 0) return { rows: [], issues: [{ rowNumber: 1, kind: "invalid", message: "CSV is empty." }] };
  const header = records[0]!.map((value) => value.trim().toLowerCase());
  if (header.length !== HEADERS.length || new Set(header).size !== HEADERS.length || !HEADERS.every((value) => header.includes(value))) {
    return { rows: [], issues: [{ rowNumber: 1, kind: "invalid", message: `Header must contain exactly: ${HEADERS.join(", ")}.` }] };
  }
  const index = Object.fromEntries(HEADERS.map((value) => [value, header.indexOf(value)])) as Record<(typeof HEADERS)[number], number>;
  const rows: VerifiedBadgeCsvRow[] = [];
  const issues: VerifiedBadgeCsvIssue[] = [];
  for (const [offset, values] of records.slice(1).entries()) {
    const rowNumber = offset + 2;
    if (offset >= MAX_VERIFIED_BADGE_CSV_ROWS) {
      issues.push({ rowNumber, kind: "invalid", message: `Import is limited to ${MAX_VERIFIED_BADGE_CSV_ROWS} data rows.` });
      continue;
    }
    if (values.length !== HEADERS.length) {
      issues.push({ rowNumber, kind: "invalid", message: `Expected ${HEADERS.length} columns; found ${values.length}.` });
      continue;
    }
    const participantId = values[index.participant_id]!.trim().toLowerCase();
    const countText = values[index.verified_badge_count]!.trim();
    const reviewNote = values[index.review_note]!.trim();
    if (!UUID_PATTERN.test(participantId)) {
      issues.push({ rowNumber, kind: "invalid", message: "Participant ID must be a canonical UUID." });
      continue;
    }
    if (!/^(0|[1-9][0-9]*)$/.test(countText) || !Number.isSafeInteger(Number(countText)) || Number(countText) > 10000) {
      issues.push({ rowNumber, kind: "invalid", message: "Verified badge count must be a whole number from 0 to 10000." });
      continue;
    }
    if (reviewNote.length < 1 || reviewNote.length > 1000 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(reviewNote)) {
      issues.push({ rowNumber, kind: "invalid", message: "Review note must contain 1 to 1000 printable characters." });
      continue;
    }
    rows.push({ rowNumber, participantId, badgeCount: Number(countText), reviewNote });
  }
  const grouped = new Map<string, VerifiedBadgeCsvRow[]>();
  for (const row of rows) grouped.set(row.participantId, [...(grouped.get(row.participantId) ?? []), row]);
  const excluded = new Set<number>();
  for (const duplicateRows of grouped.values()) {
    if (duplicateRows.length < 2) continue;
    const conflictingCounts = new Set(duplicateRows.map((row) => row.badgeCount)).size > 1;
    for (const row of duplicateRows) {
      excluded.add(row.rowNumber);
      issues.push({ rowNumber: row.rowNumber, kind: conflictingCounts ? "conflict" : "duplicate", message: conflictingCounts
        ? "This participant has conflicting counts in the file; all matching rows were excluded."
        : "This participant appears more than once in the file; all matching rows were excluded." });
    }
  }
  return { rows: rows.filter((row) => !excluded.has(row.rowNumber)), issues: issues.sort((a, b) => a.rowNumber - b.rowNumber) };
}

export function resolveVerifiedBadgeCsvRows(
  rows: readonly VerifiedBadgeCsvRow[],
  participants: readonly VerifiedBadgeCsvParticipant[],
): { rows: ResolvedVerifiedBadgeCsvRow[]; issues: VerifiedBadgeCsvIssue[] } {
  const byId = new Map(participants.map((participant) => [participant.id.toLowerCase(), participant]));
  const resolved: ResolvedVerifiedBadgeCsvRow[] = [];
  const issues: VerifiedBadgeCsvIssue[] = [];
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

import { validateGoogleSkillsProfileUrl } from "../auto-progress/profile-url.ts";
import type { CsvIssue } from "./csv";

export interface ProgressCsvRow {
  rowNumber: number;
  participantKey: string;
  profileUrl: string;
  normalizedProfileUrl: string;
  badgeCount: number;
}

export interface ProgressCsvParticipant {
  id: string;
  participantKey: string;
  displayName: string;
  profileUrl: string | null;
}

export interface ResolvedProgressCsvRow extends ProgressCsvRow {
  participantId: string;
  displayName: string;
}

export const MAX_PROGRESS_CSV_BYTES = 1_000_000;
export const MAX_PROGRESS_CSV_ROWS = 500;
const HEADERS = ["participant_key", "profile_url", "badge_count"] as const;

function records(source: string): string[][] {
  const text = source.replace(/^\uFEFF/, "");
  const output: string[][] = [];
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
    if (row.some((value) => value.trim() !== "")) output.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
        afterQuote = true;
      } else {
        field += character;
      }
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
  return output;
}

export function parseProgressCsv(source: string): { rows: ProgressCsvRow[]; issues: CsvIssue[] } {
  if (Buffer.byteLength(source, "utf8") > MAX_PROGRESS_CSV_BYTES) {
    return { rows: [], issues: [{ rowNumber: 1, kind: "invalid", message: "CSV must be 1 MB or smaller." }] };
  }
  let input: string[][];
  try {
    input = records(source);
  } catch (error) {
    return { rows: [], issues: [{ rowNumber: 1, kind: "invalid", message: error instanceof Error ? error.message : "CSV formatting is invalid." }] };
  }
  if (input.length === 0) return { rows: [], issues: [{ rowNumber: 1, kind: "invalid", message: "CSV is empty." }] };

  const header = input[0].map((value) => value.trim().toLowerCase());
  if (header.length !== HEADERS.length || new Set(header).size !== HEADERS.length || !HEADERS.every((item) => header.includes(item))) {
    return { rows: [], issues: [{ rowNumber: 1, kind: "invalid", message: `Header must contain exactly: ${HEADERS.join(", ")}.` }] };
  }
  const index = Object.fromEntries(HEADERS.map((item) => [item, header.indexOf(item)])) as Record<(typeof HEADERS)[number], number>;
  const parsed: ProgressCsvRow[] = [];
  const issues: CsvIssue[] = [];

  for (const [offset, values] of input.slice(1).entries()) {
    const rowNumber = offset + 2;
    if (offset >= MAX_PROGRESS_CSV_ROWS) {
      issues.push({ rowNumber, kind: "invalid", message: `Import is limited to ${MAX_PROGRESS_CSV_ROWS} rows.` });
      continue;
    }
    if (values.length !== HEADERS.length) {
      issues.push({ rowNumber, kind: "invalid", message: `Expected ${HEADERS.length} columns; found ${values.length}.` });
      continue;
    }
    const participantKey = values[index.participant_key].trim().toLowerCase();
    const profileUrl = values[index.profile_url].trim();
    const rawCount = values[index.badge_count].trim();
    if (!/^[a-z0-9][a-z0-9._:-]{0,119}$/.test(participantKey)) {
      issues.push({ rowNumber, kind: "invalid", message: "Participant key must be a valid registered key." });
      continue;
    }
    const validatedUrl = validateGoogleSkillsProfileUrl(profileUrl);
    if (!validatedUrl.ok) {
      issues.push({ rowNumber, kind: "invalid", message: "Profile URL must be a canonical HTTPS Google Skills public profile URL." });
      continue;
    }
    if (!/^(0|[1-9][0-9]*)$/.test(rawCount) || !Number.isSafeInteger(Number(rawCount)) || Number(rawCount) > 10000) {
      issues.push({ rowNumber, kind: "invalid", message: "Badge count must be a whole number from 0 to 10000." });
      continue;
    }
    parsed.push({ rowNumber, participantKey, profileUrl: validatedUrl.value.href, normalizedProfileUrl: validatedUrl.value.normalizedUrl, badgeCount: Number(rawCount) });
  }

  const keyRows = new Map<string, number[]>();
  const profileRows = new Map<string, number[]>();
  for (const row of parsed) {
    keyRows.set(row.participantKey, [...(keyRows.get(row.participantKey) ?? []), row.rowNumber]);
    profileRows.set(row.normalizedProfileUrl, [...(profileRows.get(row.normalizedProfileUrl) ?? []), row.rowNumber]);
  }
  const duplicates = new Set<number>();
  for (const rowNumbers of keyRows.values()) if (rowNumbers.length > 1) for (const n of rowNumbers) duplicates.add(n);
  for (const rowNumbers of profileRows.values()) if (rowNumbers.length > 1) for (const n of rowNumbers) duplicates.add(n);
  for (const rowNumber of duplicates) {
    issues.push({ rowNumber, kind: "duplicate", message: "This participant key or normalized profile URL appears more than once; all matching rows were excluded." });
  }
  return { rows: parsed.filter((row) => !duplicates.has(row.rowNumber)), issues: issues.sort((a, b) => a.rowNumber - b.rowNumber) };
}

export function resolveProgressCsvRows(
  rows: readonly ProgressCsvRow[],
  participants: readonly ProgressCsvParticipant[],
): { rows: ResolvedProgressCsvRow[]; issues: CsvIssue[] } {
  const byKey = new Map<string, ProgressCsvParticipant[]>();
  const byProfile = new Map<string, ProgressCsvParticipant[]>();
  for (const participant of participants) {
    const key = participant.participantKey.toLowerCase();
    byKey.set(key, [...(byKey.get(key) ?? []), participant]);
    if (participant.profileUrl) {
      const validated = validateGoogleSkillsProfileUrl(participant.profileUrl);
      if (validated.ok) byProfile.set(validated.value.normalizedUrl, [...(byProfile.get(validated.value.normalizedUrl) ?? []), participant]);
    }
  }
  const resolved: ResolvedProgressCsvRow[] = [];
  const issues: CsvIssue[] = [];
  for (const row of rows) {
    const matches = byKey.get(row.participantKey) ?? [];
    if (matches.length !== 1) {
      issues.push({ rowNumber: row.rowNumber, kind: matches.length === 0 ? "invalid" : "duplicate", message: matches.length === 0 ? "Participant key is not registered; this row was excluded." : "Participant key is ambiguous; this row was excluded." });
      continue;
    }
    const participant = matches[0];
    const validated = participant.profileUrl ? validateGoogleSkillsProfileUrl(participant.profileUrl) : null;
    if (!validated?.ok || validated.value.normalizedUrl !== row.normalizedProfileUrl) {
      issues.push({ rowNumber: row.rowNumber, kind: "invalid", message: "Profile URL does not match the participant’s current registered profile; this row was excluded." });
      continue;
    }
    if ((byProfile.get(row.normalizedProfileUrl) ?? []).length !== 1) {
      issues.push({ rowNumber: row.rowNumber, kind: "duplicate", message: "This registered profile is assigned to multiple participants; this row was excluded." });
      continue;
    }
    resolved.push({ ...row, participantId: participant.id, displayName: participant.displayName });
  }
  return { rows: resolved, issues };
}

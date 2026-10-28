import { normalizeSkillsProfileUrl } from "./profile-url.ts";

export interface ParticipantImportRow {
  rowNumber: number;
  participantKey: string;
  displayName: string;
  profileUrl: string | null;
}

export interface CsvIssue {
  rowNumber: number;
  kind: "invalid" | "duplicate";
  message: string;
}

export interface ParticipantCsvResult {
  rows: ParticipantImportRow[];
  issues: CsvIssue[];
}

interface CsvRecord {
  rowNumber: number;
  values: string[];
}

export const MAX_CSV_BYTES = 1_000_000;
export const MAX_CSV_ROWS = 500;
const REQUIRED_HEADERS = ["participant_key", "display_name", "profile_url"] as const;

function readCsvRecords(source: string): CsvRecord[] {
  const text = source.replace(/^\uFEFF/, "");
  const records: CsvRecord[] = [];
  let values: string[] = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;
  let line = 1;
  let rowNumber = 1;

  const finishField = () => {
    values.push(field);
    field = "";
    afterQuote = false;
  };
  const finishRecord = () => {
    finishField();
    if (values.some((value) => value.trim() !== "")) records.push({ rowNumber, values });
    values = [];
    line += 1;
    rowNumber = line;
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
        if (character === "\n") line += 1;
      }
      continue;
    }

    if (afterQuote && character !== "," && character !== "\r" && character !== "\n" && character.trim() !== "") {
      throw new Error(`Unexpected character after a quoted field on row ${rowNumber}.`);
    }
    if (character === ",") {
      finishField();
    } else if (character === "\r" || character === "\n") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      finishRecord();
    } else if (character === '"') {
      if (field.length > 0 || afterQuote) throw new Error(`Unexpected quote on row ${rowNumber}.`);
      quoted = true;
    } else if (!afterQuote) {
      field += character;
    }
  }

  if (quoted) throw new Error(`Unclosed quoted field on row ${rowNumber}.`);
  if (field.length > 0 || values.length > 0 || afterQuote) {
    finishField();
    if (values.some((value) => value.trim() !== "")) records.push({ rowNumber, values });
  }
  return records;
}

export function parseParticipantCsv(source: string): ParticipantCsvResult {
  if (Buffer.byteLength(source, "utf8") > MAX_CSV_BYTES) {
    return { rows: [], issues: [{ rowNumber: 1, kind: "invalid", message: "CSV must be 1 MB or smaller." }] };
  }

  let records: CsvRecord[];
  try {
    records = readCsvRecords(source);
  } catch (error) {
    return { rows: [], issues: [{ rowNumber: 1, kind: "invalid", message: error instanceof Error ? error.message : "CSV formatting is invalid." }] };
  }
  if (records.length === 0) {
    return { rows: [], issues: [{ rowNumber: 1, kind: "invalid", message: "CSV is empty." }] };
  }

  const header = records[0].values.map((value) => value.trim().toLowerCase());
  const headerIsValid = header.length === REQUIRED_HEADERS.length && REQUIRED_HEADERS.every((name) => header.includes(name)) && new Set(header).size === header.length;
  if (!headerIsValid) {
    return { rows: [], issues: [{ rowNumber: records[0].rowNumber, kind: "invalid", message: `Header must contain exactly: ${REQUIRED_HEADERS.join(", ")}.` }] };
  }

  const indexes = Object.fromEntries(REQUIRED_HEADERS.map((name) => [name, header.indexOf(name)])) as Record<(typeof REQUIRED_HEADERS)[number], number>;
  const rows: ParticipantImportRow[] = [];
  const issues: CsvIssue[] = [];
  const seenKeys = new Set<string>();

  for (const record of records.slice(1)) {
    if (rows.length >= MAX_CSV_ROWS) {
      issues.push({ rowNumber: record.rowNumber, kind: "invalid", message: `Import is limited to ${MAX_CSV_ROWS} valid rows per file.` });
      continue;
    }
    if (record.values.length !== REQUIRED_HEADERS.length) {
      issues.push({ rowNumber: record.rowNumber, kind: "invalid", message: `Expected ${REQUIRED_HEADERS.length} columns; found ${record.values.length}.` });
      continue;
    }

    const participantKey = record.values[indexes.participant_key].trim().toLowerCase();
    const displayName = record.values[indexes.display_name].trim();
    const rawProfileUrl = record.values[indexes.profile_url].trim();
    try {
      if (!/^[a-z0-9][a-z0-9._:-]{0,119}$/.test(participantKey)) {
        throw new Error("Participant key must be 1–120 characters: letters, numbers, dot, underscore, colon, or hyphen.");
      }
      if (displayName.length < 1 || displayName.length > 80 || /[\u0000-\u001f\u007f]/.test(displayName)) {
        throw new Error("Display name must be 1–80 characters and contain no control characters.");
      }
      if (seenKeys.has(participantKey)) {
        issues.push({ rowNumber: record.rowNumber, kind: "duplicate", message: `Duplicate participant key “${participantKey}” in this file; this row was skipped.` });
        continue;
      }
      const profileUrl = normalizeSkillsProfileUrl(rawProfileUrl);
      seenKeys.add(participantKey);
      rows.push({ rowNumber: record.rowNumber, participantKey, displayName, profileUrl });
    } catch (error) {
      issues.push({ rowNumber: record.rowNumber, kind: "invalid", message: error instanceof Error ? error.message : "Row is invalid." });
    }
  }
  return { rows, issues };
}


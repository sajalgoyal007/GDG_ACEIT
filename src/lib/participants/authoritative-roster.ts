import { readCsvRecords, type CsvIssue } from "./csv.ts";
import { normalizeSkillsProfileUrl } from "./profile-url.ts";

export const MAX_AUTHORITATIVE_ROSTER_BYTES = 1_000_000;

const URL_HEADERS = [
  "google skills profile url",
  "profile_url",
  "profile url",
  "public profile url",
  "public_profile_url",
];

export interface AuthoritativeRoster {
  /** Normalized, de-duplicated profile URLs. This is the only identity key. */
  urls: string[];
  rowCount: number;
  issues: CsvIssue[];
}

/**
 * Reads an organizer registration export or a roster template and extracts only
 * the public Skills profile URL column. Personal columns (email, access codes)
 * are never returned, logged, or persisted.
 */
export function parseAuthoritativeRosterCsv(source: string): AuthoritativeRoster {
  if (Buffer.byteLength(source, "utf8") > MAX_AUTHORITATIVE_ROSTER_BYTES) {
    return {
      urls: [],
      rowCount: 0,
      issues: [{ rowNumber: 1, kind: "invalid", message: "Roster CSV must be 1 MB or smaller." }],
    };
  }

  let records;
  try {
    records = readCsvRecords(source);
  } catch (error) {
    return {
      urls: [],
      rowCount: 0,
      issues: [{
        rowNumber: 1,
        kind: "invalid",
        message: error instanceof Error ? error.message : "Roster CSV formatting is invalid.",
      }],
    };
  }
  if (records.length === 0) {
    return {
      urls: [],
      rowCount: 0,
      issues: [{ rowNumber: 1, kind: "invalid", message: "Roster CSV is empty." }],
    };
  }

  const header = records[0].values.map((value) => value.trim().toLowerCase());
  const urlIndex = header.findIndex((value) => URL_HEADERS.includes(value));
  if (urlIndex < 0) {
    return {
      urls: [],
      rowCount: 0,
      issues: [{
        rowNumber: records[0].rowNumber,
        kind: "invalid",
        message: "Roster CSV must contain a Google Skills Profile URL or profile_url column.",
      }],
    };
  }

  const urls: string[] = [];
  const seen = new Set<string>();
  const issues: CsvIssue[] = [];
  let rowCount = 0;

  for (const record of records.slice(1)) {
    const raw = record.values[urlIndex]?.trim() ?? "";
    if (!raw) {
      issues.push({
        rowNumber: record.rowNumber,
        kind: "invalid",
        message: "Row has no public Skills profile URL and was excluded.",
      });
      continue;
    }
    try {
      const normalized = normalizeSkillsProfileUrl(raw);
      if (!normalized) {
        issues.push({
          rowNumber: record.rowNumber,
          kind: "invalid",
          message: "Row has no public Skills profile URL and was excluded.",
        });
        continue;
      }
      if (seen.has(normalized)) {
        issues.push({
          rowNumber: record.rowNumber,
          kind: "duplicate",
          message: "Duplicate public Skills profile URL in this roster; the repeated row was excluded.",
        });
        continue;
      }
      seen.add(normalized);
      urls.push(normalized);
      rowCount += 1;
    } catch {
      issues.push({
        rowNumber: record.rowNumber,
        kind: "invalid",
        message: "Row does not contain a valid HTTPS Google Skills public profile URL.",
      });
    }
  }

  return { urls, rowCount, issues };
}

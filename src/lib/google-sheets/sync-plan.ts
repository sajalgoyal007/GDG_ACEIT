export interface GoogleFormHeaderMap {
  headerRow: number;
  name: string;
  email: string;
  profileUrl: string;
}

export interface GoogleFormSyncRow {
  rowNumber: number;
  participantKey: string;
  displayName: string;
  profileUrl: string | null;
}

export interface GoogleFormSyncIssue {
  rowNumber: number;
  kind: "duplicate" | "invalid";
  message: string;
}

export interface ExistingSyncParticipant {
  id: string;
  participantKey: string;
  displayName: string;
  profileUrl: string | null;
  verifiedBadgeCount: number;
}

export interface SyncPreviewRecord {
  rowNumber: number;
  displayName: string;
  result: "new" | "updated" | "duplicate";
  detail: string;
}

export interface GoogleFormSyncPlan {
  rowsToApply: GoogleFormSyncRow[];
  issues: GoogleFormSyncIssue[];
  records: SyncPreviewRecord[];
  counts: { new: number; updated: number; duplicate: number; invalid: number };
}

function textCell(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

export function normalizeHeader(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function normalizeGoogleFormProfileUrl(value: string): string {
  // The response-sheet workflow requires the canonical host and path. Keep this
  // stricter than the CSV import helper, where profile URLs are optional.
  const canonicalUrl = /^https:\/\/www\.(?:cloudskillsboost|skills)\.google\/public_profiles\/([A-Za-z0-9_-]+)$/;
  if (!canonicalUrl.test(value)) {
    throw new Error("Google Skills profile URL must use https://www.skills.google/public_profiles/<profile-id> or https://www.cloudskillsboost.google/public_profiles/<profile-id>.");
  }
  return value;
}

export function prepareGoogleFormRows(
  values: readonly (readonly unknown[])[],
  mapping: GoogleFormHeaderMap,
  hmacIdentity: (normalizedEmail: string) => string,
): { rows: GoogleFormSyncRow[]; issues: GoogleFormSyncIssue[] } {
  const headerIndex = mapping.headerRow - 1;
  const rawHeader = values[headerIndex];
  if (!rawHeader || mapping.headerRow < 1 || mapping.headerRow > 20) {
    return { rows: [], issues: [{ rowNumber: Math.max(1, mapping.headerRow), kind: "invalid", message: "Configured header row is missing or outside the supported range (1–20)." }] };
  }

  const headers = rawHeader.map((cell) => normalizeHeader(cell));
  const findColumn = (configured: string) => {
    const target = normalizeHeader(configured);
    const indexes = headers.flatMap((header, index) => header === target ? [index] : []);
    return indexes.length === 1 ? indexes[0] : -1;
  };
  const columns = {
    name: findColumn(mapping.name),
    email: findColumn(mapping.email),
    profileUrl: findColumn(mapping.profileUrl),
  };
  const missing = Object.entries(columns).filter(([, index]) => index < 0).map(([key]) => key);
  if (missing.length) {
    return { rows: [], issues: [{ rowNumber: mapping.headerRow, kind: "invalid", message: `Configured header is missing or ambiguous for: ${missing.join(", ")}. Check the Google Sheets header mapping environment variables.` }] };
  }

  const issues: GoogleFormSyncIssue[] = [];
  const candidates: (GoogleFormSyncRow & { sourceEmailKey: string })[] = [];
  const dataStart = headerIndex + 1;
  const dataRows = values.slice(dataStart);
  for (let offset = 0; offset < dataRows.length; offset += 1) {
    const row = dataRows[offset];
    const rowNumber = dataStart + offset + 1;
    if (!row.some((cell) => textCell(cell) !== "")) continue;
    if (candidates.length >= 500) {
      issues.push({ rowNumber, kind: "invalid", message: "Sync is limited to 500 participant rows per run." });
      continue;
    }

    const displayName = textCell(row[columns.name]);
    const email = textCell(row[columns.email]).toLocaleLowerCase("en-US");
    const rawProfileUrl = textCell(row[columns.profileUrl]);
    if (!displayName || displayName.length > 80 || /[\u0000-\u001f\u007f]/.test(displayName)) {
      issues.push({ rowNumber, kind: "invalid", message: "Name is required and must be 1–80 characters without control characters." });
      continue;
    }
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      issues.push({ rowNumber, kind: "invalid", message: "A valid email value is required for stable matching; the email is not stored." });
      continue;
    }

    let profileUrl: string | null;
    try {
      if (!rawProfileUrl) throw new Error("Google Skills profile URL is required.");
      profileUrl = normalizeGoogleFormProfileUrl(rawProfileUrl);
    } catch (error) {
      issues.push({ rowNumber, kind: "invalid", message: error instanceof Error ? error.message : "Google Skills profile URL is invalid." });
      continue;
    }
    candidates.push({
      rowNumber,
      participantKey: `form:${hmacIdentity(email)}`,
      displayName,
      profileUrl,
      sourceEmailKey: email,
    });
  }

  const byIdentity = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    const group = byIdentity.get(candidate.participantKey) ?? [];
    group.push(candidate);
    byIdentity.set(candidate.participantKey, group);
  }
  const rejectedRows = new Set<number>();
  const deduplicated: GoogleFormSyncRow[] = [];
  for (const group of byIdentity.values()) {
    if (group.length === 1) {
      const safeRow: GoogleFormSyncRow = {
        rowNumber: group[0].rowNumber,
        participantKey: group[0].participantKey,
        displayName: group[0].displayName,
        profileUrl: group[0].profileUrl,
      };
      deduplicated.push(safeRow);
      continue;
    }
    for (const duplicate of group) {
      rejectedRows.add(duplicate.rowNumber);
      issues.push({ rowNumber: duplicate.rowNumber, kind: "duplicate", message: "The same matching identity appears more than once; all matching rows are excluded for manual review." });
    }
  }

  const byProfile = new Map<string, GoogleFormSyncRow[]>();
  for (const row of deduplicated) {
    if (!row.profileUrl) continue;
    const group = byProfile.get(row.profileUrl) ?? [];
    group.push(row);
    byProfile.set(row.profileUrl, group);
  }
  for (const group of byProfile.values()) {
    if (new Set(group.map((row) => row.participantKey)).size < 2) continue;
    for (const duplicate of group) {
      rejectedRows.add(duplicate.rowNumber);
      issues.push({ rowNumber: duplicate.rowNumber, kind: "duplicate", message: "This public profile URL appears under multiple matching identities; excluded for manual review." });
    }
  }

  return {
    rows: deduplicated.filter((row) => !rejectedRows.has(row.rowNumber)).sort((a, b) => a.rowNumber - b.rowNumber),
    issues: issues.sort((a, b) => a.rowNumber - b.rowNumber),
  };
}

export function classifyGoogleFormSync(
  rows: readonly GoogleFormSyncRow[],
  issues: readonly GoogleFormSyncIssue[],
  existing: readonly ExistingSyncParticipant[],
): GoogleFormSyncPlan {
  const byKey = new Map(existing.map((participant) => [participant.participantKey, participant]));
  const byProfile = new Map<string, ExistingSyncParticipant[]>();
  for (const participant of existing) {
    if (!participant.profileUrl) continue;
    const group = byProfile.get(participant.profileUrl) ?? [];
    group.push(participant);
    byProfile.set(participant.profileUrl, group);
  }

  const planIssues = [...issues];
  const records: SyncPreviewRecord[] = [];
  const rowsToApply: GoogleFormSyncRow[] = [];
  for (const row of rows) {
    const matched = byKey.get(row.participantKey);
    if (matched) {
      const profileUrl = row.profileUrl ?? matched.profileUrl;
      const duplicateProfiles = profileUrl ? (byProfile.get(profileUrl) ?? []).filter((participant) => participant.participantKey !== row.participantKey) : [];
      if (duplicateProfiles.length) {
        planIssues.push({ rowNumber: row.rowNumber, kind: "duplicate", message: "This public profile URL is already linked to a different participant; excluded for manual review." });
        records.push({ rowNumber: row.rowNumber, displayName: row.displayName, result: "duplicate", detail: "Profile needs manual review" });
        continue;
      }
      const changed = matched.displayName !== row.displayName || matched.profileUrl !== profileUrl;
      if (changed) {
        rowsToApply.push({ ...row, profileUrl });
        records.push({ rowNumber: row.rowNumber, displayName: row.displayName, result: "updated", detail: `Registration details will update; current badge count ${matched.verifiedBadgeCount} is preserved` });
      } else {
        records.push({ rowNumber: row.rowNumber, displayName: row.displayName, result: "duplicate", detail: "Already synchronized; no change" });
      }
      continue;
    }

    const profileMatches = row.profileUrl ? byProfile.get(row.profileUrl) ?? [] : [];
    if (profileMatches.length) {
      planIssues.push({ rowNumber: row.rowNumber, kind: "duplicate", message: "This public profile URL already belongs to a participant with a different matching identity; excluded for manual review." });
      records.push({ rowNumber: row.rowNumber, displayName: row.displayName, result: "duplicate", detail: "Possible existing participant; manual review required" });
      continue;
    }
    rowsToApply.push(row);
    records.push({ rowNumber: row.rowNumber, displayName: row.displayName, result: "new", detail: "Will be added with zero badges if no record exists" });
  }

  const duplicateRows = new Set(records.filter((record) => record.result === "duplicate").map((record) => record.rowNumber));
  for (const issue of planIssues) if (issue.kind === "duplicate") duplicateRows.add(issue.rowNumber);
  const counts = {
    new: records.filter((record) => record.result === "new").length,
    updated: records.filter((record) => record.result === "updated").length,
    duplicate: duplicateRows.size,
    invalid: planIssues.filter((issue) => issue.kind === "invalid").length,
  };
  return { rowsToApply, issues: planIssues.sort((a, b) => a.rowNumber - b.rowNumber), records, counts };
}

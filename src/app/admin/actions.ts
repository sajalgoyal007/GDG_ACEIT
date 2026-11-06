"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { MAX_CSV_BYTES, parseParticipantCsv } from "@/lib/participants/csv";
import { getAdminAuthorization } from "@/lib/supabase/admin-auth";
import { parseVerifiedBadgeCount } from "@/lib/admin-validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseProgressCsv, resolveProgressCsvRows, type ResolvedProgressCsvRow } from "@/lib/participants/progress-csv";
import { parseProgressObservationDraft } from "@/lib/participants/progress-observation";
import { buildUnverifiedObservationRpcArgs, buildVerifiedZeroRpcArgs, fetchGoogleSkillsObservedBadgeCount } from "@/lib/auto-progress/google-skills-observed-count-provider";
import { isAutoProgressEnabled } from "@/lib/auto-progress/config";
import { getObservationFailureMessage } from "@/lib/auto-progress/observation-message";
import type { ProgressObservationActionState } from "./observation-state";
import type { UnverifiedProgressPreviewState } from "./progress-import-state";
import type { AdminActionState } from "./action-state";
import { parseVerifiedBadgeCsv, resolveVerifiedBadgeCsvRows, type ResolvedVerifiedBadgeCsvRow, type VerifiedBadgeCsvIssue, type VerifiedBadgeCsvIssueKind } from "@/lib/participants/verified-badge-csv";
import type { VerifiedBadgeImportState, VerifiedBadgeImportResult } from "./verified-badge-import-state";
import {
  parseClassifiedBadgeCsv,
  resolveClassifiedBadgeCsvRows,
  type ResolvedClassifiedBadgeCsvRow,
  type ClassifiedBadgeCsvIssue,
  type ClassifiedBadgeCsvIssueKind,
  CLASSIFIED_BADGE_ISSUE_MESSAGES,
} from "@/lib/participants/classified-badge-csv";
import type {
  ClassifiedBadgeImportState,
  ClassifiedBadgeImportResult,
} from "./classified-badge-import-state";
import { MAX_AUTHORITATIVE_ROSTER_BYTES, parseAuthoritativeRosterCsv } from "@/lib/participants/authoritative-roster";
import { normalizeSkillsProfileUrl } from "@/lib/participants/profile-url";
import type { RosterRemovalCandidate, RosterRemovalPreviewState } from "./roster-removal-state";

async function requireAdminClient() {
  const authorization = await getAdminAuthorization();
  if (authorization.status !== "admin") throw new Error("Admin authorization is required.");
  return authorization.client;
}

export async function importParticipantsAction(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  if (formData.get("confirmImport") !== "confirmed") {
    return { status: "error", message: "Confirm that you reviewed this CSV before importing participants." };
  }
  const file = formData.get("participantsCsv");
  if (!(file instanceof File) || file.size < 1 || file.size > MAX_CSV_BYTES) {
    return { status: "error", message: "Choose a CSV file between 1 byte and 1 MB." };
  }

  const parsed = parseParticipantCsv(await file.text());
  if (parsed.rows.length === 0) {
    return { status: "error", message: "Nothing was imported. Review the CSV issues below.", issues: parsed.issues };
  }

  try {
    const supabase = await requireAdminClient();
    const { data, error } = await supabase.rpc("admin_import_participants", {
      p_rows: parsed.rows.map((row) => ({
        participantKey: row.participantKey,
        displayName: row.displayName,
        profileUrl: row.profileUrl,
      })),
    });
    if (error || !data) return { status: "error", message: "The database rejected this import. No rows were accepted; check the migration and row constraints.", issues: parsed.issues };

    const results = data as unknown as { csv_row_number: number; result: "imported" | "duplicate" | "removed" | "duplicate_profile" }[];
    const imported = results.filter((row) => row.result === "imported").length;
    const duplicateIssues = results.filter((row) => row.result !== "imported").map((row) => {
      const csvRow = parsed.rows[row.csv_row_number - 1];
      if (row.result === "removed") {
        return { rowNumber: csvRow?.rowNumber ?? row.csv_row_number + 1, kind: "duplicate" as const, message: `Participant key “${csvRow?.participantKey ?? "unknown"}” belongs to a removed record. Removed registrations are terminal and were not revived.` };
      }
      if (row.result === "duplicate_profile") {
        return { rowNumber: csvRow?.rowNumber ?? row.csv_row_number + 1, kind: "duplicate" as const, message: `Profile URL is already assigned to another participant. No duplicate profile was created.` };
      }
      return { rowNumber: csvRow?.rowNumber ?? row.csv_row_number + 1, kind: "duplicate" as const, message: `Participant key “${csvRow?.participantKey ?? "unknown"}” already exists. Existing profile and badge progress were left unchanged.` };
    });
    const issues = [...parsed.issues, ...duplicateIssues];
    revalidatePath("/");
    revalidatePath("/admin");
    return {
      status: imported > 0 ? "success" : "error",
      message: `${imported} participant${imported === 1 ? "" : "s"} imported; ${duplicateIssues.length} existing duplicate${duplicateIssues.length === 1 ? "" : "s"} skipped; ${parsed.issues.filter((issue) => issue.kind === "invalid").length} invalid row${parsed.issues.filter((issue) => issue.kind === "invalid").length === 1 ? "" : "s"}. Existing badge progress was not changed.`,
      issues,
    };
  } catch {
    return { status: "error", message: "Admin authorization or database access failed. Nothing was imported.", issues: parsed.issues };
  }
}

const PARTICIPANT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseRosterRemovalRows(value: FormDataEntryValue | null): RosterRemovalCandidate[] | null {
  try {
    const raw = JSON.parse(String(value ?? "")) as unknown;
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 100) return null;
    const ids = new Set<string>();
    return raw.map((item) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) throw new Error("invalid");
      const row = item as Record<string, unknown>;
      if (
        typeof row.id !== "string" ||
        !PARTICIPANT_ID_PATTERN.test(row.id) ||
        typeof row.displayName !== "string" ||
        row.displayName.trim().length < 1 ||
        typeof row.profileUrl !== "string" ||
        row.profileUrl.length < 1 ||
        row.profileUrl.length > 500 ||
        (row.registrationStatus !== "registered" && row.registrationStatus !== "pending") ||
        typeof row.verifiedBadgeCount !== "number" ||
        !Number.isInteger(row.verifiedBadgeCount) ||
        row.verifiedBadgeCount < 0 ||
        row.verifiedBadgeCount > 10000 ||
        !(row.lastVerifiedAt === null || (typeof row.lastVerifiedAt === "string" && !Number.isNaN(Date.parse(row.lastVerifiedAt))))
      ) {
        throw new Error("invalid");
      }
      const id = row.id.toLowerCase();
      if (ids.has(id)) throw new Error("duplicate");
      ids.add(id);
      return {
        id,
        displayName: row.displayName,
        profileUrl: row.profileUrl,
        registrationStatus: row.registrationStatus,
        verifiedBadgeCount: row.verifiedBadgeCount,
        lastVerifiedAt: row.lastVerifiedAt,
      };
    });
  } catch {
    return null;
  }
}

function parseAuthoritativeUrlList(value: FormDataEntryValue | null): string[] | null {
  try {
    const raw = JSON.parse(String(value ?? "")) as unknown;
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 1000) return null;
    const urls = new Set<string>();
    for (const item of raw) {
      if (typeof item !== "string" || item.length < 1 || item.length > 500) return null;
      let normalized: string | null;
      try {
        normalized = normalizeSkillsProfileUrl(item);
      } catch {
        return null;
      }
      if (!normalized || normalized !== item) return null;
      urls.add(normalized);
    }
    return [...urls];
  } catch {
    return null;
  }
}

export async function previewRosterRemovalAction(
  _previous: RosterRemovalPreviewState,
  formData: FormData,
): Promise<RosterRemovalPreviewState> {
  const file = formData.get("authoritativeRosterCsv");
  if (!(file instanceof File) || file.size < 1 || file.size > MAX_AUTHORITATIVE_ROSTER_BYTES) {
    return { status: "error", message: "Choose an authoritative registration CSV between 1 byte and 1 MB." };
  }

  const roster = parseAuthoritativeRosterCsv(await file.text());
  if (roster.urls.length === 0) {
    return {
      status: "error",
      message: "No authoritative profile URLs were found. Nothing was changed.",
      issues: roster.issues,
    };
  }

  let supabase;
  try {
    supabase = await requireAdminClient();
  } catch {
    return { status: "error", message: "Admin access could not be verified. Nothing was changed." };
  }

  const { data, error } = await supabase
    .from("participants")
    .select("id,display_name,profile_url,registration_status,verified_badge_count,last_verified_at")
    .in("registration_status", ["registered", "pending"])
    .order("display_name", { ascending: true });
  if (error || !data) {
    return { status: "error", message: "The current participant roster could not be loaded. Nothing was changed." };
  }

  const authoritative = new Set(roster.urls);
  const normalizedParticipants = data.flatMap((participant) => {
    if (!participant.profile_url) return [];
    let normalized: string | null;
    try {
      normalized = normalizeSkillsProfileUrl(participant.profile_url);
    } catch {
      return [];
    }
    return normalized ? [{ ...participant, normalized }] : [];
  });

  const candidates: RosterRemovalCandidate[] = normalizedParticipants
    .filter((participant) => !authoritative.has(participant.normalized))
    .map((participant) => ({
      id: participant.id,
      displayName: participant.display_name,
      profileUrl: participant.profile_url as string,
      registrationStatus: participant.registration_status as "registered" | "pending",
      verifiedBadgeCount: participant.verified_badge_count,
      lastVerifiedAt: participant.last_verified_at,
    }));
  const matchedCount = normalizedParticipants.filter((participant) => authoritative.has(participant.normalized)).length;
  const matchedUrls = new Set(normalizedParticipants.map((participant) => participant.normalized));
  const missingAuthoritativeCount = roster.urls.filter((url) => !matchedUrls.has(url)).length;

  if (candidates.length === 0) {
    return {
      status: "error",
      message: `No records need removal. All ${matchedCount} matched profiles appear in the authoritative roster. Nothing was changed.`,
      issues: roster.issues,
      authoritativeUrls: roster.urls,
      authoritativeCount: roster.urls.length,
      matchedCount,
      missingAuthoritativeCount,
    };
  }

  return {
    status: "preview",
    message: `Preview ready: ${candidates.length} production-only record${candidates.length === 1 ? "" : "s"} can be soft-removed; ${matchedCount} profiles match the authoritative roster. Review the list before confirming.`,
    issues: roster.issues,
    rows: candidates,
    authoritativeUrls: roster.urls,
    authoritativeCount: roster.urls.length,
    matchedCount,
    missingAuthoritativeCount,
  };
}

export async function applyRosterRemovalAction(
  _previous: RosterRemovalPreviewState,
  formData: FormData,
): Promise<RosterRemovalPreviewState> {
  if (formData.get("confirmRosterRemoval") !== "confirmed") {
    return { status: "error", message: "Confirm that you reviewed the preview before removing participants." };
  }
  const reason = String(formData.get("removalReason") ?? "").trim();
  if (reason.length < 8 || reason.length > 1000) {
    return { status: "error", message: "Add a removal reason between 8 and 1000 characters." };
  }
  const previewRows = parseRosterRemovalRows(formData.get("previewRows"));
  const authoritativeUrls = parseAuthoritativeUrlList(formData.get("authoritativeUrls"));
  if (!previewRows || !authoritativeUrls) {
    return { status: "error", message: "The removal preview is invalid or expired. Preview the roster again; nothing was changed." };
  }

  let supabase;
  try {
    supabase = await requireAdminClient();
  } catch {
    return { status: "error", message: "Admin access could not be verified. Nothing was changed." };
  }

  const currentRows: { id: string; profile_url: string | null; registration_status: string }[] = [];
  for (let offset = 0; offset < previewRows.length; offset += 100) {
    const { data, error } = await supabase
      .from("participants")
      .select("id,profile_url,registration_status")
      .in("id", previewRows.slice(offset, offset + 100).map((row) => row.id));
    if (error || !data) {
      return { status: "error", message: "The participant roster could not be rechecked. Nothing was changed." };
    }
    currentRows.push(...data);
  }

  const currentById = new Map(currentRows.map((row) => [row.id.toLowerCase(), row]));
  const authoritative = new Set(authoritativeUrls);
  for (const row of previewRows) {
    const current = currentById.get(row.id);
    if (!current || current.profile_url !== row.profileUrl || (current.registration_status !== "registered" && current.registration_status !== "pending")) {
      return { status: "error", message: "A participant changed after preview. Preview the roster again; nothing was changed." };
    }
    const profileUrl = current.profile_url;
    if (!profileUrl) {
      return { status: "error", message: "A participant has no public profile URL. Preview the roster again; nothing was changed." };
    }
    let normalized: string | null;
    try {
      normalized = normalizeSkillsProfileUrl(profileUrl);
    } catch {
      return { status: "error", message: "A participant profile URL is invalid. Preview the roster again; nothing was changed." };
    }
    if (!normalized || authoritative.has(normalized)) {
      return { status: "error", message: "A participant is now present in the authoritative roster. Preview the roster again; nothing was changed." };
    }
  }

  // Include stored URL spellings for every authoritative participant so the
  // database guard rejects a removal even when a URL has cosmetic variations.
  const { data: allRows, error: allError } = await supabase
    .from("participants")
    .select("profile_url,registration_status")
    .in("registration_status", ["registered", "pending"]);
  if (allError || !allRows) {
    return { status: "error", message: "The authoritative guard set could not be built. Nothing was changed." };
  }
  const guardUrls = new Set(authoritativeUrls);
  for (const row of allRows) {
    if (!row.profile_url) continue;
    try {
      const normalized = normalizeSkillsProfileUrl(row.profile_url);
      if (normalized && authoritative.has(normalized)) guardUrls.add(row.profile_url);
    } catch {
      // A malformed stored URL is not authoritative and cannot match a roster URL.
    }
  }

  const { data, error } = await supabase.rpc("admin_remove_participants", {
    p_participant_ids: previewRows.map((row) => row.id),
    p_reason: reason,
    p_authoritative_profile_urls: [...guardUrls],
  });
  if (error || !data) {
    return { status: "error", message: "The database rejected this removal request. Nothing was changed; preview the roster again." };
  }

  const results = data as unknown as { participant_id: string; result: "removed" | "already_removed"; previous_status: string }[];
  const removed = results.filter((row) => row.result === "removed").length;
  const alreadyRemoved = results.filter((row) => row.result === "already_removed").length;
  if (removed + alreadyRemoved !== previewRows.length) {
    return { status: "error", message: "The database returned an incomplete removal result. Review the audit history before retrying." };
  }
  revalidatePath("/");
  revalidatePath("/progress");
  revalidatePath("/admin");
  return {
    status: "success",
    message: `${removed} participant${removed === 1 ? "" : "s"} soft-removed; ${alreadyRemoved} already removed. Rows, badge history, and audit history were preserved.`,
  };
}

export async function previewUnverifiedProgressAction(
  _previous: UnverifiedProgressPreviewState,
  formData: FormData,
): Promise<UnverifiedProgressPreviewState> {
  const file = formData.get("progressCsv");
  if (!(file instanceof File) || file.size < 1 || file.size > 1_000_000) {
    return { status: "error", message: "Choose a progress CSV between 1 byte and 1 MB." };
  }
  const parsed = parseProgressCsv(await file.text());
  let authorization;
  try {
    authorization = await getAdminAuthorization();
  } catch {
    return { status: "error", message: "Admin access could not be verified. No progress was imported." };
  }
  if (authorization.status !== "admin") return { status: "error", message: "Admin access is required. No progress was imported." };
  if (parsed.rows.length === 0) return { status: "error", message: "No valid rows were found. Review the CSV issues below.", issues: parsed.issues };

  const { data, error } = await authorization.client
    .from("participants")
    .select("id,participant_key,display_name,profile_url")
    .eq("registration_status", "registered")
    .order("id", { ascending: true });
  if (error || !data) return { status: "error", message: "Registered participants could not be loaded. No progress was imported." };
  const resolved = resolveProgressCsvRows(parsed.rows, data.map((participant) => ({
    id: participant.id,
    participantKey: participant.participant_key,
    displayName: participant.display_name,
    profileUrl: participant.profile_url,
  })));
  const issues = [...parsed.issues, ...resolved.issues].sort((a, b) => a.rowNumber - b.rowNumber);
  return {
    status: resolved.rows.length ? "preview" : "error",
    message: resolved.rows.length
      ? `Preview ready: ${resolved.rows.length} valid row${resolved.rows.length === 1 ? "" : "s"}; ${issues.length} row${issues.length === 1 ? "" : "s"} excluded.`
      : "No rows match a unique, current registered profile. Nothing was imported.",
    issues,
    rows: resolved.rows,
  };
}

export async function applyUnverifiedProgressAction(
  _previous: UnverifiedProgressPreviewState,
  formData: FormData,
): Promise<UnverifiedProgressPreviewState> {
  if (formData.get("confirmProgressImport") !== "confirmed") {
    return { status: "error", message: "Confirm the preview before importing unverified progress." };
  }
  let rows: ResolvedProgressCsvRow[];
  try {
    const raw = JSON.parse(String(formData.get("previewRows") ?? "")) as unknown;
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 500) throw new Error("invalid");
    rows = raw.map((row) => {
      if (typeof row !== "object" || row === null) throw new Error("invalid");
      const value = row as Record<string, unknown>;
      if (typeof value.participantId !== "string" || typeof value.participantKey !== "string"
        || typeof value.profileUrl !== "string" || typeof value.badgeCount !== "number"
        || !Number.isSafeInteger(value.badgeCount) || value.badgeCount < 0 || value.badgeCount > 10000) throw new Error("invalid");
      return value as unknown as ResolvedProgressCsvRow;
    });
  } catch {
    return { status: "error", message: "The preview is invalid or expired. Preview the CSV again; no progress was imported." };
  }

  try {
    const supabase = await requireAdminClient();
    const { data, error } = await supabase.rpc("admin_import_unverified_progress", {
      p_rows: rows.map((row) => ({
        participant_id: row.participantId,
        participant_key: row.participantKey,
        profile_url: row.profileUrl,
        badge_count: row.badgeCount,
      })),
    });
    if (error || !data?.length) return { status: "error", message: "The database rejected this preview because a participant or profile changed. Nothing was imported; preview again." };
    const result = data[0] as { imported_count: number; imported_at: string };
    revalidatePath("/");
    revalidatePath("/progress");
    revalidatePath("/admin");
    return { status: "success", message: `${result.imported_count} unverified progress row${result.imported_count === 1 ? "" : "s"} imported. Verified counts and automatic ranks were unchanged.` };
  } catch {
    return { status: "error", message: "Admin authorization or database access failed. No progress was imported." };
  }
}

export async function recordProgressObservationAction(
  _previous: ProgressObservationActionState,
  formData: FormData,
): Promise<ProgressObservationActionState> {
  if (formData.get("confirmObservation") !== "confirmed") {
    return { status: "error", message: "Confirm that the source values are diagnostic and unverified." };
  }
  let identity: { participantKey: string; profileUrl: string };
  try {
    const value = JSON.parse(String(formData.get("participantIdentity") ?? "")) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("invalid");
    const row = value as Record<string, unknown>;
    if (Object.keys(row).length !== 2 || typeof row.participantKey !== "string" || typeof row.profileUrl !== "string") throw new Error("invalid");
    identity = { participantKey: row.participantKey, profileUrl: row.profileUrl };
  } catch {
    return { status: "error", message: "Choose one registered participant and profile from the list." };
  }
  const draft = parseProgressObservationDraft({
    participantKey: identity.participantKey,
    profileUrl: identity.profileUrl,
    sourceName: String(formData.get("sourceName") ?? ""),
    retrievedAt: String(formData.get("retrievedAt") ?? ""),
    httpStatus: String(formData.get("httpStatus") ?? ""),
    reportedTotal: String(formData.get("reportedTotal") ?? ""),
    detailCount: String(formData.get("detailCount") ?? ""),
    uniqueBadgeCount: String(formData.get("uniqueBadgeCount") ?? ""),
    completenessStatus: String(formData.get("completenessStatus") ?? ""),
    summaryNote: String(formData.get("summaryNote") ?? ""),
  });
  if (!draft.ok) return { status: "error", message: draft.message };

  try {
    const supabase = await requireAdminClient();
    const { data, error } = await supabase.rpc("admin_record_progress_observation", {
      p_participant_key: draft.value.participantKey,
      p_profile_url: draft.value.profileUrl,
      p_source_name: draft.value.sourceName,
      p_retrieved_at: draft.value.retrievedAt,
      p_http_status: draft.value.httpStatus,
      p_reported_total: draft.value.reportedTotal,
      p_detail_count: draft.value.detailCount,
      p_unique_badge_count: draft.value.uniqueBadgeCount,
      p_completeness_status: draft.value.completenessStatus,
      p_summary_note: draft.value.summaryNote,
    });
    if (error || !data?.length) return { status: "error", message: "The database rejected this observation because the registered identity changed or is ambiguous. No record was added." };
    revalidatePath("/");
    revalidatePath("/progress");
    revalidatePath("/admin");
    return { status: "success", message: "Diagnostic observation recorded with source provenance. It remains unverified and does not affect verified counts, automatic snapshots, or ranks." };
  } catch {
    return { status: "error", message: "Admin authorization or database access failed. No diagnostic observation was recorded." };
  }
}

/** Fetches one registered public profile and records only an unverified card-candidate observation. */
export async function fetchProgressObservationAction(
  _previous: ProgressObservationActionState,
  formData: FormData,
): Promise<ProgressObservationActionState> {
  const participantKey = String(formData.get("participantKey") ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._:-]{0,119}$/.test(participantKey)) {
    return { status: "error", message: "Choose a registered participant." };
  }
  if (formData.get("confirmOwnerZeroPolicy") !== "confirmed") {
    return { status: "error", message: "Confirm the owner-approved zero policy before checking this profile." };
  }
  if (!isAutoProgressEnabled()) return { status: "error", message: "Public profile observation is disabled. No request was made." };

  try {
    const supabase = await requireAdminClient();
    const { data: participant, error: participantError } = await supabase
      .from("participants")
      .select("id,profile_url")
      .eq("participant_key", participantKey)
      .eq("registration_status", "registered")
      .maybeSingle();
    if (participantError || !participant?.profile_url) {
      return { status: "error", message: "The registered participant profile could not be resolved. No request was made." };
    }

    const { data: claimData, error: claimError } = await supabase.rpc("claim_google_skills_observation_cooldown", {
      p_participant_key: participantKey,
      p_profile_url: participant.profile_url,
    });
    const claim = Array.isArray(claimData) ? claimData[0] as { claim_status?: string; retry_after_seconds?: number } | undefined : undefined;
    if (claimError || !claim || claim.claim_status !== "claimed") {
      return { status: "error", message: claim?.claim_status === "cooldown"
        ? `This profile was checked recently. Try again in about ${Math.max(1, Math.min(3600, Number(claim.retry_after_seconds) || 60))} seconds.`
        : "The profile changed, is ambiguous, or could not be safely claimed. No request was made." };
    }

    const observed = await fetchGoogleSkillsObservedBadgeCount(participant.profile_url);
    if (observed.status === "confirmed_zero") {
      const verificationArgs = buildVerifiedZeroRpcArgs(observed, participant.id);
      if (!verificationArgs) return { status: "error", message: "The zero result did not meet the audited verification requirements. No count was changed." };
      const { data, error } = await supabase.rpc("admin_set_verified_badge_count", verificationArgs);
      if (error || !data?.length) return { status: "error", message: "The audited zero verification failed. The previous verified count was preserved." };
      revalidatePath("/");
      revalidatePath("/progress");
      revalidatePath("/admin");
      return { status: "success", message: "Verified badge count recorded as 0 under the owner-approved missing-section policy. The authenticated admin, review note, previous value, and verification time were recorded by the existing audit workflow." };
    }
    if (observed.status !== "unverified") {
      return { status: "error", message: getObservationFailureMessage(observed.status) };
    }

    const observationArgs = buildUnverifiedObservationRpcArgs(observed, participantKey, participant.profile_url);
    if (!observationArgs) return { status: "error", message: "The profile result was not eligible for an unverified observation. Nothing was recorded." };
    const { error } = await supabase.rpc("admin_record_progress_observation", observationArgs);
    if (error) return { status: "error", message: "The profile changed or became ambiguous before the observation was saved. No record was added." };
    revalidatePath("/");
    revalidatePath("/progress");
    revalidatePath("/admin");
    return { status: "success", message: `Recorded ${observed.candidateCount} observed badge-card candidates as unverified. This is not a confirmed total and did not change verified counts, automatic snapshots, or ranks.` };
  } catch {
    return { status: "error", message: "Admin authorization, profile retrieval, or observation storage failed. No verified progress was changed." };
  }
}

export async function setVerifiedBadgeCountAction(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  if (formData.get("confirmBadgeUpdate") !== "confirmed") {
    return { status: "error", message: "Confirm that you reviewed the evidence before recording this badge count." };
  }
  const participantId = String(formData.get("participantId") ?? "");
  const countValue = String(formData.get("verifiedBadgeCount") ?? "");
  const note = String(formData.get("verificationNote") ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(participantId)) {
    return { status: "error", message: "Choose a valid participant." };
  }
  const badgeCount = parseVerifiedBadgeCount(countValue);
  if (badgeCount === null) {
    return { status: "error", message: "Badge count must be a whole number from 0 to 10000." };
  }
  if (note.length < 1 || note.length > 1000) {
    return { status: "error", message: "Add a verification note between 1 and 1000 characters." };
  }

  try {
    const supabase = await requireAdminClient();
    const { data, error } = await supabase.rpc("admin_set_verified_badge_count", {
      p_participant_id: participantId,
      p_badge_count: badgeCount,
      p_note: note,
    });
    if (error || !data?.length) return { status: "error", message: "The database rejected the verification update." };
    const result = (data as unknown as { previous_badge_count: number; new_badge_count: number }[])[0];
    revalidatePath("/");
    revalidatePath("/admin");
    return { status: "success", message: result.previous_badge_count === result.new_badge_count
      ? `Verified badge count remains ${result.new_badge_count}. An identical prior review was already recorded, so its audit history was preserved without adding a duplicate.`
      : `Badge count recorded: ${result.previous_badge_count} → ${result.new_badge_count}. The actor and verification timestamp were added to the audit log.` };
  } catch {
    return { status: "error", message: "Admin authorization or database access failed. No count was changed." };
  }
}

const VERIFIED_BADGE_ISSUE_MESSAGES: Record<VerifiedBadgeCsvIssueKind, string> = {
  invalid: "Invalid CSV row; it was excluded.",
  duplicate: "Duplicate participant row; all matching rows were excluded.",
  conflict: "Conflicting counts for this participant; all matching rows were excluded.",
  unknown: "Participant UUID is not present in the current roster; this row was excluded.",
};

export async function previewVerifiedBadgeCsvAction(
  _previous: VerifiedBadgeImportState,
  formData: FormData,
): Promise<VerifiedBadgeImportState> {
  const file = formData.get("verifiedBadgeCsv");
  if (!(file instanceof File) || file.size < 1 || file.size > 1_000_000) {
    return { status: "error", message: "Choose a verified-count CSV between 1 byte and 1 MB." };
  }
  let supabase;
  try { supabase = await requireAdminClient(); }
  catch { return { status: "error", message: "Admin access could not be verified. No count was changed." }; }

  const parsed = parseVerifiedBadgeCsv(await file.text());
  const issues: VerifiedBadgeCsvIssue[] = [...parsed.issues];
  const participants: { id: string; display_name: string; verified_badge_count: number; last_verified_at: string | null; verification_source: string | null }[] = [];
  const ids = parsed.rows.map((row) => row.participantId);
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { data, error } = await supabase.from("participants")
      .select("id,display_name,verified_badge_count,last_verified_at,verification_source")
      .in("id", ids.slice(offset, offset + 100));
    if (error || !data) return { status: "error", message: "The participant roster could not be checked. Nothing was changed." };
    participants.push(...data);
  }
  const resolved = resolveVerifiedBadgeCsvRows(parsed.rows, participants.map((participant) => ({
    id: participant.id,
    displayName: participant.display_name,
    verifiedBadgeCount: participant.verified_badge_count,
    lastVerifiedAt: participant.last_verified_at,
    verificationSource: participant.verification_source,
  })));
  issues.push(...resolved.issues);
  const orderedIssues = issues.sort((a, b) => a.rowNumber - b.rowNumber);
  return {
    status: "preview",
    message: resolved.rows.length
      ? `Preview ready: ${resolved.rows.length} eligible verification${resolved.rows.length === 1 ? "" : "s"}; ${orderedIssues.length} invalid, duplicate, conflicting, or unknown row${orderedIssues.length === 1 ? "" : "s"} excluded.`
      : "No eligible rows were found. Review the skipped rows; no counts have been changed.",
    issues: orderedIssues,
    rows: resolved.rows,
  };
}

function parseVerifiedPreviewRows(value: FormDataEntryValue | null): ResolvedVerifiedBadgeCsvRow[] | null {
  try {
    const raw = JSON.parse(String(value ?? "")) as unknown;
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 500) return null;
    const ids = new Set<string>();
    return raw.map((item) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) throw new Error("invalid");
      const row = item as Record<string, unknown>;
      if (typeof row.rowNumber !== "number" || !Number.isInteger(row.rowNumber) || row.rowNumber < 2 || row.rowNumber > 501
        || typeof row.participantId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.participantId)
        || typeof row.badgeCount !== "number" || !Number.isInteger(row.badgeCount) || row.badgeCount < 0 || row.badgeCount > 10000
        || typeof row.reviewNote !== "string" || row.reviewNote.trim().length < 1 || row.reviewNote.trim().length > 1000
        || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(row.reviewNote)
        || typeof row.displayName !== "string" || typeof row.verifiedBadgeCount !== "number"
        || !Number.isInteger(row.verifiedBadgeCount) || row.verifiedBadgeCount < 0 || row.verifiedBadgeCount > 10000
        || !(row.lastVerifiedAt === null || (typeof row.lastVerifiedAt === "string" && !Number.isNaN(Date.parse(row.lastVerifiedAt))))
        || !(row.verificationSource === null || typeof row.verificationSource === "string")) throw new Error("invalid");
      const participantId = row.participantId.toLowerCase();
      if (ids.has(participantId)) throw new Error("duplicate");
      ids.add(participantId);
      return {
        rowNumber: row.rowNumber,
        participantId,
        badgeCount: row.badgeCount,
        reviewNote: row.reviewNote.trim(),
        id: participantId,
        displayName: row.displayName,
        verifiedBadgeCount: row.verifiedBadgeCount,
        lastVerifiedAt: row.lastVerifiedAt,
        verificationSource: row.verificationSource,
      };
    });
  } catch { return null; }
}

function parseVerifiedPreviewIssues(value: FormDataEntryValue | null): VerifiedBadgeCsvIssue[] {
  try {
    const raw = JSON.parse(String(value ?? "[]")) as unknown;
    if (!Array.isArray(raw) || raw.length > 1000) return [];
    return raw.flatMap((item): VerifiedBadgeCsvIssue[] => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
      const row = item as Record<string, unknown>;
      if (typeof row.rowNumber !== "number" || !Number.isInteger(row.rowNumber) || row.rowNumber < 1 || row.rowNumber > 501
        || typeof row.kind !== "string" || !Object.hasOwn(VERIFIED_BADGE_ISSUE_MESSAGES, row.kind)) return [];
      const kind = row.kind as VerifiedBadgeCsvIssueKind;
      return [{ rowNumber: row.rowNumber, kind, message: VERIFIED_BADGE_ISSUE_MESSAGES[kind] }];
    });
  } catch { return []; }
}

export async function applyVerifiedBadgeCsvAction(
  _previous: VerifiedBadgeImportState,
  formData: FormData,
): Promise<VerifiedBadgeImportState> {
  if (formData.get("confirmVerifiedBadgeImport") !== "confirmed") {
    return { status: "error", message: "Confirm that you reviewed the complete preview before recording verified counts." };
  }
  const rows = parseVerifiedPreviewRows(formData.get("previewRows"));
  if (!rows) return { status: "error", message: "The preview is invalid or expired. Preview the CSV again; no counts were changed." };
  let supabase;
  try { supabase = await requireAdminClient(); }
  catch { return { status: "error", message: "Admin access could not be verified. No counts were changed." }; }

  const currentRows: { id: string; verified_badge_count: number; last_verified_at: string | null; verification_source: string | null }[] = [];
  for (let offset = 0; offset < rows.length; offset += 100) {
    const { data, error } = await supabase.from("participants")
      .select("id,verified_badge_count,last_verified_at,verification_source")
      .in("id", rows.slice(offset, offset + 100).map((row) => row.participantId));
    if (error || !data) return { status: "error", message: "The participant roster could not be rechecked. No counts were changed." };
    currentRows.push(...data);
  }
  const currentById = new Map(currentRows.map((participant) => [participant.id.toLowerCase(), participant]));
  const issues = parseVerifiedPreviewIssues(formData.get("previewIssues"));
  const results: VerifiedBadgeImportResult[] = [];
  const eligible: ResolvedVerifiedBadgeCsvRow[] = [];
  for (const row of rows) {
    const participant = currentById.get(row.participantId);
    if (!participant) {
      results.push({ rowNumber: row.rowNumber, participantId: row.participantId, badgeCount: row.badgeCount, status: "skipped", reason: "Participant is no longer present in the roster." });
      continue;
    }
    const previewStateChanged = participant.verified_badge_count !== row.verifiedBadgeCount
      || participant.last_verified_at !== row.lastVerifiedAt
      || participant.verification_source !== row.verificationSource;
    if (previewStateChanged && participant.verified_badge_count !== row.badgeCount) {
      results.push({ rowNumber: row.rowNumber, participantId: row.participantId, badgeCount: row.badgeCount, status: "skipped", reason: "Verified count changed after preview; preview the CSV again." });
      continue;
    }
    eligible.push(row);
  }

  if (eligible.length > 0) {
    const { data, error } = await supabase.rpc("admin_bulk_set_verified_badge_counts", {
      p_rows: eligible.map((row) => ({
        row_number: row.rowNumber,
        participant_id: row.participantId,
        badge_count: row.badgeCount,
        review_note: row.reviewNote,
        expected_badge_count: row.verifiedBadgeCount,
        expected_last_verified_at: row.lastVerifiedAt,
        expected_verification_source: row.verificationSource,
      })),
    });
    if (error || !data) {
      for (const row of eligible) results.push({ rowNumber: row.rowNumber, participantId: row.participantId, badgeCount: row.badgeCount, status: "failed", reason: "The verification transaction failed. No eligible row in this batch was changed; preview again." });
    } else {
      const appliedRows = data as unknown as { row_number: number; participant_id: string; new_badge_count: number }[];
      const appliedByRow = new Map(appliedRows.map((row) => [row.row_number, row]));
      for (const row of eligible) {
        const applied = appliedByRow.get(row.rowNumber);
        results.push(applied
          ? { rowNumber: row.rowNumber, participantId: row.participantId, badgeCount: applied.new_badge_count, status: "success", reason: "Recorded through the audited admin verification workflow." }
          : { rowNumber: row.rowNumber, participantId: row.participantId, badgeCount: row.badgeCount, status: "failed", reason: "The database returned an incomplete result; verify the audit history before retrying." });
      }
    }
  }
  const skipped = results.filter((result) => result.status === "skipped").length + issues.length;
  const failed = results.filter((result) => result.status === "failed").length;
  const succeeded = results.filter((result) => result.status === "success").length;
  revalidatePath("/");
  revalidatePath("/admin");
  return {
    status: failed > 0 && succeeded === 0 ? "error" : "success",
    message: `${succeeded} verified, ${skipped} skipped, ${failed} failed. All verified writes use the authenticated audited badge-verification workflow.`,
    issues,
    results,
  };
}

export async function previewClassifiedBadgeCsvAction(
  _previous: ClassifiedBadgeImportState,
  formData: FormData,
): Promise<ClassifiedBadgeImportState> {
  const file = formData.get("classifiedBadgeCsv");
  if (!(file instanceof File) || file.size < 1 || file.size > 1_000_000) {
    return { status: "error", message: "Choose a classified badge CSV between 1 byte and 1 MB." };
  }
  let supabase;
  try {
    supabase = await requireAdminClient();
  } catch {
    return { status: "error", message: "Admin access could not be verified. No count was changed." };
  }

  const parsed = parseClassifiedBadgeCsv(await file.text());
  const issues: ClassifiedBadgeCsvIssue[] = [...parsed.issues];
  const participants: {
    id: string;
    display_name: string;
    verified_badge_count: number;
    skill_badge_count: number | null;
    arcade_game_badge_count: number | null;
    last_verified_at: string | null;
    verification_source: string | null;
  }[] = [];
  const ids = parsed.rows.map((row) => row.participantId);
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { data, error } = await supabase
      .from("participants")
      .select("id,display_name,verified_badge_count,skill_badge_count,arcade_game_badge_count,last_verified_at,verification_source")
      .in("id", ids.slice(offset, offset + 100));
    if (error || !data) {
      return { status: "error", message: "The participant roster could not be checked. Nothing was changed." };
    }
    participants.push(...data);
  }
  const resolved = resolveClassifiedBadgeCsvRows(
    parsed.rows,
    participants.map((participant) => ({
      id: participant.id,
      displayName: participant.display_name,
      verifiedBadgeCount: participant.verified_badge_count,
      currentSkillBadgeCount: participant.skill_badge_count ?? null,
      currentArcadeGameBadgeCount: participant.arcade_game_badge_count ?? null,
      lastVerifiedAt: participant.last_verified_at,
      verificationSource: participant.verification_source,
    })),
  );
  issues.push(...resolved.issues);
  const orderedIssues = issues.sort((a, b) => a.rowNumber - b.rowNumber);
  return {
    status: "preview",
    message: resolved.rows.length
      ? `Preview ready: ${resolved.rows.length} eligible classified verification${resolved.rows.length === 1 ? "" : "s"}; ${orderedIssues.length} invalid, duplicate, conflicting, sum mismatch, or unknown row${orderedIssues.length === 1 ? "" : "s"} excluded.`
      : "No eligible rows were found. Review the skipped rows; no counts have been changed.",
    issues: orderedIssues,
    rows: resolved.rows,
  };
}

function parseClassifiedPreviewRows(value: FormDataEntryValue | null): ResolvedClassifiedBadgeCsvRow[] | null {
  try {
    const raw = JSON.parse(String(value ?? "")) as unknown;
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 500) return null;
    const ids = new Set<string>();
    return raw.map((item) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) throw new Error("invalid");
      const row = item as Record<string, unknown>;
      if (
        typeof row.rowNumber !== "number" ||
        !Number.isInteger(row.rowNumber) ||
        row.rowNumber < 2 ||
        row.rowNumber > 501 ||
        typeof row.participantId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.participantId) ||
        typeof row.skillBadgeCount !== "number" ||
        !Number.isInteger(row.skillBadgeCount) ||
        row.skillBadgeCount < 0 ||
        row.skillBadgeCount > 10000 ||
        typeof row.arcadeGameBadgeCount !== "number" ||
        !Number.isInteger(row.arcadeGameBadgeCount) ||
        row.arcadeGameBadgeCount < 0 ||
        row.arcadeGameBadgeCount > 10000 ||
        typeof row.totalBadgeCount !== "number" ||
        !Number.isInteger(row.totalBadgeCount) ||
        row.totalBadgeCount < 0 ||
        row.totalBadgeCount > 10000 ||
        row.skillBadgeCount + row.arcadeGameBadgeCount !== row.totalBadgeCount ||
        typeof row.reviewNote !== "string" ||
        row.reviewNote.trim().length < 1 ||
        row.reviewNote.trim().length > 1000 ||
        /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(row.reviewNote) ||
        typeof row.displayName !== "string" ||
        typeof row.verifiedBadgeCount !== "number" ||
        !Number.isInteger(row.verifiedBadgeCount) ||
        row.verifiedBadgeCount < 0 ||
        row.verifiedBadgeCount > 10000 ||
        !(row.currentSkillBadgeCount === null || (typeof row.currentSkillBadgeCount === "number" && Number.isInteger(row.currentSkillBadgeCount) && row.currentSkillBadgeCount >= 0)) ||
        !(row.currentArcadeGameBadgeCount === null || (typeof row.currentArcadeGameBadgeCount === "number" && Number.isInteger(row.currentArcadeGameBadgeCount) && row.currentArcadeGameBadgeCount >= 0)) ||
        !(row.lastVerifiedAt === null || (typeof row.lastVerifiedAt === "string" && !Number.isNaN(Date.parse(row.lastVerifiedAt)))) ||
        !(row.verificationSource === null || typeof row.verificationSource === "string")
      ) {
        throw new Error("invalid");
      }
      const participantId = row.participantId.toLowerCase();
      if (ids.has(participantId)) throw new Error("duplicate");
      ids.add(participantId);
      return {
        rowNumber: row.rowNumber,
        participantId,
        skillBadgeCount: row.skillBadgeCount,
        arcadeGameBadgeCount: row.arcadeGameBadgeCount,
        totalBadgeCount: row.totalBadgeCount,
        reviewNote: row.reviewNote.trim(),
        id: participantId,
        displayName: row.displayName,
        verifiedBadgeCount: row.verifiedBadgeCount,
        currentSkillBadgeCount: row.currentSkillBadgeCount ?? null,
        currentArcadeGameBadgeCount: row.currentArcadeGameBadgeCount ?? null,
        lastVerifiedAt: row.lastVerifiedAt,
        verificationSource: row.verificationSource,
      };
    });
  } catch {
    return null;
  }
}

function parseClassifiedPreviewIssues(value: FormDataEntryValue | null): ClassifiedBadgeCsvIssue[] {
  try {
    const raw = JSON.parse(String(value ?? "[]")) as unknown;
    if (!Array.isArray(raw) || raw.length > 1000) return [];
    return raw.flatMap((item): ClassifiedBadgeCsvIssue[] => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
      const row = item as Record<string, unknown>;
      if (
        typeof row.rowNumber !== "number" ||
        !Number.isInteger(row.rowNumber) ||
        row.rowNumber < 1 ||
        row.rowNumber > 501 ||
        typeof row.kind !== "string" ||
        !Object.hasOwn(CLASSIFIED_BADGE_ISSUE_MESSAGES, row.kind)
      ) {
        return [];
      }
      const kind = row.kind as ClassifiedBadgeCsvIssueKind;
      return [{ rowNumber: row.rowNumber, kind, message: CLASSIFIED_BADGE_ISSUE_MESSAGES[kind] }];
    });
  } catch {
    return [];
  }
}

export async function applyClassifiedBadgeCsvAction(
  _previous: ClassifiedBadgeImportState,
  formData: FormData,
): Promise<ClassifiedBadgeImportState> {
  if (formData.get("confirmClassifiedBadgeImport") !== "confirmed") {
    return { status: "error", message: "Confirm that you reviewed the complete preview before recording classified counts." };
  }
  const rows = parseClassifiedPreviewRows(formData.get("previewRows"));
  if (!rows) return { status: "error", message: "The preview is invalid or expired. Preview the CSV again; no counts were changed." };
  let supabase;
  try {
    supabase = await requireAdminClient();
  } catch {
    return { status: "error", message: "Admin access could not be verified. No counts were changed." };
  }

  const currentRows: { id: string; verified_badge_count: number; last_verified_at: string | null; verification_source: string | null }[] = [];
  for (let offset = 0; offset < rows.length; offset += 100) {
    const { data, error } = await supabase
      .from("participants")
      .select("id,verified_badge_count,last_verified_at,verification_source")
      .in("id", rows.slice(offset, offset + 100).map((row) => row.participantId));
    if (error || !data) {
      return { status: "error", message: "The participant roster could not be rechecked. No counts were changed." };
    }
    currentRows.push(...data);
  }
  const currentById = new Map(currentRows.map((participant) => [participant.id.toLowerCase(), participant]));
  const issues = parseClassifiedPreviewIssues(formData.get("previewIssues"));
  const results: ClassifiedBadgeImportResult[] = [];
  const eligible: ResolvedClassifiedBadgeCsvRow[] = [];
  for (const row of rows) {
    const participant = currentById.get(row.participantId);
    if (!participant) {
      results.push({
        rowNumber: row.rowNumber,
        participantId: row.participantId,
        skillBadgeCount: row.skillBadgeCount,
        arcadeGameBadgeCount: row.arcadeGameBadgeCount,
        totalBadgeCount: row.totalBadgeCount,
        status: "skipped",
        reason: "Participant is no longer present in the roster.",
      });
      continue;
    }
    const previewStateChanged =
      participant.verified_badge_count !== row.verifiedBadgeCount ||
      participant.last_verified_at !== row.lastVerifiedAt ||
      participant.verification_source !== row.verificationSource;
    if (previewStateChanged && participant.verified_badge_count !== row.totalBadgeCount) {
      results.push({
        rowNumber: row.rowNumber,
        participantId: row.participantId,
        skillBadgeCount: row.skillBadgeCount,
        arcadeGameBadgeCount: row.arcadeGameBadgeCount,
        totalBadgeCount: row.totalBadgeCount,
        status: "skipped",
        reason: "Verified count changed after preview; preview the CSV again.",
      });
      continue;
    }
    eligible.push(row);
  }

  if (eligible.length > 0) {
    const { data, error } = await supabase.rpc("admin_bulk_set_classified_badge_counts", {
      p_rows: eligible.map((row) => ({
        row_number: row.rowNumber,
        participant_id: row.participantId,
        skill_count: row.skillBadgeCount,
        arcade_count: row.arcadeGameBadgeCount,
        total_count: row.totalBadgeCount,
        review_note: row.reviewNote,
        expected_total_count: row.verifiedBadgeCount,
        expected_last_verified_at: row.lastVerifiedAt,
        expected_verification_source: row.verificationSource,
      })),
    });
    if (error || !data) {
      for (const row of eligible) {
        results.push({
          rowNumber: row.rowNumber,
          participantId: row.participantId,
          skillBadgeCount: row.skillBadgeCount,
          arcadeGameBadgeCount: row.arcadeGameBadgeCount,
          totalBadgeCount: row.totalBadgeCount,
          status: "failed",
          reason: "The classified verification transaction failed. No eligible row in this batch was changed; preview again.",
        });
      }
    } else {
      const appliedRows = data as unknown as {
        row_number: number;
        participant_id: string;
        new_total_count: number;
        new_skill_count: number;
        new_arcade_count: number;
      }[];
      const appliedByRow = new Map(appliedRows.map((row) => [row.row_number, row]));
      for (const row of eligible) {
        const applied = appliedByRow.get(row.rowNumber);
        results.push(
          applied
            ? {
                rowNumber: row.rowNumber,
                participantId: row.participantId,
                skillBadgeCount: applied.new_skill_count,
                arcadeGameBadgeCount: applied.new_arcade_count,
                totalBadgeCount: applied.new_total_count,
                status: "success",
                reason: "Recorded through the audited admin classified badge verification workflow.",
              }
            : {
                rowNumber: row.rowNumber,
                participantId: row.participantId,
                skillBadgeCount: row.skillBadgeCount,
                arcadeGameBadgeCount: row.arcadeGameBadgeCount,
                totalBadgeCount: row.totalBadgeCount,
                status: "failed",
                reason: "The database returned an incomplete result; verify the audit history before retrying.",
              },
        );
      }
    }
  }
  const skipped = results.filter((result) => result.status === "skipped").length + issues.length;
  const failed = results.filter((result) => result.status === "failed").length;
  const succeeded = results.filter((result) => result.status === "success").length;
  revalidatePath("/");
  revalidatePath("/admin");
  return {
    status: failed > 0 && succeeded === 0 ? "error" : "success",
    message: `${succeeded} classified, ${skipped} skipped, ${failed} failed. All classified writes enforce skill + arcade = total and use the authenticated audited workflow.`,
    issues,
    results,
  };
}

export async function signOutAdmin() {
  try {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  } catch {
    // Sign-out remains safe if the session has already expired or Supabase is unavailable.
  }
  redirect("/admin/login?auth=signed-out");
}

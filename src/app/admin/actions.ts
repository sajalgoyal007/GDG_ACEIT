"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { MAX_CSV_BYTES, parseParticipantCsv } from "@/lib/participants/csv";
import { getAdminAuthorization } from "@/lib/supabase/admin-auth";
import { parseVerifiedBadgeCount } from "@/lib/admin-validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseProgressCsv, resolveProgressCsvRows, type ResolvedProgressCsvRow } from "@/lib/participants/progress-csv";
import type { UnverifiedProgressPreviewState } from "./progress-import-state";
import type { AdminActionState } from "./action-state";

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

    const results = data as unknown as { csv_row_number: number; result: "imported" | "duplicate" }[];
    const imported = results.filter((row) => row.result === "imported").length;
    const duplicateIssues = results.filter((row) => row.result === "duplicate").map((row) => {
      const csvRow = parsed.rows[row.csv_row_number - 1];
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
    return { status: "success", message: `Badge count recorded: ${result.previous_badge_count} → ${result.new_badge_count}. The actor and verification timestamp were added to the audit log.` };
  } catch {
    return { status: "error", message: "Admin authorization or database access failed. No count was changed." };
  }
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

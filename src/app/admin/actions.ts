"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { MAX_CSV_BYTES, parseParticipantCsv } from "@/lib/participants/csv";
import { getAdminAuthorization } from "@/lib/supabase/admin-auth";
import { parseVerifiedBadgeCount } from "@/lib/admin-validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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

"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getAdminAuthorization } from "@/lib/supabase/admin-auth";
import { applyGoogleFormSync, GoogleFormSyncApplyError, previewGoogleFormSync } from "@/lib/google-sheets/sync-service";
import type { GoogleFormSyncActionState } from "./google-form-sync-state";

async function getAuthorizedClient() {
  const authorization = await getAdminAuthorization();
  if (authorization.status !== "admin") throw new Error("Administrator authentication is required for Google Form sync.");
  return authorization.client;
}

export async function googleFormSyncAction(_previous: GoogleFormSyncActionState, formData: FormData): Promise<GoogleFormSyncActionState> {
  void _previous;
  const intent = formData.get("intent");
  if (intent === "preview") {
    try {
      const client = await getAuthorizedClient();
      return { status: "preview", message: "Review this preview. No database records have been changed.", preview: await previewGoogleFormSync(client) };
    } catch (error) {
      const diagnosticId = randomUUID();
      console.error("[google-form-sync] preview failed", { diagnosticId, errorType: error instanceof Error ? "Error" : "UnknownError" });
      return { status: "error", message: `Preview failed. Check server configuration and administrator access, then share diagnostic ID ${diagnosticId} with the project maintainer.` };
    }
  }

  if (intent !== "apply") return { status: "error", message: "Unknown Google Form sync action." };
  if (formData.get("confirmSync") !== "confirmed") {
    return { status: "error", message: "Confirm the reviewed Google Form sync before applying changes." };
  }
  const token = formData.get("previewToken");
  if (typeof token !== "string" || token.length > 200) {
    return { status: "error", message: "The preview is missing or invalid. Generate a fresh preview before syncing." };
  }

  let result: Awaited<ReturnType<typeof applyGoogleFormSync>>;
  try {
    const client = await getAuthorizedClient();
    result = await applyGoogleFormSync(client, token);
  } catch (error) {
    if (error instanceof GoogleFormSyncApplyError) {
      const messages = {
        migration: "The database sync function is unavailable. Confirm the latest migration is applied, then share the diagnostic ID with the project maintainer.",
        authorization: "Supabase denied this sync. Confirm this signed-in user is provisioned in admin_users, then share the diagnostic ID with the project maintainer.",
        validation: "The database rejected one or more sync rows. Review the preview issues and share the diagnostic ID with the project maintainer.",
        concurrent_change: "Participant data changed during this request. Generate and review a fresh preview before trying again.",
        database: "The database could not apply this sync. Share the diagnostic ID with the project maintainer.",
      } as const;
      return { status: "error", message: `${messages[error.kind]} Diagnostic ID: ${error.diagnosticId}` };
    }
    const diagnosticId = randomUUID();
    console.error("[google-form-sync] apply workflow failed", { diagnosticId, errorType: error instanceof Error ? "Error" : "UnknownError" });
    return { status: "error", message: `Sync could not be applied. No automatic retry was attempted. Share diagnostic ID ${diagnosticId} with the project maintainer.` };
  }

  if (result.status === "stale") {
    return { status: "error", message: "The sheet or participant records changed after preview. Generate and review a new preview." };
  }
  const imported = result.results.filter((row) => row.result === "imported").length;
  const updated = result.results.filter((row) => row.result === "updated").length;
  const unchanged = result.results.filter((row) => row.result === "unchanged").length;
  const duplicate = result.counts.duplicate + unchanged;
  revalidatePath("/");
  revalidatePath("/admin");
  return {
    status: "success",
    message: `Sync applied: ${imported} new, ${updated} updated, ${duplicate} duplicate or unchanged, ${result.counts.invalid} invalid. Existing verified badge counts were preserved.`,
  };
}

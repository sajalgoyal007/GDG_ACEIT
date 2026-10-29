"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getAdminAuthorization } from "@/lib/supabase/admin-auth";
import { GoogleSheetsConfigError, GoogleSheetsReadError } from "@/lib/google-sheets/client";
import { applyGoogleFormSync, GoogleFormSyncApplyError, previewGoogleFormSync } from "@/lib/google-sheets/sync-service";
import type { GoogleFormSyncActionState } from "./google-form-sync-state";

class AdminAuthError extends Error {
  readonly authStatus: "unconfigured" | "signed_out" | "not_admin" | "check_failed";
  constructor(status: "unconfigured" | "signed_out" | "not_admin" | "check_failed") {
    super(`Administrator authentication required (status: ${status}).`);
    this.name = "AdminAuthError";
    this.authStatus = status;
  }
}

async function getAuthorizedClient() {
  const authorization = await getAdminAuthorization();
  if (authorization.status !== "admin") throw new AdminAuthError(authorization.status);
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
      let category = "unknown";
      let code: string | number = "UNKNOWN";
      let status: number | undefined = undefined;
      let safeMessage = "An unexpected error occurred during preview.";

      if (error instanceof AdminAuthError) {
        category = "admin_auth";
        code = error.authStatus;
        safeMessage = error.message;
      } else if (error instanceof GoogleSheetsConfigError) {
        category = "configuration";
        code = error.missingOrInvalid;
        safeMessage = error.message;
      } else if (error instanceof GoogleSheetsReadError) {
        category = "sheets_api";
        code = error.code;
        status = error.status;
        safeMessage = error.message;
      } else if (error instanceof Error && error.message.includes("participant records")) {
        category = "database";
        code = "DB_QUERY_FAILED";
        safeMessage = error.message;
      } else if (error instanceof Error) {
        code = error.name || "Error";
        safeMessage = error.message.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[REDACTED_EMAIL]");
      }

      console.error("[google-form-sync] preview failed", {
        diagnosticId,
        category,
        code,
        status,
        safeMessage,
      });
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
    let category = "unknown";
    let code: string | number = "UNKNOWN";
    let safeMessage = "Sync apply workflow failed.";
    if (error instanceof AdminAuthError) {
      category = "admin_auth";
      code = error.authStatus;
      safeMessage = error.message;
    } else if (error instanceof GoogleSheetsConfigError) {
      category = "configuration";
      code = error.missingOrInvalid;
      safeMessage = error.message;
    } else if (error instanceof GoogleSheetsReadError) {
      category = "sheets_api";
      code = error.code;
      safeMessage = error.message;
    }
    console.error("[google-form-sync] apply workflow failed", { diagnosticId, category, code, safeMessage });
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

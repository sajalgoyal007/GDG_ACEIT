"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getAdminAuthorization } from "@/lib/supabase/admin-auth";
import {
  isCatalogCategory,
  validateCatalogEntry,
  validateCategoryChange,
} from "@/lib/badges/catalog";
import {
  parseBadgeSyncSnapshot,
  type BadgeSyncSnapshot,
} from "@/lib/badges/snapshot";
import { badgeSyncRpcErrorMessage } from "@/lib/badges/rpc-error";
import { toStagingPayload, validateObservationBatch, type ObservationParticipantInput } from "@/lib/badges/observations";
import type {
  BadgeCatalogActionState,
  BadgeCatalogRow,
  BadgeSyncActionState,
} from "./badge-sync-state";

const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FINGERPRINT = /^[0-9a-f]{32}$/;
const SHA256 = /^[0-9a-f]{64}$/;

type AdminClient = Awaited<ReturnType<typeof getAuthorizedClient>>;

class BadgeSyncActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadgeSyncActionError";
  }
}

async function getAuthorizedClient() {
  const authorization = await getAdminAuthorization();
  if (authorization.status !== "admin") {
    throw new BadgeSyncActionError("Admin access could not be verified.");
  }
  return authorization.client;
}

function errorState(message: string): BadgeSyncActionState {
  return { status: "error", message };
}

function snapshotState(snapshot: BadgeSyncSnapshot, message: string): BadgeSyncActionState {
  return { status: "success", message, snapshot };
}

function parseJson<T>(value: FormDataEntryValue | null, label: string): T {
  try {
    return JSON.parse(String(value ?? "")) as T;
  } catch {
    throw new BadgeSyncActionError(`${label} is not valid JSON.`);
  }
}

function requireRunId(formData: FormData): string {
  const runId = String(formData.get("runId") ?? "").trim();
  if (!RUN_ID.test(runId)) throw new BadgeSyncActionError("A valid badge sync run id is required.");
  return runId;
}

function requireFingerprint(formData: FormData): string {
  const fingerprint = String(formData.get("previewFingerprint") ?? "").trim().toLowerCase();
  if (!FINGERPRINT.test(fingerprint)) throw new BadgeSyncActionError("A valid preview fingerprint is required.");
  return fingerprint;
}

async function loadSnapshot(client: AdminClient, runId: string): Promise<BadgeSyncSnapshot> {
  const { data, error } = await client.rpc("admin_get_badge_sync_snapshot", { p_run_id: runId });
  if (error || !data) throw new BadgeSyncActionError("The badge sync run could not be read.");
  return parseBadgeSyncSnapshot(data);
}

async function runStatus(client: AdminClient, runId: string): Promise<string | null> {
  try {
    return (await loadSnapshot(client, runId)).run.status;
  } catch {
    return null;
  }
}

async function loadCatalog(client: AdminClient): Promise<BadgeCatalogRow[]> {
  const { data, error } = await client
    .from("badge_catalog")
    .select("badge_key,display_name,category,source")
    .order("category")
    .order("display_name");
  if (error || !data) throw new BadgeSyncActionError("The badge catalog could not be read.");
  return (data as {
    badge_key: string;
    display_name: string;
    category: BadgeCatalogRow["category"];
    source: string;
  }[]).map((row) => ({
    badgeKey: row.badge_key,
    displayName: row.display_name,
    category: row.category,
    source: row.source,
  }));
}

function catalogState(entries: BadgeCatalogRow[], message: string): BadgeCatalogActionState {
  return { status: "success", message, entries };
}

export async function loadBadgeCatalogAction(): Promise<BadgeCatalogActionState> {
  try {
    const client = await getAuthorizedClient();
    const entries = await loadCatalog(client);
    return catalogState(entries, `${entries.length} catalog identities.`);
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "The badge catalog could not be read." };
  }
}

export async function upsertBadgeCatalogEntriesAction(
  _previous: BadgeCatalogActionState,
  formData: FormData,
): Promise<BadgeCatalogActionState> {
  void _previous;
  try {
    const client = await getAuthorizedClient();
    const raw = parseJson<unknown>(formData.get("catalogEntries"), "Catalog entries");
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 500) {
      throw new BadgeSyncActionError("Catalog entries must contain 1 to 500 rows.");
    }
    const rows = raw.map((item, index) => {
      const record = item as Record<string, unknown>;
      const validation = validateCatalogEntry({
        badgeKey: String(record?.badgeKey ?? ""),
        displayName: String(record?.displayName ?? ""),
        category: record?.category as never,
        source: String(record?.source ?? "manual"),
      });
      if (!validation.ok) throw new BadgeSyncActionError(`Catalog row ${index + 1}: ${validation.reason}`);
      return {
        badge_key: validation.value.badgeKey,
        display_name: validation.value.displayName,
        category: validation.value.category,
        source: validation.value.source,
      };
    });
    const { error } = await client.rpc("admin_upsert_badge_catalog_entries", { p_rows: rows });
    if (error) throw new BadgeSyncActionError("The database rejected this catalog update.");
    revalidatePath("/admin");
    const entries = await loadCatalog(client);
    return catalogState(entries, `Catalog updated: ${rows.length} row${rows.length === 1 ? "" : "s"} considered.`);
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "The badge catalog could not be updated." };
  }
}

export async function updateBadgeCatalogCategoryAction(
  _previous: BadgeCatalogActionState,
  formData: FormData,
): Promise<BadgeCatalogActionState> {
  void _previous;
  try {
    const client = await getAuthorizedClient();
    const badgeKey = String(formData.get("badgeKey") ?? "").trim();
    const category = String(formData.get("category") ?? "").trim();
    const displayName = String(formData.get("displayName") ?? "").trim();
    const reason = String(formData.get("reason") ?? "").trim();
    if (!isCatalogCategory(category)) throw new BadgeSyncActionError("Catalog category is invalid.");
    const validation = validateCategoryChange({ badgeKey, nextCategory: category, reason });
    if (!validation.ok) throw new BadgeSyncActionError(validation.reason);

    const { error } = await client.rpc("admin_update_badge_catalog_category", {
      p_badge_key: badgeKey,
      p_category: category,
      p_display_name: displayName,
      p_reason: validation.value.reason,
    });
    if (error) throw new BadgeSyncActionError("The database rejected this catalog category change.");
    revalidatePath("/admin");
    const entries = await loadCatalog(client);
    return catalogState(entries, `Catalog category updated for ${badgeKey}.`);
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "The catalog category could not be updated." };
  }
}

export async function createBadgeSyncRunAction(
  _previous: BadgeSyncActionState,
  formData: FormData,
): Promise<BadgeSyncActionState> {
  void _previous;
  try {
    const client = await getAuthorizedClient();
    const mode = String(formData.get("mode") ?? "badge_observations").trim();
    if (mode !== "badge_observations" && mode !== "classified_counts") {
      throw new BadgeSyncActionError("Badge sync mode is invalid.");
    }
    const sourceFilename = String(formData.get("sourceFilename") ?? "").trim();
    const sourceSha256 = String(formData.get("sourceSha256") ?? "").trim().toLowerCase();
    if (sourceSha256 && !SHA256.test(sourceSha256)) {
      throw new BadgeSyncActionError("Source SHA-256 must be 64 lowercase hex characters.");
    }
    const note = String(formData.get("note") ?? "").trim();
    const { data, error } = await client.rpc("admin_create_badge_sync_run", {
      p_mode: mode,
      p_source_filename: sourceFilename || null,
      p_source_sha256: sourceSha256 || null,
      p_note: note || null,
    });
    if (error || typeof data !== "string") throw new BadgeSyncActionError("The badge sync run could not be created.");
    const snapshot = await loadSnapshot(client, data);
    return snapshotState(snapshot, "Draft badge sync run created.");
  } catch (error) {
    return errorState(error instanceof Error ? error.message : "The badge sync run could not be created.");
  }
}

export async function stageBadgeSyncObservationsAction(
  _previous: BadgeSyncActionState,
  formData: FormData,
): Promise<BadgeSyncActionState> {
  void _previous;
  try {
    const client = await getAuthorizedClient();
    const runId = requireRunId(formData);
    const raw = parseJson<ObservationParticipantInput[]>(formData.get("observations"), "Observations");
    if (!Array.isArray(raw)) throw new BadgeSyncActionError("Observations must be an array.");
    const validation = validateObservationBatch(raw);
    if (!validation.ok) throw new BadgeSyncActionError(validation.reason);
    const { error } = await client.rpc("admin_stage_badge_sync_observations", {
      p_run_id: runId,
      p_participants: toStagingPayload(validation.value),
    });
    if (error) throw new BadgeSyncActionError("The database rejected this observation batch.");
    const snapshot = await loadSnapshot(client, runId);
    return snapshotState(snapshot, `Staged ${validation.value.length} participant observation${validation.value.length === 1 ? "" : "s"}.`);
  } catch (error) {
    return errorState(error instanceof Error ? error.message : "The badge observations could not be staged.");
  }
}

export async function previewBadgeSyncRunAction(
  _previous: BadgeSyncActionState,
  formData: FormData,
): Promise<BadgeSyncActionState> {
  void _previous;
  try {
    const client = await getAuthorizedClient();
    const runId = requireRunId(formData);
    const { data, error } = await client.rpc("admin_preview_badge_sync_run", { p_run_id: runId });
    if (error || !data) throw new BadgeSyncActionError("The badge sync run could not be previewed.");
    return snapshotState(parseBadgeSyncSnapshot(data), "Preview generated with a stable server-side fingerprint.");
  } catch (error) {
    return errorState(error instanceof Error ? error.message : "The badge sync run could not be previewed.");
  }
}

export async function approveBadgeSyncRunAction(
  _previous: BadgeSyncActionState,
  formData: FormData,
): Promise<BadgeSyncActionState> {
  void _previous;
  try {
    const client = await getAuthorizedClient();
    const runId = requireRunId(formData);
    const fingerprint = requireFingerprint(formData);
    const { data, error } = await client.rpc("admin_approve_badge_sync_run", {
      p_run_id: runId,
      p_fingerprint: fingerprint,
    });
    if (error || !data) throw new BadgeSyncActionError("This preview can no longer be approved; preview again.");
    return snapshotState(parseBadgeSyncSnapshot(data), "Badge sync run approved.");
  } catch (error) {
    return errorState(error instanceof Error ? error.message : "The badge sync run could not be approved.");
  }
}

export async function applyBadgeSyncRunAction(
  _previous: BadgeSyncActionState,
  formData: FormData,
): Promise<BadgeSyncActionState> {
  void _previous;
  try {
    const client = await getAuthorizedClient();
    const runId = requireRunId(formData);
    const fingerprint = requireFingerprint(formData);

    const status = await runStatus(client, runId);
    if (!status) throw new BadgeSyncActionError("The badge sync run could not be found.");
    if (status === "previewed") {
      const { error } = await client.rpc("admin_approve_badge_sync_run", {
        p_run_id: runId,
        p_fingerprint: fingerprint,
      });
      if (error) {
        const after = await runStatus(client, runId);
        if (after !== "approved" && after !== "applied") {
          throw new BadgeSyncActionError("This preview is stale or already resolved; preview again.");
        }
      }
    } else if (status !== "approved" && status !== "applied") {
      throw new BadgeSyncActionError("Only an approved, unapplied run can be applied.");
    }

    const { data, error } = await client.rpc("admin_apply_badge_sync_run", {
      p_run_id: runId,
      p_fingerprint: fingerprint,
      p_request_id: randomUUID(),
    });
    if (error || !data) {
      throw new BadgeSyncActionError(
        badgeSyncRpcErrorMessage(error, "The apply transaction failed; no partial counts were written."),
      );
    }
    const snapshot = await loadSnapshot(client, runId);
    revalidatePath("/");
    revalidatePath("/admin");
    return snapshotState(snapshot, "Badge sync run applied through the audited count writer.");
  } catch (error) {
    return errorState(error instanceof Error ? error.message : "The badge sync run could not be applied.");
  }
}

export async function rollbackBadgeSyncRunAction(
  _previous: BadgeSyncActionState,
  formData: FormData,
): Promise<BadgeSyncActionState> {
  void _previous;
  try {
    const client = await getAuthorizedClient();
    const runId = requireRunId(formData);
    const { data, error } = await client.rpc("admin_rollback_badge_sync_run", {
      p_run_id: runId,
      p_request_id: randomUUID(),
    });
    if (error || !data) {
      throw new BadgeSyncActionError(
        badgeSyncRpcErrorMessage(error, "The rollback transaction failed; no counts were restored."),
      );
    }
    const snapshot = await loadSnapshot(client, runId);
    revalidatePath("/");
    revalidatePath("/admin");
    return snapshotState(snapshot, "Badge sync run rolled back through the audited rollback writer.");
  } catch (error) {
    return errorState(error instanceof Error ? error.message : "The badge sync run could not be rolled back.");
  }
}

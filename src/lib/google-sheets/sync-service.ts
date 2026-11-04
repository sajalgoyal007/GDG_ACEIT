import "server-only";

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyGoogleFormSync, prepareGoogleFormRows, type ExistingSyncParticipant, type GoogleFormSyncPlan } from "./sync-plan";
import { getGoogleSheetsConfig, readGoogleFormResponseRows } from "./client";

function participantKey(secret: string, email: string) {
  return createHmac("sha256", secret).update(`participant-match:v1:${email}`).digest("hex");
}

function previewSignature(secret: string, plan: GoogleFormSyncPlan, issuedAt: number) {
  const contents = JSON.stringify({
    rowsToApply: plan.rowsToApply,
    issues: plan.issues,
    records: plan.records,
    counts: plan.counts,
  });
  return createHmac("sha256", secret).update(`google-form-preview:v1:${issuedAt}:${contents}`).digest("base64url");
}

const PREVIEW_TOKEN_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes
const MAX_PARTICIPANT_LOOKUP_BATCH_SIZE = 20;
const MAX_PARTICIPANT_LOOKUP_PATH_LENGTH = 4_000;
const PARTICIPANT_SELECT_COLUMNS = "id,participant_key,display_name,profile_url,verified_badge_count";
const PARTICIPANT_LOOKUP_ERROR = "Could not compare Google Form responses with participant records. Check admin database policies.";

function safeDatabaseErrorCode(code: unknown): string {
  return typeof code === "string" && /^[A-Z0-9]{3,10}$/.test(code) ? code : "UNKNOWN";
}

function safeDatabaseErrorStatus(status: unknown): number | "UNKNOWN" {
  return typeof status === "number" && Number.isFinite(status) && Number.isInteger(status) ? status : "UNKNOWN";
}

type ParticipantLookupColumn = "participant_key" | "profile_url";
type ParticipantLookupStage = "participants_by_key" | "participants_by_profile";
type ParticipantLookupRow = {
  id: string;
  participant_key: string;
  display_name: string;
  profile_url: string | null;
  verified_badge_count: number;
};

function participantLookupPathLength(column: ParticipantLookupColumn, values: readonly string[]) {
  // Match PostgREST's .in() encoding and leave ample room below common request-line limits.
  const expression = values.map((value) => /[,()]/.test(value) ? `"${value}"` : value).join(",");
  const params = new URLSearchParams({ select: PARTICIPANT_SELECT_COLUMNS });
  params.set(column, `in.(${expression})`);
  return `/rest/v1/participants?${params.toString()}`.length;
}

function batchParticipantLookupValues(column: ParticipantLookupColumn, values: readonly string[]) {
  const batches: string[][] = [];
  let batch: string[] = [];
  for (const value of new Set(values)) {
    const candidate = [...batch, value];
    if (candidate.length <= MAX_PARTICIPANT_LOOKUP_BATCH_SIZE && participantLookupPathLength(column, candidate) <= MAX_PARTICIPANT_LOOKUP_PATH_LENGTH) {
      batch = candidate;
      continue;
    }
    if (batch.length === 0 || participantLookupPathLength(column, [value]) > MAX_PARTICIPANT_LOOKUP_PATH_LENGTH) {
      throw new Error(PARTICIPANT_LOOKUP_ERROR);
    }
    batches.push(batch);
    batch = [value];
  }
  if (batch.length) batches.push(batch);
  return batches;
}

async function lookupParticipants(
  supabase: SupabaseClient,
  column: ParticipantLookupColumn,
  stage: ParticipantLookupStage,
  values: readonly string[],
): Promise<ParticipantLookupRow[]> {
  const rows: ParticipantLookupRow[] = [];
  for (const batch of batchParticipantLookupValues(column, values)) {
    const result = await supabase.from("participants")
      .select(PARTICIPANT_SELECT_COLUMNS)
      .in(column, batch);
    if (result.error) {
      console.error({ stage, code: safeDatabaseErrorCode(result.error.code), status: safeDatabaseErrorStatus(result.status) });
      throw new Error(PARTICIPANT_LOOKUP_ERROR);
    }
    rows.push(...(result.data ?? []));
  }
  return rows;
}

function makePreviewToken(secret: string, plan: GoogleFormSyncPlan, issuedAt = Date.now()) {
  return `${issuedAt}.${previewSignature(secret, plan, issuedAt)}`;
}

function previewTokenMatches(secret: string, plan: GoogleFormSyncPlan, token: string) {
  const [timestampText, suppliedSignature, ...extra] = token.split(".");
  const issuedAt = Number(timestampText);
  if (extra.length || !Number.isSafeInteger(issuedAt) || !suppliedSignature || Date.now() - issuedAt > PREVIEW_TOKEN_MAX_AGE_MS || issuedAt > Date.now() + 30_000) return false;
  const expected = previewSignature(secret, plan, issuedAt);
  const supplied = Buffer.from(suppliedSignature);
  const expectedBuffer = Buffer.from(expected);
  return supplied.length === expectedBuffer.length && timingSafeEqual(supplied, expectedBuffer);
}

async function buildCurrentPlan(supabase: SupabaseClient) {
  const config = getGoogleSheetsConfig();
  const sheetValues = await readGoogleFormResponseRows(config);
  const prepared = prepareGoogleFormRows(sheetValues, config.headerMap, (email) => participantKey(config.matchSecret, email));
  if (prepared.rows.length === 0) {
    const plan = classifyGoogleFormSync([], prepared.issues, []);
    return { config, plan };
  }

  const keys = [...new Set(prepared.rows.map((row) => row.participantKey))];
  const profileUrls = [...new Set(prepared.rows.flatMap((row) => row.profileUrl ? [row.profileUrl] : []))];
  const [byKeyRows, byProfileRows] = await Promise.all([
    lookupParticipants(supabase, "participant_key", "participants_by_key", keys),
    profileUrls.length
      ? lookupParticipants(supabase, "profile_url", "participants_by_profile", profileUrls)
      : Promise.resolve([] as ParticipantLookupRow[]),
  ]);

  const existingMap = new Map<string, ExistingSyncParticipant>();
  for (const row of [...byKeyRows, ...byProfileRows]) {
    existingMap.set(row.id, {
      id: row.id,
      participantKey: row.participant_key,
      displayName: row.display_name,
      profileUrl: row.profile_url,
      verifiedBadgeCount: row.verified_badge_count,
    });
  }
  const plan = classifyGoogleFormSync(prepared.rows, prepared.issues, [...existingMap.values()]);
  return { config, plan };
}

export interface GoogleFormSyncPreview {
  token: string;
  counts: GoogleFormSyncPlan["counts"];
  records: GoogleFormSyncPlan["records"];
  issues: GoogleFormSyncPlan["issues"];
}

export type GoogleFormSyncApplyFailureKind = "migration" | "authorization" | "validation" | "concurrent_change" | "database";

export class GoogleFormSyncApplyError extends Error {
  constructor(readonly kind: GoogleFormSyncApplyFailureKind, readonly diagnosticId: string) {
    super("Google Form sync apply failed.");
    this.name = "GoogleFormSyncApplyError";
  }
}

function classifyApplyFailureCode(code: unknown): GoogleFormSyncApplyFailureKind {
  switch (code) {
    case "PGRST202":
    case "42883":
      return "migration";
    case "42501":
      return "authorization";
    case "22023":
    case "23514":
      return "validation";
    case "40001":
      return "concurrent_change";
    default:
      return "database";
  }
}

export async function previewGoogleFormSync(supabase: SupabaseClient): Promise<GoogleFormSyncPreview> {
  const { config, plan } = await buildCurrentPlan(supabase);
  return {
    token: makePreviewToken(config.matchSecret, plan),
    counts: plan.counts,
    records: plan.records,
    issues: plan.issues,
  };
}

export async function applyGoogleFormSync(supabase: SupabaseClient, token: string) {
  const { config, plan } = await buildCurrentPlan(supabase);
  if (!previewTokenMatches(config.matchSecret, plan, token)) {
    return { status: "stale" as const, plan };
  }
  if (plan.rowsToApply.length === 0) {
    return { status: "success" as const, results: [], issues: plan.issues, counts: plan.counts };
  }
  const { data, error } = await supabase.rpc("admin_sync_google_form_participants", {
    p_rows: plan.rowsToApply.map((row) => ({
      rowNumber: row.rowNumber,
      participantKey: row.participantKey,
      displayName: row.displayName,
      profileUrl: row.profileUrl,
    })),
  });
  if (error || !data) {
    const diagnosticId = randomUUID();
    const code = typeof error?.code === "string" && /^[A-Z0-9]{3,10}$/.test(error.code) ? error.code : "NO_ERROR_CODE";
    const kind = classifyApplyFailureCode(error?.code);
    // Deliberately omit the raw error, request rows, and provider response: they can contain private data.
    console.error("[google-form-sync] apply RPC failed", { diagnosticId, code, kind });
    throw new GoogleFormSyncApplyError(kind, diagnosticId);
  }
  return { status: "success" as const, results: data as { row_number: number; participant_id: string; result: "imported" | "updated" | "unchanged" }[], issues: plan.issues, counts: plan.counts };
}

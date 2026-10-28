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
  const [byKeyResult, byProfileResult] = await Promise.all([
    supabase.from("participants")
      .select("id,participant_key,display_name,profile_url,verified_badge_count")
      .in("participant_key", keys),
    profileUrls.length
      ? supabase.from("participants")
        .select("id,participant_key,display_name,profile_url,verified_badge_count")
        .in("profile_url", profileUrls)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (byKeyResult.error || byProfileResult.error) throw new Error("Could not compare Google Form responses with participant records. Check admin database policies.");

  const existingMap = new Map<string, ExistingSyncParticipant>();
  for (const row of [...(byKeyResult.data ?? []), ...(byProfileResult.data ?? [])]) {
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

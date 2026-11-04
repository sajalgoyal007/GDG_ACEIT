import "server-only";

import { sortAutoProgressRows, toAutoProgressRow, type AutoFetchStatus, type AutoProgressRow } from "@/lib/auto-progress/leaderboard";
import { createSupabasePublicClient } from "./public";

interface AutoProgressViewRow {
  participant_id: string;
  display_name: string;
  status: AutoFetchStatus | null;
  eligible_badge_count: number | null;
  last_successful_check_at: string | null;
  last_progress_change_at: string | null;
  ten_badge_first_observed_at: string | null;
  ten_badge_finish_rank: number | null;
  unverified_badge_count: number | null;
  unverified_imported_at: string | null;
  unverified_source: "organizer_csv" | null;
}

export interface UnverifiedProgressEntry {
  participantId: string;
  displayName: string;
  badgeCount: number;
  importedAt: string;
  source: "organizer_csv";
}

export interface ProgressObservationSummary {
  participantId: string;
  displayName: string;
  latestSourceName: "arcadecalc_frontend" | "google_skills_public_html";
  latestRetrievedAt: string;
  latestRecordedAt: string;
  latestHttpStatus: number;
  latestStatus: "unverified" | "partial" | "failed" | "blocked";
  reportedTotal: number | null;
  detailCount: number | null;
  uniqueBadgeCount: number | null;
  reportSourceName: "arcadecalc_frontend" | "google_skills_public_html" | null;
  lastReportedAt: string | null;
  identityStatus: "not_independently_verified";
}

const PROJECTION = "participant_id,display_name,status,eligible_badge_count,last_successful_check_at,last_progress_change_at,ten_badge_first_observed_at,ten_badge_finish_rank,unverified_badge_count,unverified_imported_at,unverified_source";

function unverifiedEntry(row: AutoProgressViewRow): UnverifiedProgressEntry | null {
  if (row.unverified_badge_count === null || row.unverified_imported_at === null || row.unverified_source !== "organizer_csv") return null;
  return { participantId: row.participant_id, displayName: row.display_name, badgeCount: row.unverified_badge_count, importedAt: row.unverified_imported_at, source: row.unverified_source };
}

/** Read-only data access for the isolated automatic progress projection. */
export async function getAutoProgressLeaderboard(now = Date.now()): Promise<AutoProgressRow[]> {
  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase
    .from("public_auto_progress_leaderboard")
    .select(PROJECTION);
  if (error) throw new Error("Automatic progress leaderboard could not be loaded.");

  const rows = (data ?? []).map((raw) => {
    const row = raw as unknown as AutoProgressViewRow;
    return toAutoProgressRow({
      participantId: row.participant_id,
      displayName: row.display_name,
      fetchStatus: row.status ?? "unavailable",
      eligibleBadgeCount: row.eligible_badge_count,
      lastSuccessfulCheckAt: row.last_successful_check_at,
      lastProgressChangeAt: row.last_progress_change_at,
      tenBadgeFirstObservedAt: row.ten_badge_first_observed_at,
      tenBadgeFinishRank: row.ten_badge_finish_rank,
      unverifiedBadgeCount: row.unverified_badge_count,
      unverifiedImportedAt: row.unverified_imported_at,
      unverifiedSource: row.unverified_source,
    }, now);
  });
  return sortAutoProgressRows(rows);
}

/** Read only the separately labeled organizer-imported progress projection. */
export async function getUnverifiedProgressLeaderboard(): Promise<UnverifiedProgressEntry[]> {
  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase.from("public_auto_progress_leaderboard").select(PROJECTION);
  if (error) throw new Error("Organizer progress leaderboard could not be loaded.");
  return (data ?? []).map((raw) => unverifiedEntry(raw as unknown as AutoProgressViewRow))
    .filter((row): row is UnverifiedProgressEntry => row !== null)
    .sort((left, right) => right.badgeCount - left.badgeCount
      || Date.parse(right.importedAt) - Date.parse(left.importedAt)
      || left.participantId.localeCompare(right.participantId));
}

/** Public projection contains only current-profile diagnostic summaries, never raw responses or admin notes. */
export async function getProgressObservationSummaries(): Promise<ProgressObservationSummary[]> {
  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase
    .from("public_progress_observation_leaderboard")
    .select("participant_id,display_name,latest_source_name,latest_retrieved_at,latest_recorded_at,latest_http_status,latest_status,reported_total,detail_count,unique_badge_count,report_source_name,last_reported_at,identity_status");
  if (error) throw new Error("Progress observation summaries could not be loaded.");
  return (data ?? []).map((raw) => {
    const row = raw as Record<string, unknown>;
    return {
      participantId: String(row.participant_id),
      displayName: String(row.display_name),
      latestSourceName: row.latest_source_name as ProgressObservationSummary["latestSourceName"],
      latestRetrievedAt: String(row.latest_retrieved_at),
      latestRecordedAt: String(row.latest_recorded_at),
      latestHttpStatus: Number(row.latest_http_status),
      latestStatus: row.latest_status as ProgressObservationSummary["latestStatus"],
      reportedTotal: typeof row.reported_total === "number" ? row.reported_total : null,
      detailCount: typeof row.detail_count === "number" ? row.detail_count : null,
      uniqueBadgeCount: typeof row.unique_badge_count === "number" ? row.unique_badge_count : null,
      reportSourceName: row.report_source_name === "arcadecalc_frontend" || row.report_source_name === "google_skills_public_html" ? row.report_source_name : null,
      lastReportedAt: typeof row.last_reported_at === "string" ? row.last_reported_at : null,
      identityStatus: "not_independently_verified",
    };
  });
}

/** Read one public projection row after the server resolves the caller's account. */
export async function getAutoProgressForParticipant(participantId: string, now = Date.now()): Promise<AutoProgressRow | null> {
  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase
    .from("public_auto_progress_leaderboard")
    .select(PROJECTION)
    .eq("participant_id", participantId)
    .maybeSingle();
  if (error) throw new Error("Automatic participant progress could not be loaded.");
  if (!data) return null;
  const row = data as unknown as AutoProgressViewRow;
  return toAutoProgressRow({
    participantId: row.participant_id,
    displayName: row.display_name,
    fetchStatus: row.status ?? "unavailable",
    eligibleBadgeCount: row.eligible_badge_count,
    lastSuccessfulCheckAt: row.last_successful_check_at,
    lastProgressChangeAt: row.last_progress_change_at,
    tenBadgeFirstObservedAt: row.ten_badge_first_observed_at,
    tenBadgeFinishRank: row.ten_badge_finish_rank,
    unverifiedBadgeCount: row.unverified_badge_count,
    unverifiedImportedAt: row.unverified_imported_at,
    unverifiedSource: row.unverified_source,
  }, now);
}

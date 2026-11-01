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

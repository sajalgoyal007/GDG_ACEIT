import "server-only";

import type { LeaderboardProvider, LeaderboardSnapshot, PublicParticipant } from "@/lib/types";
import { createSupabasePublicClient } from "./public";

interface PublicParticipantRow {
  id: string;
  display_name: string;
  profile_url: string | null;
  verified_badge_count: number;
  skill_badge_count?: number | null;
  arcade_game_badge_count?: number | null;
  frozen_rank?: number | null;
  rank_frozen_at?: string | null;
  last_verified_at: string | null;
  verification_source: string | null;
}

interface PublicSummary {
  registered_count: number;
  total_verified_badges: number;
  total_skill_badges?: number;
  total_arcade_badges?: number;
  frozen_rank_count?: number;
  ten_badge_count?: number;
  last_updated_at: string;
}

type ParticipantsResult = {
  data: unknown;
  error: { code?: string; message?: string } | null;
};

const PARTICIPANT_COLUMNS_WITH_FROZEN =
  "id,display_name,profile_url,verified_badge_count,skill_badge_count,arcade_game_badge_count,frozen_rank,rank_frozen_at,last_verified_at,verification_source";
const PARTICIPANT_COLUMNS_CLASSIFIED =
  "id,display_name,profile_url,verified_badge_count,skill_badge_count,arcade_game_badge_count,last_verified_at,verification_source";
const PARTICIPANT_COLUMNS_BASE =
  "id,display_name,profile_url,verified_badge_count,last_verified_at,verification_source";

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

function colorFor(id: string) {
  const tones = ["blue", "green", "purple", "coral", "yellow"];
  const hash = [...id].reduce((value, character) => value + character.charCodeAt(0), 0);
  return tones[hash % tones.length];
}

export const supabaseLeaderboardProvider: LeaderboardProvider = {
  name: "Supabase public projection",
  async getPublicSnapshot(): Promise<LeaderboardSnapshot> {
    const supabase = createSupabasePublicClient();

    // Backward-compatibility ladder:
    //   1. Full projection with persisted frozen ranks.
    //   2. Classified counts without the rank-freeze migration.
    //   3. Original base projection.
    // A missing column (42703) falls back; any other error still fails closed.
    let participantsResult: ParticipantsResult = await supabase.from("participants")
      .select(PARTICIPANT_COLUMNS_WITH_FROZEN)
      .order("skill_badge_count", { ascending: false, nullsFirst: false })
      .order("verified_badge_count", { ascending: false })
      .order("id", { ascending: true });

    if (participantsResult.error?.code === "42703") {
      participantsResult = await supabase.from("participants")
        .select(PARTICIPANT_COLUMNS_CLASSIFIED)
        .order("skill_badge_count", { ascending: false, nullsFirst: false })
        .order("verified_badge_count", { ascending: false })
        .order("id", { ascending: true });
    }

    if (participantsResult.error?.code === "42703") {
      participantsResult = await supabase.from("participants")
        .select(PARTICIPANT_COLUMNS_BASE)
        .order("verified_badge_count", { ascending: false })
        .order("id", { ascending: true });
    }

    const summaryResult = await supabase.rpc("get_public_summary");

    if (participantsResult.error || summaryResult.error || !summaryResult.data) {
      throw new Error("The Supabase leaderboard could not be loaded. Check the migration and database connection.");
    }

    const rows = participantsResult.data as unknown as PublicParticipantRow[];
    const summary = summaryResult.data as unknown as PublicSummary;
    const participants: PublicParticipant[] = rows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      initials: initials(row.display_name),
      color: colorFor(row.id),
      verifiedBadgeCount: row.verified_badge_count,
      skillBadgeCount: row.skill_badge_count ?? null,
      arcadeGameBadgeCount: row.arcade_game_badge_count ?? null,
      frozenRank: row.frozen_rank ?? null,
      rankFrozenAt: row.rank_frozen_at ?? null,
      ...(row.profile_url ? { profileUrl: row.profile_url } : {}),
      ...(row.last_verified_at ? { lastCheckedAt: row.last_verified_at } : {}),
      ...(row.verification_source ? { verificationSource: row.verification_source } : {}),
    }));

    const frozenRankCount = participants.reduce(
      (count, participant) => participant.frozenRank != null ? count + 1 : count,
      0,
    );

    return {
      dataMode: "database",
      participants,
      registeredCount: Number(summary.registered_count),
      totalVerifiedBadges: Number(summary.total_verified_badges),
      totalSkillBadges: Number(summary.total_skill_badges ?? 0),
      totalArcadeBadges: Number(summary.total_arcade_badges ?? 0),
      frozenRankCount,
      tenBadgeCount: Number(summary.ten_badge_count ?? 0),
      lastSyncedAt: summary.last_updated_at,
    };
  },
};

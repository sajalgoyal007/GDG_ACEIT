import "server-only";

import type { LeaderboardProvider, LeaderboardSnapshot, PublicParticipant } from "@/lib/types";
import { createSupabasePublicClient } from "./public";

interface PublicParticipantRow {
  id: string;
  display_name: string;
  profile_url: string | null;
  verified_badge_count: number;
  last_verified_at: string | null;
  verification_source: string | null;
}

interface PublicSummary {
  registered_count: number;
  total_verified_badges: number;
  five_badge_count: number;
  ten_badge_count: number;
  last_updated_at: string;
}

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
    const [participantsResult, summaryResult] = await Promise.all([
      supabase.from("participants")
        .select("id,display_name,profile_url,verified_badge_count,last_verified_at,verification_source")
        .order("verified_badge_count", { ascending: false })
        .order("id", { ascending: true }),
      supabase.rpc("get_public_summary"),
    ]);

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
      ...(row.profile_url ? { profileUrl: row.profile_url } : {}),
      ...(row.last_verified_at ? { lastCheckedAt: row.last_verified_at } : {}),
      ...(row.verification_source ? { verificationSource: row.verification_source } : {}),
    }));

    return {
      dataMode: "database",
      participants,
      registeredCount: Number(summary.registered_count),
      totalVerifiedBadges: Number(summary.total_verified_badges),
      fiveBadgeCount: Number(summary.five_badge_count),
      tenBadgeCount: Number(summary.ten_badge_count),
      lastSyncedAt: summary.last_updated_at,
    };
  },
};

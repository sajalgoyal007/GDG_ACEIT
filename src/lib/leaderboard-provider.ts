import "server-only";

import { demoProvider } from "./demo-provider";
import { isSupabaseConfigured } from "./supabase/config";
import { supabaseLeaderboardProvider } from "./supabase/leaderboard-provider";
import type { LeaderboardProvider } from "./types";

export function getLeaderboardProvider(): LeaderboardProvider {
  return isSupabaseConfigured() ? supabaseLeaderboardProvider : demoProvider;
}

import type { Metadata } from "next";
import { Dashboard } from "@/components/dashboard";
import { ProgressRefreshPanel } from "@/components/progress-refresh-panel";
import { getLeaderboardProvider } from "@/lib/leaderboard-provider";
import { isAutoProgressEnabled } from "@/lib/auto-progress/config";
import { googleSkillsAutoProgressProvider } from "@/lib/auto-progress/provider";
import { getAuthenticatedParticipant } from "@/lib/supabase/auto-progress-account";
import { getAutoProgressForParticipant, getUnverifiedProgressLeaderboard } from "@/lib/supabase/auto-progress-provider";
import { UnverifiedProgressLeaderboard } from "@/components/unverified-progress-leaderboard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Community Progress",
  description: "Provider-backed participant badge progress and historical GDG ACEIT community highlights.",
};

export default async function ProgressPage() {
  const [snapshot, identity, importedProgress] = await Promise.all([
    getLeaderboardProvider().getPublicSnapshot(),
    getAuthenticatedParticipant().catch(() => ({ status: "check_failed" as const })),
    getUnverifiedProgressLeaderboard().catch(() => []),
  ]);
  let progress = null;
  let loadFailed = false;
  if (identity.status === "linked") {
    try {
      progress = await getAutoProgressForParticipant(identity.participant.participantId);
    } catch {
      loadFailed = true;
    }
  }
  return <>
    <div className="site-main"><ProgressRefreshPanel
      identityState={identity.status}
      progress={progress}
      loadFailed={loadFailed}
      refreshAvailable={isAutoProgressEnabled() && googleSkillsAutoProgressProvider.availability === "available"}
    /><UnverifiedProgressLeaderboard entries={importedProgress} /></div>
    <Dashboard snapshot={snapshot} view="progress" />
  </>;
}

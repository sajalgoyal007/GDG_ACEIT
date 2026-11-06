import type { Metadata } from "next";
import { Activity, ChevronDown } from "lucide-react";
import { Dashboard } from "@/components/dashboard";
import { ProgressRefreshPanel } from "@/components/progress-refresh-panel";
import { getLeaderboardProvider } from "@/lib/leaderboard-provider";
import { isAutoProgressEnabled } from "@/lib/auto-progress/config";
import { googleSkillsAutoProgressProvider } from "@/lib/auto-progress/provider";
import { getAuthenticatedParticipant } from "@/lib/supabase/auto-progress-account";
import { getAutoProgressForParticipant, getProgressObservationSummaries, getUnverifiedProgressLeaderboard } from "@/lib/supabase/auto-progress-provider";
import { UnverifiedProgressLeaderboard } from "@/components/unverified-progress-leaderboard";
import { ProgressObservationLeaderboard } from "@/components/progress-observation-leaderboard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Community Progress",
  description: "Provider-backed participant badge progress and historical GDG ACEIT community highlights.",
};

export default async function ProgressPage() {
  const [snapshot, identity, importedProgress, observations] = await Promise.all([
    getLeaderboardProvider().getPublicSnapshot(),
    getAuthenticatedParticipant().catch(() => ({ status: "check_failed" as const })),
    getUnverifiedProgressLeaderboard().catch(() => []),
    getProgressObservationSummaries().catch(() => []),
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
  return <Dashboard
    snapshot={snapshot}
    view="progress"
    personalProgress={<ProgressRefreshPanel
      identityState={identity.status}
      progress={progress}
      loadFailed={loadFailed}
      refreshAvailable={isAutoProgressEnabled() && googleSkillsAutoProgressProvider.availability === "available"}
    />}
    diagnostics={<details className="diagnostics-disclosure">
      <summary>
        <span className="diagnostics-summary-icon"><Activity size={18} aria-hidden="true" /></span>
        <span className="diagnostics-summary-copy">
          <strong>Diagnostic &amp; unverified data</strong>
          <small>Organizer CSV imports and source-reported observations, kept separate from verified badge counts.</small>
        </span>
        <ChevronDown className="diagnostics-chevron" size={18} aria-hidden="true" />
      </summary>
      <div className="diagnostics-body">
        <UnverifiedProgressLeaderboard entries={importedProgress} />
        <ProgressObservationLeaderboard entries={observations} />
      </div>
    </details>}
  />;
}

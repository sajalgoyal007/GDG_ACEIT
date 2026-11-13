import type { Metadata } from "next";
import { Activity, ChevronDown } from "lucide-react";
import { ProgressExplorer } from "@/components/progress-explorer";
import { getLeaderboardProvider } from "@/lib/leaderboard-provider";
import { getProgressObservationSummaries, getUnverifiedProgressLeaderboard } from "@/lib/supabase/auto-progress-provider";
import { UnverifiedProgressLeaderboard } from "@/components/unverified-progress-leaderboard";
import { ProgressObservationLeaderboard } from "@/components/progress-observation-leaderboard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Community Progress",
  description: "Provider-backed participant badge progress and historical GDG ACEIT community highlights.",
};

export default async function ProgressPage() {
  const [snapshot, importedProgress, observations] = await Promise.all([
    getLeaderboardProvider().getPublicSnapshot(),
    getUnverifiedProgressLeaderboard().catch(() => []),
    getProgressObservationSummaries().catch(() => []),
  ]);

  return <ProgressExplorer
    snapshot={snapshot}
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

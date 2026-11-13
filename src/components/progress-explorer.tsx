"use client";

import type { ReactNode } from "react";
import { Award, BadgeCheck, Lock, ShieldCheck, Users } from "lucide-react";
import { CommunityFooter } from "@/components/community-footer";
import { CommunityNavigation } from "@/components/community-navigation";
import { LeaderboardBoard } from "@/components/leaderboard-board";
import type { LeaderboardSnapshot } from "@/lib/types";

export function ProgressExplorer({ snapshot, diagnostics }: {
  snapshot: LeaderboardSnapshot;
  diagnostics?: ReactNode;
}) {
  const { participants, registeredCount } = snapshot;
  const reviewedCount = participants.filter((participant) => participant.lastCheckedAt).length;
  const awaitingVerification = participants.length - reviewedCount;
  const hasReviewedParticipants = reviewedCount > 0;
  const isDemo = snapshot.dataMode === "demo";

  return (
    <div className="g-app">
      <CommunityNavigation dataMode={snapshot.dataMode} />

      <main className="g-main g-progress-main">
        <section className="g-progress-head" aria-labelledby="page-title">
          <div className="g-progress-title">
            <p className="g-eyebrow"><span className="g-eyebrow-dot" />COMMUNITY PROGRESS <span>/</span> CAMPAIGN 2026</p>
            <h1 id="page-title">Leaderboard</h1>
            <p>Search every registered builder, filter by momentum, and follow the climb toward 10 Skill Badges and a frozen rank.</p>
          </div>
        </section>

        <section className="g-progress-kpis" aria-label="Live leaderboard summary">
          <div className="g-progress-kpi g-kpi-blue"><Users size={16} aria-hidden="true" /><span>Active Builders</span><strong>{registeredCount.toLocaleString("en-IN")}</strong></div>
          <div className="g-progress-kpi g-kpi-red"><BadgeCheck size={16} aria-hidden="true" /><span>Total Badges</span><strong>{!isDemo && !hasReviewedParticipants ? "—" : snapshot.totalVerifiedBadges.toLocaleString("en-IN")}</strong></div>
          <div className="g-progress-kpi g-kpi-yellow"><Award size={16} aria-hidden="true" /><span>Skill Badges</span><strong>{!isDemo && !hasReviewedParticipants ? "—" : snapshot.totalSkillBadges.toLocaleString("en-IN")}</strong></div>
          <div className="g-progress-kpi g-kpi-green"><Lock size={16} aria-hidden="true" /><span>Frozen Ranks</span><strong>{!isDemo && !hasReviewedParticipants ? "—" : snapshot.frozenRankCount.toLocaleString("en-IN")}</strong></div>
        </section>

        <LeaderboardBoard
          snapshot={snapshot}
          kicker="LIVE RECORDS"
          title={isDemo ? "Sample leaderboard" : "Participant progress"}
          headingId="progress-leaderboard-title"
          banner={
            !isDemo && awaitingVerification > 0 ? (
              <p className="g-inline-note" role="status">
                <ShieldCheck size={15} aria-hidden="true" />
                {awaitingVerification.toLocaleString("en-IN")} {awaitingVerification === 1 ? "record is" : "records are"} awaiting manual verification. Unreviewed registrations stay unranked and keep a default badge count of zero.
              </p>
            ) : undefined
          }
        />

        {diagnostics && <div className="g-diagnostics">{diagnostics}</div>}

        <CommunityFooter />
      </main>
    </div>
  );
}

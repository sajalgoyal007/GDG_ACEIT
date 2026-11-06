"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Award, BadgeCheck, Check, Clock3, ExternalLink, Gamepad2, Lock, Medal, RefreshCw, Search, ShieldCheck, Trophy, Users, X } from "lucide-react";
import { CommunityFooter } from "@/components/community-footer";
import { CommunityNavigation } from "@/components/community-navigation";
import type { LeaderboardSnapshot, PublicParticipant } from "@/lib/types";
import { matchesRankFreezeFilter, qualifiesForRankFreeze, rankParticipants } from "@/lib/leaderboard";

type FilterKey = "all" | "ten";

type RankedParticipant = { participant: PublicParticipant; rank: number | null };

const SKILL_BUCKETS = [
  { key: "ten", label: "10+ Skill badges", min: 10, max: Number.POSITIVE_INFINITY, tone: "violet" },
  { key: "seven", label: "7–9 Skill badges", min: 7, max: 9, tone: "blue" },
  { key: "four", label: "4–6 Skill badges", min: 4, max: 6, tone: "green" },
  { key: "one", label: "1–3 Skill badges", min: 1, max: 3, tone: "amber" },
  { key: "zero", label: "0 Skill badges", min: 0, max: 0, tone: "slate" },
] as const;

function buildSkillDistribution(participants: PublicParticipant[]) {
  const classified = participants.filter((participant) => participant.skillBadgeCount !== null);
  const buckets = SKILL_BUCKETS.map((bucket) => ({
    ...bucket,
    count: classified.filter((participant) => {
      const count = participant.skillBadgeCount as number;
      return count >= bucket.min && count <= bucket.max;
    }).length,
  }));
  return { classifiedCount: classified.length, buckets };
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

export function Dashboard({ snapshot, view = "dashboard", personalProgress, diagnostics }: {
  snapshot: LeaderboardSnapshot;
  view?: "dashboard" | "progress";
  personalProgress?: ReactNode;
  diagnostics?: ReactNode;
}) {
  const { participants, registeredCount, lastSyncedAt } = snapshot;
  const isProgressPage = view === "progress";
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [selected, setSelected] = useState<PublicParticipant | null>(null);
  const reduceMotion = useReducedMotion();

  const ranked = useMemo(() => rankParticipants(participants), [participants]);
  const reviewedParticipants = useMemo(() => participants.filter((participant) => participant.lastCheckedAt), [participants]);
  const awaitingVerification = participants.length - reviewedParticipants.length;
  const hasReviewedParticipants = reviewedParticipants.length > 0;
  const topPerformers = useMemo<RankedParticipant[]>(
    () => ranked.filter(({ participant }) => Boolean(participant.lastCheckedAt)).slice(0, 3),
    [ranked],
  );
  const skillDistribution = useMemo(() => buildSkillDistribution(reviewedParticipants), [reviewedParticipants]);
  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return ranked.filter(({ participant }) => {
      const matchesName = !query || participant.displayName.toLocaleLowerCase().includes(query);
      const threshold = filter === "all" ? null : 10;
      const matchesRankFilter = matchesRankFreezeFilter(participant, threshold);
      return matchesName && matchesRankFilter;
    });
  }, [ranked, search, filter]);

  return (
    <div className="community-app dark-community">
      <CommunityNavigation dataMode={snapshot.dataMode} />

      <main className={`site-main${isProgressPage ? " progress-page-content" : ""}`}>
        <section className={`build-hero${isProgressPage ? " build-hero-progress" : ""}`} aria-labelledby="page-title">
          <motion.div
            className="hero-copy"
            initial={reduceMotion ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
          >
            <p className="eyebrow"><span className="eyebrow-dot" />GDG ON CAMPUS ACEIT <span className="eyebrow-divider">/</span> JAIPUR, RAJASTHAN</p>
            <h1 id="page-title">{isProgressPage ? <>Progress,<br /><span>made visible.</span></> : <>Build beyond<br /><span>limits.</span></>}</h1>
            <p className="hero-subtitle">Learn with Communities 2026</p>
            <p className="hero-description">{isProgressPage ? "Every reviewed record in one place: Skill Badge progress, Arcade achievements, and the community's climb toward the 10-badge mark." : "Learn new skills. Build practical projects. Connect with developers shaping what comes next."}</p>
            <div className="hero-actions">
              <Link className="button-primary" href={isProgressPage ? "/" : "/progress"}>{isProgressPage ? "Open leaderboard" : "Explore progress"}<span aria-hidden="true">↗</span></Link>
              <Link className="button-quiet" href="/about">Meet the community</Link>
            </div>
          </motion.div>
          <div className="hero-art" aria-hidden="true">
            <div className="hero-art-grid" />
            <div className="hero-arch" />
            <div className="hero-orbit hero-orbit-one" /><div className="hero-orbit hero-orbit-two" />
            <span className="hero-year">26</span>
            <span className="hero-code hero-code-top">{`{ build: "together" }`}</span>
            <span className="hero-code hero-code-bottom">KUKAS · JAIPUR</span>
            <span className="hero-spark hero-spark-blue" /><span className="hero-spark hero-spark-red" /><span className="hero-spark hero-spark-yellow" /><span className="hero-spark hero-spark-green" />
          </div>
        </section>

        <motion.section
          className="live-strip"
          aria-label="Data freshness and source"
          initial={reduceMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.38, delay: reduceMotion ? 0 : 0.08 }}
        >
          <div className="live-source"><span className="live-pulse" aria-hidden="true" /><span><strong>{snapshot.dataMode === "demo" ? "DEMO DATA" : "COMMUNITY RECORD"}</strong><small>{snapshot.dataMode === "demo" ? "Synthetic examples · not Google verified" : "Community recorded · not Google verified"}</small></span></div>
          <div className="live-freshness"><Clock3 size={15} aria-hidden="true" /><span><small>{snapshot.dataMode === "demo" ? "DEMO SNAPSHOT" : "LAST UPDATED"}</small><time dateTime={lastSyncedAt}>{formatTimestamp(lastSyncedAt)} IST</time></span></div>
          <button className="reference-refresh" type="button" onClick={() => startRefresh(() => router.refresh())} disabled={isRefreshing} aria-busy={isRefreshing}>
            <RefreshCw size={14} aria-hidden="true" className={isRefreshing ? "is-spinning" : undefined} />{isRefreshing ? "Refreshing" : "Refresh data"}
          </button>
        </motion.section>

        <section className="summary-grid" aria-label={isProgressPage ? "Live community progress" : "Live community overview"}>
          <SummaryCard index={0} reduceMotion={reduceMotion} icon={<Users size={18} />} label="Registered participants" value={registeredCount} detail={snapshot.dataMode === "demo" ? "Synthetic examples" : "Current records"} tone="blue" />
          <SummaryCard index={1} reduceMotion={reduceMotion} icon={<BadgeCheck size={18} />} label={snapshot.dataMode === "demo" ? "Example badge count" : "Total badges recorded"} value={snapshot.dataMode === "database" && !hasReviewedParticipants ? "—" : snapshot.totalVerifiedBadges} detail={snapshot.dataMode === "demo" ? "Synthetic examples only" : hasReviewedParticipants ? (snapshot.totalSkillBadges > 0 || snapshot.totalArcadeBadges > 0 ? `${snapshot.totalSkillBadges} Skill · ${snapshot.totalArcadeBadges} Arcade` : "Manual evidence review only") : "Awaiting first review"} tone="green" />
          <SummaryCard index={2} reduceMotion={reduceMotion} icon={<Award size={18} />} label={snapshot.dataMode === "demo" ? "Example Skill badges" : "Skill badges"} value={snapshot.dataMode === "database" && !hasReviewedParticipants ? "—" : snapshot.totalSkillBadges} detail={snapshot.dataMode === "demo" ? "Synthetic examples only" : "Primary leaderboard metric"} tone="amber" />
          <SummaryCard index={3} reduceMotion={reduceMotion} icon={<Trophy size={18} />} label="Reached 10+ Skill badges" value={snapshot.dataMode === "database" && !hasReviewedParticipants ? "—" : snapshot.tenBadgeCount} detail={snapshot.dataMode === "demo" ? "Synthetic examples only" : hasReviewedParticipants ? "Rank-freeze threshold" : "Awaiting first review"} tone="violet" />
        </section>

        {isProgressPage && personalProgress && <div className="progress-personal">{personalProgress}</div>}

        {hasReviewedParticipants && topPerformers.length > 0 && <motion.section
          className="progress-spotlight"
          aria-labelledby="spotlight-title"
          initial={reduceMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: reduceMotion ? 0 : 0.1 }}
        >
          <div className="section-heading">
            <div><p className="section-kicker">TOP PERFORMERS</p><h2 id="spotlight-title">Leading the climb.</h2></div>
            <p>{snapshot.dataMode === "demo" ? "Synthetic examples preview the top-performer layout; they are not participant data." : "Ranked by verified Skill Badges. Arcade badges are a separate achievement and never change rank."}</p>
          </div>
          <div className="podium-grid">
            {topPerformers.map(({ participant, rank }, index) => <PodiumCard key={participant.id} participant={participant} rank={rank} place={index + 1} isDemo={snapshot.dataMode === "demo"} onSelect={setSelected} reduceMotion={reduceMotion} />)}
          </div>
        </motion.section>}

        {hasReviewedParticipants && <motion.section
          className="progress-distribution"
          aria-labelledby="distribution-title"
          initial={reduceMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: reduceMotion ? 0 : 0.14 }}
        >
          <div className="section-heading">
            <div><p className="section-kicker">PROGRESS DISTRIBUTION</p><h2 id="distribution-title">Where the community stands.</h2></div>
            <p>Skill Badge progress across reviewed records. The 10-badge mark is the rank-freeze threshold.</p>
          </div>
          <div className="distribution-card">
            <ul className="distribution-chart">
              {skillDistribution.buckets.map((bucket) => {
                const percent = skillDistribution.classifiedCount > 0 ? Math.round((bucket.count / skillDistribution.classifiedCount) * 100) : 0;
                return <li className="distribution-row" key={bucket.key}>
                  <span className="distribution-label">{bucket.label}</span>
                  <span className="distribution-track" aria-hidden="true"><span className={`distribution-fill tone-${bucket.tone}`} style={{ width: bucket.count === 0 ? "0%" : `${Math.max(3, percent)}%` }} /></span>
                  <span className="distribution-count"><strong>{bucket.count}</strong><small>{percent}%</small></span>
                </li>;
              })}
            </ul>
            <div className="distribution-summary">
              <div className="distribution-stats">
                <div><strong>{snapshot.totalSkillBadges.toLocaleString("en-IN")}</strong><span>Skill badges recorded</span></div>
                <div><strong>{snapshot.totalArcadeBadges.toLocaleString("en-IN")}</strong><span>Arcade game badges</span></div>
              </div>
              <p className="distribution-note">{skillDistribution.classifiedCount} of {reviewedParticipants.length} reviewed participants classified. {reviewedParticipants.length - skillDistribution.classifiedCount > 0 ? `${(reviewedParticipants.length - skillDistribution.classifiedCount).toLocaleString("en-IN")} still awaiting classification.` : "Every reviewed participant has a classification."}</p>
            </div>
          </div>
        </motion.section>}

        {snapshot.dataMode === "database" && awaitingVerification > 0 && <section className="verification-notice" role="status" aria-live="polite">
          <span className="verification-notice-icon"><ShieldCheck size={19} aria-hidden="true" /></span>
          <div><strong>Badge counts are awaiting manual verification</strong><p>{awaitingVerification.toLocaleString("en-IN")} participant {awaitingVerification === 1 ? "record has" : "records have"} no verification timestamp. A registration default of 0 is not confirmation that someone has earned no badges. Counts appear as verified only after an administrator reviews evidence.</p></div>
        </section>}

        <motion.section
          className="leaderboard-panel"
          aria-labelledby="leaderboard-title"
          initial={reduceMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: reduceMotion ? 0 : 0.16 }}
        >
          <div className="leaderboard-heading">
            <div>
              <div className="leaderboard-title-line"><span className="leaderboard-icon"><Medal size={18} aria-hidden="true" /></span><h2 id="leaderboard-title">{isProgressPage ? "Participant progress" : "Community leaderboard"}</h2><span className="results-count">{visible.length}</span></div>
              <p>{snapshot.dataMode === "demo" ? "Synthetic examples preview the ranking layout; they are not participant data." : "Ranked by verified Skill Badges. Arcade badges are shown separately and never affect rank. Unreviewed registrations stay unranked until evidence is reviewed."}</p>
            </div>
            <div className="freshness-indicator"><span aria-hidden="true" />{snapshot.dataMode === "demo" ? "Demo mode" : "Leaderboard"}</div>
          </div>

          <div className="leaderboard-controls">
            <label className="participant-search">
              <Search size={16} aria-hidden="true" />
              <span className="sr-only">Search participants by name</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by participant name" />
              {search && <button type="button" className="clear-search" onClick={() => setSearch("")} aria-label="Clear search"><X size={14} /></button>}
            </label>
            <div className="rank-filters" role="group" aria-label="Filter by Skill Badge rank threshold">
              <FilterButton current={filter} value="all" onSelect={setFilter}>All participants</FilterButton>
              <FilterButton current={filter} value="ten" onSelect={setFilter}>10+ Skill badges</FilterButton>
            </div>
          </div>

          {visible.length === 0 ? (
            <EmptyState hasParticipants={participants.length > 0} isDemo={snapshot.dataMode === "demo"} onReset={() => { setSearch(""); setFilter("all"); }} />
          ) : (
            <>
              <div className="desktop-leaderboard">
                <table className="community-table">
                  <thead>
                    <tr>
                      <th scope="col">RANK</th>
                      <th scope="col">PARTICIPANT</th>
                      <th scope="col">SKILL BADGES</th>
                      <th scope="col">ARCADE BADGES</th>
                      <th scope="col">TOTAL</th>
                      <th scope="col">PROGRESS</th>
                      <th scope="col">STATUS</th>
                    </tr>
                  </thead>
                  <tbody>{visible.map(({ participant, rank }) => {
                    const count = participant.verifiedBadgeCount;
                    return <tr key={participant.id}>
                      <td><RankBadge rank={rank} frozen={Boolean(participant.frozenRank)} /></td>
                      <td><button type="button" className="participant-cell" onClick={() => setSelected(participant)} aria-label={`Open participant details for ${participant.displayName}`}><Avatar participant={participant} /><span><strong>{participant.displayName}</strong><small>{snapshot.dataMode === "demo" ? "Synthetic example" : "Registered participant"}</small></span></button></td>
                      <td>{participant.lastCheckedAt ? <span className="badge-total"><Award size={15} aria-hidden="true" />{participant.skillBadgeCount !== null ? participant.skillBadgeCount : "—"}<small>{participant.skillBadgeCount !== null ? "skill" : "unclassified"}</small></span> : <span className="badge-unreviewed">Not reviewed</span>}</td>
                      <td>{participant.lastCheckedAt ? <span>{participant.arcadeGameBadgeCount !== null ? participant.arcadeGameBadgeCount : "—"}</span> : <span className="badge-unreviewed">—</span>}</td>
                      <td>{participant.lastCheckedAt ? <strong>{count}</strong> : <span className="badge-unreviewed">—</span>}</td>
                      <td>{participant.lastCheckedAt ? (participant.skillBadgeCount !== null ? <ProgressMeter count={participant.skillBadgeCount} target={10} /> : <span className="progress-unavailable">Not classified</span>) : <span className="progress-unavailable">After review</span>}</td>
                      <td>{participant.lastCheckedAt ? <RankStatus skillBadgeCount={participant.skillBadgeCount} frozenRank={participant.frozenRank} /> : <span className="status-unreviewed">Awaiting verification</span>}</td>
                    </tr>;
                  })}</tbody>
                </table>
              </div>
              <ul className="mobile-leaderboard" aria-label="Leaderboard participants">
                {visible.map(({ participant, rank }) => {
                  const count = participant.verifiedBadgeCount;
                  return <li key={participant.id}><button type="button" className="mobile-participant" onClick={() => setSelected(participant)} aria-label={`Open participant details for ${participant.displayName}`}>
                    <span className="mobile-participant-top">
                      <RankBadge rank={rank} frozen={Boolean(participant.frozenRank)} />
                      <Avatar participant={participant} />
                      <span className="mobile-person-copy">
                        <strong>{participant.displayName}</strong>
                        <small>{snapshot.dataMode === "demo" ? "Synthetic example" : "Registered participant"}</small>
                      </span>
                      {participant.frozenRank ? (
                        <span className="rank-frozen-chip" title="Rank locked after reaching 10 skill badges">
                          <Lock size={10} aria-hidden="true" />
                          <span>Locked</span>
                        </span>
                      ) : null}
                    </span>
                    {participant.lastCheckedAt ? (
                      <span className="mobile-badges-row">
                        <span className="mobile-badge-pill pill-skill"><Award size={12} aria-hidden="true" /><strong>{participant.skillBadgeCount ?? "—"}</strong> Skill</span>
                        <span className="mobile-badge-pill pill-arcade"><Gamepad2 size={12} aria-hidden="true" /><strong>{participant.arcadeGameBadgeCount ?? "—"}</strong> Arcade</span>
                        <span className="mobile-badge-pill pill-total"><strong>{count}</strong> Total</span>
                      </span>
                    ) : (
                      <span className="mobile-badges-row"><span className="badge-unreviewed">Not reviewed</span></span>
                    )}
                    <span className="mobile-participant-bottom">
                      {participant.lastCheckedAt ? (participant.skillBadgeCount !== null ? <ProgressMeter count={participant.skillBadgeCount} target={10} /> : <span className="progress-unavailable">Skill badges not classified</span>) : <span className="progress-unavailable">Progress appears after manual review</span>}
                      {participant.lastCheckedAt && <RankStatus skillBadgeCount={participant.skillBadgeCount} frozenRank={participant.frozenRank} />}
                    </span>
                  </button></li>;
                })}
              </ul>
            </>
          )}
          <div className="leaderboard-footer"><span>Showing <strong>{visible.length}</strong> of <strong>{participants.length}</strong> {snapshot.dataMode === "demo" ? "synthetic records" : "participants"}</span><span><Clock3 size={13} aria-hidden="true" /> Updated: {formatTimestamp(lastSyncedAt)} IST</span></div>
        </motion.section>

        {isProgressPage && <section className="history-section progress-history" aria-labelledby="history-title">
          <div className="section-heading"><div><p className="section-kicker">COMMUNITY HISTORY</p><h2 id="history-title">Ideas into impact.</h2></div><p>Past highlights, shown separately from live participant progress.</p></div>
          <div className="history-grid">
            <article className="history-card history-cloud"><span className="history-year">2025 · LEARNING</span><h3>Google Cloud Study Jams</h3><p>GDG ACEIT publicly reported 500+ registrations and 100+ learners earning perfect lab completion scores.</p><a href="https://in.linkedin.com/company/gdg-aceit" target="_blank" rel="noreferrer">Community announcement <ExternalLink size={13} aria-hidden="true" /></a></article>
            <article className="history-card history-sprint"><span className="history-year">2025–26 · BUILDING</span><h3>TechSprint</h3><p>An AI-focused hackathon initiative that brought student ideas into a collaborative build-and-pitch experience.</p><a href="https://in.linkedin.com/company/gdg-aceit" target="_blank" rel="noreferrer">Community announcement <ExternalLink size={13} aria-hidden="true" /></a></article>
            <article className="history-card history-medha"><span className="history-year">TECHSPRINT · COMMUNITY REPORTED</span><h3>Team Medha · 1st place</h3><p>A public community repost celebrated Team Medha’s first-place finish at GDG TechSprint.</p><a href="https://in.linkedin.com/company/gdg-aceit" target="_blank" rel="noreferrer">Community repost <ExternalLink size={13} aria-hidden="true" /></a></article>
          </div>
        </section>}

        {isProgressPage && diagnostics && <div className="progress-diagnostics">{diagnostics}</div>}

        <CommunityFooter />
      </main>
      <AnimatePresence>{selected && <ParticipantDialog key={selected.id} participant={selected} onClose={() => setSelected(null)} reduceMotion={reduceMotion} />}</AnimatePresence>
    </div>
  );
}

function PodiumCard({ participant, rank, place, isDemo, onSelect, reduceMotion }: {
  participant: PublicParticipant;
  rank: number | null;
  place: number;
  isDemo: boolean;
  onSelect: (participant: PublicParticipant) => void;
  reduceMotion: boolean | null;
}) {
  return <motion.button
    type="button"
    className={`podium-card podium-place-${place}`}
    onClick={() => onSelect(participant)}
    aria-label={`Open participant details for ${participant.displayName}, rank ${rank ?? "unranked"}`}
    initial={reduceMotion ? false : { opacity: 0, y: 14 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: reduceMotion ? 0 : .34, delay: reduceMotion ? 0 : .06 * (place - 1) }}
    whileHover={reduceMotion ? undefined : { y: -3 }}
  >
    <span className="podium-topline">
      <span className="podium-place"><Medal size={15} aria-hidden="true" />{rank != null ? `#${rank}` : "—"}</span>
      <span className="podium-label">{place === 1 ? "Top contributor" : place === 2 ? "Runner-up" : "Third place"}</span>
    </span>
    <span className="podium-identity">
      <Avatar participant={participant} />
      <span className="podium-name"><strong>{participant.displayName}</strong><small>{isDemo ? "Synthetic example" : "Registered participant"}</small></span>
    </span>
    <span className="podium-pills">
      <span className="podium-pill pill-skill"><Award size={12} aria-hidden="true" /><strong>{participant.skillBadgeCount ?? "—"}</strong>Skill</span>
      <span className="podium-pill pill-arcade"><Gamepad2 size={12} aria-hidden="true" /><strong>{participant.arcadeGameBadgeCount ?? "—"}</strong>Arcade</span>
      <span className="podium-pill pill-total"><strong>{participant.verifiedBadgeCount}</strong>Total</span>
    </span>
    <ProgressMeter count={participant.skillBadgeCount ?? 0} target={10} />
  </motion.button>;
}

function SummaryCard({ icon, label, value, detail, tone, index, reduceMotion }: { icon: ReactNode; label: string; value: number | string; detail: string; tone: string; index: number; reduceMotion: boolean | null }) {
  const formattedValue = typeof value === "number" ? value.toLocaleString("en-IN") : value;
  return <motion.article className="summary-card" initial={{ opacity: 0, y: reduceMotion ? 0 : 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? 0 : .34, delay: reduceMotion ? 0 : index * .06 }} whileHover={reduceMotion ? undefined : { y: -2 }}><span className={`summary-icon ${tone}`} aria-hidden="true">{icon}</span><p>{label}</p><strong className="summary-value">{formattedValue}</strong><small>{detail}</small></motion.article>;
}

function FilterButton({ current, value, onSelect, children }: { current: FilterKey; value: FilterKey; onSelect: (value: FilterKey) => void; children: ReactNode }) {
  return <button type="button" className={current === value ? "filter-option is-active" : "filter-option"} aria-pressed={current === value} onClick={() => onSelect(value)}>{children}</button>;
}

function Avatar({ participant }: { participant: PublicParticipant }) {
  return <span className={`person-avatar avatar-${participant.color}`}>{participant.initials}</span>;
}

function RankBadge({ rank, frozen }: { rank: number | null; frozen?: boolean }) {
  if (rank === null) return <span className="rank-badge rank-unreviewed" aria-label="Unranked until badge verification">—</span>;
  return (
    <span
      className={`${rank <= 3 ? `rank-badge rank-${rank}` : "rank-badge"}${frozen ? " rank-frozen" : ""}`}
      title={frozen ? `Rank #${rank} (Locked at 10 skill badges)` : undefined}
    >
      {rank <= 3 ? <Medal size={15} aria-label={`Rank ${rank}`} /> : `#${rank}`}
      {frozen && <Lock size={10} className="rank-lock-icon" aria-label="Frozen rank" />}
    </span>
  );
}

function ProgressMeter({ count, target }: { count: number; target: number }) {
  const value = Math.min(count, target);
  return <span className="progress-meter"><span className="progress-meter-label">{target} skill badges</span><span className="progress-track" role="progressbar" aria-label={`Progress toward ${target} skill badges`} aria-valuemin={0} aria-valuemax={target} aria-valuenow={value}><span style={{ width: `${(value / target) * 100}%` }} /></span><small>{value}/{target}</small></span>;
}

function RankStatus({ skillBadgeCount, frozenRank }: { skillBadgeCount: number | null; frozenRank?: number | null }) {
  if (skillBadgeCount === null) return <span className="rank-status status-progress">Unclassified</span>;
  if (qualifiesForRankFreeze(skillBadgeCount)) {
    return frozenRank != null
      ? <span className="rank-status status-ten"><Check size={12} aria-hidden="true" />Rank locked</span>
      : <span className="rank-status status-ten"><Check size={12} aria-hidden="true" />Threshold met</span>;
  }
  return <span className="rank-status status-progress">In progress</span>;
}

function EmptyState({ hasParticipants, isDemo, onReset }: { hasParticipants: boolean; isDemo: boolean; onReset: () => void }) {
  const title = hasParticipants ? "No participants match these filters" : isDemo ? "No demo records available" : "No participants yet";
  const description = hasParticipants ? "Try another name or choose a different rank filter." : isDemo ? "The active demo provider returned no participant records." : "Registered participant records will appear here after they are added by an administrator.";
  return <div className="leaderboard-empty" role="status"><span className="empty-icon"><Search size={18} aria-hidden="true" /></span><strong>{title}</strong><p>{description}</p>{hasParticipants && <button type="button" onClick={onReset}>Clear search and filters</button>}</div>;
}

function ParticipantDialog({ participant, onClose, reduceMotion }: { participant: PublicParticipant; onClose: () => void; reduceMotion: boolean | null }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const count = participant.verifiedBadgeCount;
  const hasReviewedCount = Boolean(participant.lastCheckedAt);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    return () => previousFocus?.focus();
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
    if (event.key !== "Tab") return;
    const focusable = event.currentTarget.querySelectorAll<HTMLElement>('button, a[href], summary, [tabindex="0"]');
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };

  return <motion.div className="profile-backdrop" onMouseDown={(event: React.MouseEvent<HTMLDivElement>) => { if (event.target === event.currentTarget) onClose(); }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduceMotion ? 0 : .17 }}>
    <motion.section className="profile-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-title" aria-describedby="profile-disclaimer" onKeyDown={handleKeyDown} initial={{ x: reduceMotion ? 0 : 24, opacity: reduceMotion ? 1 : .8 }} animate={{ x: 0, opacity: 1 }} exit={{ x: reduceMotion ? 0 : 18, opacity: reduceMotion ? 1 : .7 }} transition={{ duration: reduceMotion ? 0 : .2 }}>
      <button ref={closeButton} type="button" className="profile-close" onClick={onClose} aria-label="Close participant details"><X size={18} /></button>
      <div className="profile-heading"><Avatar participant={participant} /><div><span className="profile-kicker">{participant.badges ? "SYNTHETIC DEMO PROFILE" : "PARTICIPANT PROFILE"}</span><h2 id="profile-title">{participant.displayName}</h2><span className="profile-sample"><span />{participant.badges ? "Example record" : "Registered participant"}</span></div></div>
      <div className="profile-summary">
        <div>
          <strong>{participant.lastCheckedAt ? (participant.skillBadgeCount !== null ? `${participant.skillBadgeCount} Skill / ${participant.arcadeGameBadgeCount ?? 0} Arcade` : count) : "Awaiting"}</strong>
          <span>{participant.lastCheckedAt ? (participant.skillBadgeCount !== null ? `Total: ${count} badges` : "verified badges") : "manual verification"}</span>
        </div>
        <div>
          <strong>{participant.frozenRank ? `Rank #${participant.frozenRank} (Locked)` : participant.lastCheckedAt ? (qualifiesForRankFreeze(participant.skillBadgeCount) ? "Rank threshold met" : "In progress") : "Not ranked"}</strong>
          <span>{participant.frozenRank ? "rank locked at 10 Skill Badges" : "rank status"}</span>
        </div>
      </div>
      <section className="profile-progress" aria-labelledby="progress-title">
        <div className="profile-section-heading">
          <h3 id="progress-title">Skill badge progress</h3>
          <span>{participant.lastCheckedAt ? (participant.skillBadgeCount !== null ? `${participant.skillBadgeCount} Skill ${participant.skillBadgeCount === 1 ? "badge" : "badges"}` : "Not yet classified") : "Not yet available"}</span>
        </div>
        {participant.lastCheckedAt
          ? (participant.skillBadgeCount !== null
            ? <ProgressMeter count={participant.skillBadgeCount} target={10} />
            : <p className="profile-no-badges">Skill and Arcade badge classification is not available for this participant yet.</p>)
          : <p className="profile-no-badges">A registration default is not an evidence-reviewed badge count. Progress will appear after manual verification.</p>}
      </section>
      <section className="profile-badges" aria-labelledby="badges-title"><div className="profile-section-heading"><h3 id="badges-title">Badge records</h3><span>{hasReviewedCount ? count : "—"}</span></div>
        {!hasReviewedCount ? <p className="profile-no-badges" role="status">No badge records have been submitted for manual review yet.</p> : participant.badges?.length ? <ul>{participant.badges.filter((badge) => badge.status === "verified").map((badge) => <li key={badge.id}><span className="profile-badge-icon"><BadgeCheck size={15} aria-hidden="true" /></span><span className="profile-badge-copy"><strong>{badge.name}</strong><small>Observed {formatTimestamp(badge.verifiedAt)} IST</small></span></li>)}</ul> : count > 0 ? <p className="profile-no-badges">This participant record stores an aggregate count; individual badge names are not available.</p> : <p className="profile-no-badges" role="status">No badge records were confirmed in the latest manual review.</p>}
      </section>
      {participant.profileUrl ? <a className="public-profile-link" href={participant.profileUrl} target="_blank" rel="noreferrer"><span><ExternalLink size={15} aria-hidden="true" />Open public profile</span><ExternalLink size={14} aria-hidden="true" /></a> : <p className="profile-no-link">No public profile link is provided for this record.</p>}
      <section className="verification-card" aria-labelledby="verification-title"><div className="verification-card-heading"><ShieldCheck size={16} aria-hidden="true" /><h3 id="verification-title">Verification information</h3></div><dl><div><dt>Provider</dt><dd>{participant.verificationSource ?? "Not recorded"}</dd></div><div><dt>Last checked</dt><dd>{participant.lastCheckedAt ? <time dateTime={participant.lastCheckedAt}>{formatTimestamp(participant.lastCheckedAt)} IST</time> : "No count verification recorded"}</dd></div></dl><p id="profile-disclaimer">{participant.badges ? "Synthetic data only. Demo status does not mean Google verified this profile or its badges." : "Community-recorded data is not verified by Google unless explicitly supported by evidence."} Observed timestamps are separate from badge-earned timestamps; earned dates are not inferred from count updates.</p></section>
    </motion.section>
  </motion.div>;
}

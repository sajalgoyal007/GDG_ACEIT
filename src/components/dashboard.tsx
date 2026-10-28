"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Award, BadgeCheck, Check, Clock3, ExternalLink, Medal, RefreshCw, Search, ShieldCheck, Users, X } from "lucide-react";
import { CommunityFooter } from "@/components/community-footer";
import { CommunityNavigation } from "@/components/community-navigation";
import type { LeaderboardSnapshot, PublicParticipant } from "@/lib/types";
import { getMilestoneLabel, hasMilestone, rankParticipants } from "@/lib/leaderboard";

type FilterKey = "all" | "five" | "ten";

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

export function Dashboard({ snapshot, view = "dashboard" }: { snapshot: LeaderboardSnapshot; view?: "dashboard" | "progress" }) {
  const { participants, registeredCount, totalVerifiedBadges, fiveBadgeCount, tenBadgeCount, lastSyncedAt } = snapshot;
  const isProgressPage = view === "progress";
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [selected, setSelected] = useState<PublicParticipant | null>(null);
  const reduceMotion = useReducedMotion();

  const ranked = useMemo(() => rankParticipants(participants), [participants]);
  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return ranked.filter(({ participant }) => {
      const matchesName = !query || participant.displayName.toLocaleLowerCase().includes(query);
      const count = participant.verifiedBadgeCount;
      const matchesMilestone = filter === "all" || (filter === "five" ? hasMilestone(count, 5) : hasMilestone(count, 10));
      return matchesName && matchesMilestone;
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
            <p className="hero-description">{isProgressPage ? "Track recorded learning milestones and see how our community is progressing together." : "Learn new skills. Build practical projects. Connect with developers shaping what comes next."}</p>
            <div className="hero-actions">
              <Link className="button-primary" href={isProgressPage ? "/" : "/progress"}>{isProgressPage ? "View leaderboard" : "Explore progress"}<span aria-hidden="true">↗</span></Link>
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
          <SummaryCard index={1} reduceMotion={reduceMotion} icon={<BadgeCheck size={18} />} label="Recorded Skill Badges" value={totalVerifiedBadges} detail="Community recorded · not Google verified" tone="green" />
          <SummaryCard index={2} reduceMotion={reduceMotion} icon={<Medal size={18} />} label="Reached 5+ badges" value={fiveBadgeCount} detail="Current milestone count" tone="amber" />
          <SummaryCard index={3} reduceMotion={reduceMotion} icon={<Award size={18} />} label="Reached 10+ badges" value={tenBadgeCount} detail="Current milestone count" tone="violet" />
        </section>

        {isProgressPage && <section className="history-section" aria-labelledby="history-title">
          <div className="section-heading"><div><p className="section-kicker">COMMUNITY HISTORY</p><h2 id="history-title">Ideas into impact.</h2></div><p>Past highlights, shown separately from live participant progress.</p></div>
          <div className="history-grid">
            <article className="history-card history-cloud"><span className="history-year">2025 · LEARNING</span><h3>Google Cloud Study Jams</h3><p>GDG ACEIT publicly reported 500+ registrations and 100+ learners earning perfect lab completion scores.</p><a href="https://in.linkedin.com/company/gdg-aceit" target="_blank" rel="noreferrer">Community announcement <ExternalLink size={13} aria-hidden="true" /></a></article>
            <article className="history-card history-sprint"><span className="history-year">2025–26 · BUILDING</span><h3>TechSprint</h3><p>An AI-focused hackathon initiative that brought student ideas into a collaborative build-and-pitch experience.</p><a href="https://in.linkedin.com/company/gdg-aceit" target="_blank" rel="noreferrer">Community announcement <ExternalLink size={13} aria-hidden="true" /></a></article>
            <article className="history-card history-medha"><span className="history-year">TECHSPRINT · COMMUNITY REPORTED</span><h3>Team Medha · 1st place</h3><p>A public community repost celebrated Team Medha’s first-place finish at GDG TechSprint.</p><a href="https://in.linkedin.com/company/gdg-aceit" target="_blank" rel="noreferrer">Community repost <ExternalLink size={13} aria-hidden="true" /></a></article>
          </div>
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
              <p>Ranked by recorded badge count. Equal counts share a rank; participant ID breaks display-order ties.</p>
            </div>
            <div className="freshness-indicator"><span aria-hidden="true" />{snapshot.dataMode === "demo" ? "Demo provider" : "Supabase"}</div>
          </div>

          <div className="leaderboard-controls">
            <label className="participant-search">
              <Search size={16} aria-hidden="true" />
              <span className="sr-only">Search participants by name</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by participant name" />
              {search && <button type="button" className="clear-search" onClick={() => setSearch("")} aria-label="Clear search"><X size={14} /></button>}
            </label>
            <div className="milestone-filters" role="group" aria-label="Filter by badge milestone">
              <FilterButton current={filter} value="all" onSelect={setFilter}>All participants</FilterButton>
              <FilterButton current={filter} value="five" onSelect={setFilter}>5+ badges</FilterButton>
              <FilterButton current={filter} value="ten" onSelect={setFilter}>10+ badges</FilterButton>
            </div>
          </div>

          {visible.length === 0 ? (
            <EmptyState hasParticipants={participants.length > 0} isDemo={snapshot.dataMode === "demo"} onReset={() => { setSearch(""); setFilter("all"); }} />
          ) : (
            <>
              <div className="desktop-leaderboard">
                <table className="community-table">
                  <thead><tr><th scope="col">RANK</th><th scope="col">PARTICIPANT</th><th scope="col">VERIFIED BADGES</th><th scope="col">PROGRESS</th><th scope="col">STATUS</th></tr></thead>
                  <tbody>{visible.map(({ participant, rank }) => {
                    const count = participant.verifiedBadgeCount;
                    return <tr key={participant.id}>
                      <td><RankBadge rank={rank} /></td>
                      <td><button type="button" className="participant-cell" onClick={() => setSelected(participant)} aria-label={`Open participant details for ${participant.displayName}`}><Avatar participant={participant} /><span><strong>{participant.displayName}</strong><small>{snapshot.dataMode === "demo" ? "Synthetic example" : "Registered participant"}</small></span></button></td>
                      <td><span className="badge-total"><Award size={15} aria-hidden="true" />{count}<small>badges</small></span></td>
                      <td><ProgressPair count={count} /></td>
                      <td><MilestoneBadge count={count} /></td>
                    </tr>;
                  })}</tbody>
                </table>
              </div>
              <ul className="mobile-leaderboard" aria-label="Leaderboard participants">
                {visible.map(({ participant, rank }) => {
                  const count = participant.verifiedBadgeCount;
                  return <li key={participant.id}><button type="button" className="mobile-participant" onClick={() => setSelected(participant)} aria-label={`Open participant details for ${participant.displayName}`}>
                    <span className="mobile-participant-top"><RankBadge rank={rank} /><Avatar participant={participant} /><span className="mobile-person-copy"><strong>{participant.displayName}</strong><small>{snapshot.dataMode === "demo" ? "Synthetic example" : "Registered participant"}</small></span><span className="mobile-badge-total"><Award size={15} aria-hidden="true" />{count}</span></span>
                    <span className="mobile-participant-bottom"><ProgressPair count={count} /><MilestoneBadge count={count} /></span>
                  </button></li>;
                })}
              </ul>
            </>
          )}
          <div className="leaderboard-footer"><span>Showing <strong>{visible.length}</strong> of <strong>{participants.length}</strong> {snapshot.dataMode === "demo" ? "synthetic records" : "participants"}</span><span><Clock3 size={13} aria-hidden="true" /> Updated: {formatTimestamp(lastSyncedAt)} IST</span></div>
        </motion.section>

        <CommunityFooter />
      </main>
      <AnimatePresence>{selected && <ParticipantDialog key={selected.id} participant={selected} onClose={() => setSelected(null)} reduceMotion={reduceMotion} />}</AnimatePresence>
    </div>
  );
}

function SummaryCard({ icon, label, value, detail, tone, index, reduceMotion }: { icon: ReactNode; label: string; value: number; detail: string; tone: string; index: number; reduceMotion: boolean | null }) {
  return <motion.article className="summary-card" initial={{ opacity: 0, y: reduceMotion ? 0 : 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? 0 : .34, delay: reduceMotion ? 0 : index * .06 }} whileHover={reduceMotion ? undefined : { y: -2 }}><span className={`summary-icon ${tone}`} aria-hidden="true">{icon}</span><p>{label}</p><strong className="summary-value">{value.toLocaleString("en-IN")}</strong><small>{detail}</small></motion.article>;
}

function FilterButton({ current, value, onSelect, children }: { current: FilterKey; value: FilterKey; onSelect: (value: FilterKey) => void; children: ReactNode }) {
  return <button type="button" className={current === value ? "filter-option is-active" : "filter-option"} aria-pressed={current === value} onClick={() => onSelect(value)}>{children}</button>;
}

function Avatar({ participant }: { participant: PublicParticipant }) {
  return <span className={`person-avatar avatar-${participant.color}`}>{participant.initials}</span>;
}

function RankBadge({ rank }: { rank: number }) {
  return <span className={rank <= 3 ? `rank-badge rank-${rank}` : "rank-badge"}>{rank <= 3 ? <Medal size={15} aria-label={`Rank ${rank}`} /> : `#${rank}`}</span>;
}

function ProgressPair({ count }: { count: number }) {
  return <div className="progress-pair" aria-label={`${count} badges: ${Math.min(count, 5)} of 5 and ${Math.min(count, 10)} of 10 toward milestones`}>
    <ProgressMeter count={count} target={5} />
    <ProgressMeter count={count} target={10} />
  </div>;
}

function ProgressMeter({ count, target }: { count: number; target: number }) {
  const value = Math.min(count, target);
  return <span className="progress-meter"><span className="progress-meter-label">{target} badges</span><span className="progress-track" role="progressbar" aria-label={`Progress toward ${target} badges`} aria-valuemin={0} aria-valuemax={target} aria-valuenow={value}><span style={{ width: `${(value / target) * 100}%` }} /></span><small>{value}/{target}</small></span>;
}

function MilestoneBadge({ count }: { count: number }) {
  const kind = count >= 10 ? "milestone-status status-ten" : count >= 5 ? "milestone-status status-five" : "milestone-status status-progress";
  return <span className={kind}>{count >= 5 && <Check size={12} aria-hidden="true" />}{getMilestoneLabel(count)}</span>;
}

function EmptyState({ hasParticipants, isDemo, onReset }: { hasParticipants: boolean; isDemo: boolean; onReset: () => void }) {
  const title = hasParticipants ? "No participants match these filters" : isDemo ? "No demo records available" : "No participants yet";
  const description = hasParticipants ? "Try another name or choose a different badge milestone." : isDemo ? "The active demo provider returned no participant records." : "Registered participant records will appear here after they are added by an administrator.";
  return <div className="leaderboard-empty" role="status"><span className="empty-icon"><Search size={18} aria-hidden="true" /></span><strong>{title}</strong><p>{description}</p>{hasParticipants && <button type="button" onClick={onReset}>Clear search and filters</button>}</div>;
}

function ParticipantDialog({ participant, onClose, reduceMotion }: { participant: PublicParticipant; onClose: () => void; reduceMotion: boolean | null }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const count = participant.verifiedBadgeCount;

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
      <div className="profile-summary"><div><strong>{count}</strong><span>badge records</span></div><div><strong>{getMilestoneLabel(count)}</strong><span>milestone status</span></div></div>
      <section className="profile-progress" aria-labelledby="progress-title"><div className="profile-section-heading"><h3 id="progress-title">Milestone progress</h3><span>{count} total</span></div><ProgressMeter count={count} target={5} /><ProgressMeter count={count} target={10} /></section>
      <section className="profile-badges" aria-labelledby="badges-title"><div className="profile-section-heading"><h3 id="badges-title">Badge records</h3><span>{count}</span></div>
        {participant.badges?.length ? <ul>{participant.badges.filter((badge) => badge.status === "verified").map((badge) => <li key={badge.id}><span className="profile-badge-icon"><BadgeCheck size={15} aria-hidden="true" /></span><span className="profile-badge-copy"><strong>{badge.name}</strong><small>Observed {formatTimestamp(badge.verifiedAt)} IST</small></span></li>)}</ul> : count > 0 ? <p className="profile-no-badges">This database record stores an aggregate count; individual badge names are not available.</p> : <p className="profile-no-badges" role="status">No badge records in this profile.</p>}
      </section>
      {participant.profileUrl ? <a className="public-profile-link" href={participant.profileUrl} target="_blank" rel="noreferrer"><span><ExternalLink size={15} aria-hidden="true" />Open public profile</span><ExternalLink size={14} aria-hidden="true" /></a> : <p className="profile-no-link">No public profile link is provided for this record.</p>}
      <section className="verification-card" aria-labelledby="verification-title"><div className="verification-card-heading"><ShieldCheck size={16} aria-hidden="true" /><h3 id="verification-title">Verification information</h3></div><dl><div><dt>Provider</dt><dd>{participant.verificationSource ?? "Not recorded"}</dd></div><div><dt>Last checked</dt><dd>{participant.lastCheckedAt ? <time dateTime={participant.lastCheckedAt}>{formatTimestamp(participant.lastCheckedAt)} IST</time> : "No count verification recorded"}</dd></div></dl><p id="profile-disclaimer">{participant.badges ? "Synthetic data only. Demo status does not mean Google verified this profile or its badges." : "Provider-recorded data is not verified by Google unless explicitly supported by evidence."} Observed timestamps are separate from badge-earned timestamps; earned dates are not inferred from count updates.</p></section>
    </motion.section>
  </motion.div>;
}

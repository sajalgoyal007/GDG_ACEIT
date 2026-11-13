"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  ArrowUpRight,
  Award,
  BadgeCheck,
  Code2,
  Gamepad2,
  GitBranch,
  Lock,
  Medal,
  RefreshCw,
  Sparkles,
  Trophy,
  Users,
} from "lucide-react";
import { CommunityFooter } from "@/components/community-footer";
import { CommunityNavigation } from "@/components/community-navigation";
import { Tilt } from "@/components/tilt";
import {
  Avatar,
  formatShortDate,
  formatTimestamp,
  ParticipantDialog,
  ProgressMeter,
} from "@/components/leaderboard-ui";
import type { LeaderboardSnapshot, PublicParticipant } from "@/lib/types";
import { rankParticipants } from "@/lib/leaderboard";

type RankedParticipant = { participant: PublicParticipant; rank: number | null };

const kpiDefinitions = [
  { key: "registered", label: "Registered Builders", detail: "Students in the campaign", icon: Users, tone: "blue" },
  { key: "verified", label: "Total Verified Badges", detail: "Skill + Arcade", icon: BadgeCheck, tone: "red" },
  { key: "skill", label: "Skill Badges", detail: "Primary leaderboard metric", icon: Award, tone: "yellow" },
  { key: "frozen", label: "Frozen Ranks", detail: "Locked at 10+ Skill", icon: Lock, tone: "green" },
] as const;

const roadmap = [
  {
    step: "01",
    title: "Join & map profile",
    detail: "Register with your Google developer profile so the chapter can track your campaign path.",
    icon: Users,
    tone: "blue",
  },
  {
    step: "02",
    title: "Complete Skill & Arcade labs",
    detail: "Work through Google Cloud Skill Badges and Arcade labs at your own pace with the community.",
    icon: Code2,
    tone: "yellow",
  },
  {
    step: "03",
    title: "Lock your frozen rank",
    detail: "Reach 10 Skill Badges to capture a permanent frozen rank on the chapter leaderboard.",
    icon: Lock,
    tone: "green",
  },
] as const;

export function HomeHub({ snapshot }: { snapshot: LeaderboardSnapshot }) {
  const { participants, registeredCount, lastSyncedAt } = snapshot;
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [isRefreshing, startRefresh] = useTransition();
  const [selected, setSelected] = useState<PublicParticipant | null>(null);

  const ranked = useMemo(() => rankParticipants(participants), [participants]);
  const rankedParticipants = useMemo(() => ranked.filter((entry) => entry.rank !== null), [ranked]);
  const podium = rankedParticipants.slice(0, 3);
  const topTen = rankedParticipants.slice(0, 10);
  const reviewedCount = participants.filter((participant) => participant.lastCheckedAt).length;
  const hasReviewedParticipants = reviewedCount > 0;
  const awaitingVerification = participants.length - reviewedCount;
  const isDemo = snapshot.dataMode === "demo";
  const builderCount = registeredCount || participants.length;

  const kpiValues: Record<(typeof kpiDefinitions)[number]["key"], number | string> = {
    registered: builderCount,
    verified: !isDemo && !hasReviewedParticipants ? "—" : snapshot.totalVerifiedBadges,
    skill: !isDemo && !hasReviewedParticipants ? "—" : snapshot.totalSkillBadges,
    frozen: !isDemo && !hasReviewedParticipants ? "—" : snapshot.frozenRankCount,
  };

  return (
    <div className="g-app">
      <CommunityNavigation dataMode={snapshot.dataMode} />

      <main className="g-main">
        <section className="g-hero" aria-labelledby="home-title">
          <motion.div
            className="g-hero-copy"
            initial={reduceMotion ? false : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          >
            <p className="g-eyebrow"><span className="g-eyebrow-dot" />GDG ON CAMPUS ACEIT <span>/</span> JAIPUR, RAJASTHAN</p>
            <h1 id="home-title" aria-label="GDG On Campus ACEIT — Cloud and AI Campaign 2026">
              GDG On Campus ACEIT
              <span className="g-hero-gradient">Cloud &amp; AI Campaign 2026</span>
            </h1>
            <p className="g-hero-lede">
              Student builders at Arya College of Engineering &amp; IT learning cloud, AI, and open-source engineering together — then proving it on a live chapter leaderboard.
            </p>

            <div className="g-hero-status">
              <span className="g-status-pill">
                <span className="g-status-pulse" aria-hidden="true" />
                {isDemo ? "Demo snapshot" : "Live community record"}
              </span>
              <span className="g-status-meta">
                <Lock size={13} aria-hidden="true" />
                {isDemo ? "Synthetic examples" : `${builderCount.toLocaleString("en-IN")} builders tracked`}
              </span>
              <span className="g-status-meta">
                <span className="g-status-meta-label">LAST UPDATED</span>
                <time dateTime={lastSyncedAt}>{formatShortDate(lastSyncedAt)}</time>
              </span>
            </div>

            <div className="g-hero-actions">
              <Link className="g-btn g-btn-primary" href="/progress">
                Explore Leaderboard
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <Link className="g-btn g-btn-ghost" href="/about">
                About GDG ACEIT
                <ArrowUpRight size={16} aria-hidden="true" />
              </Link>
            </div>

            <div className="g-hero-footnote">
              <span><Sparkles size={13} aria-hidden="true" />Learn</span>
              <span><Code2 size={13} aria-hidden="true" />Build</span>
              <span><GitBranch size={13} aria-hidden="true" />Connect</span>
            </div>
          </motion.div>

          <motion.div
            className="g-hero-visual"
            initial={reduceMotion ? false : { opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.65, delay: reduceMotion ? 0 : 0.12, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className="g-hero-glow" aria-hidden="true" />
            <Tilt max={14} scale={1.035} className="g-emblem-wrap">
              <div className="g-emblem">
                <span className="g-emblem-grid" aria-hidden="true" />
                <span className="g-emblem-ring g-ring-blue" aria-hidden="true" />
                <span className="g-emblem-ring g-ring-red" aria-hidden="true" />
                <span className="g-emblem-ring g-ring-yellow" aria-hidden="true" />
                <span className="g-emblem-ring g-ring-green" aria-hidden="true" />
                <span className="g-emblem-corner corner-blue" aria-hidden="true" />
                <span className="g-emblem-corner corner-red" aria-hidden="true" />
                <span className="g-emblem-corner corner-yellow" aria-hidden="true" />
                <span className="g-emblem-corner corner-green" aria-hidden="true" />
                <div className="g-emblem-type" aria-hidden="true">
                  <span className="g-angle angle-blue">&lt;</span>
                  <span className="g-slash">/</span>
                  <span className="g-angle angle-green">&gt;</span>
                </div>
                <span className="g-emblem-label">GDG ON CAMPUS</span>
                <span className="g-emblem-sub">ACEIT · 2026</span>
              </div>
            </Tilt>
            <span className="g-float-chip chip-blue" aria-hidden="true">CLOUD</span>
            <span className="g-float-chip chip-red" aria-hidden="true">AI</span>
            <span className="g-float-chip chip-yellow" aria-hidden="true">ARCADE</span>
            <span className="g-float-chip chip-green" aria-hidden="true">OPEN SOURCE</span>
          </motion.div>
        </section>

        <motion.section
          className="g-kpi-strip"
          aria-label="Live campaign statistics"
          initial={reduceMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: reduceMotion ? 0 : 0.22 }}
        >
          {kpiDefinitions.map(({ key, label, detail, icon: Icon, tone }) => {
            const value = kpiValues[key];
            return (
              <Tilt as="article" key={key} max={7} scale={1.02} className={`g-kpi g-kpi-${tone}`}>
                <span className="g-kpi-icon" aria-hidden="true"><Icon size={18} /></span>
                <p>{label}</p>
                <strong>{typeof value === "number" ? value.toLocaleString("en-IN") : value}</strong>
                <small>{detail}</small>
                <span className="g-kpi-line" aria-hidden="true" />
              </Tilt>
            );
          })}
        </motion.section>

        {!isDemo && awaitingVerification > 0 && (
          <p className="g-inline-note" role="status">
            <BadgeCheck size={15} aria-hidden="true" />
            {awaitingVerification.toLocaleString("en-IN")} {awaitingVerification === 1 ? "record is" : "records are"} awaiting manual badge verification and stay unranked until reviewed.
          </p>
        )}

        <section className="g-section" aria-labelledby="podium-title">
          <div className="g-section-head">
            <div>
              <p className="g-kicker">CHAMPIONS</p>
              <h2 id="podium-title">Top 3 of the campaign</h2>
            </div>
            <p className="g-section-copy">Verified Skill Badges set the pace. Arcade badges are celebrated separately and never change rank.</p>
          </div>

          {podium.length > 0 ? (
            <div className="g-podium">
              {[podium[1], podium[0], podium[2]].map((entry, index) => entry ? (
                <PodiumCard
                  key={entry.participant.id}
                  entry={entry}
                  slot={index === 1 ? 1 : index === 0 ? 2 : 3}
                  onOpen={() => setSelected(entry.participant)}
                />
              ) : <span key={`placeholder-${index}`} className="g-podium-placeholder" aria-hidden="true" />)}
            </div>
          ) : (
            <div className="g-empty g-empty-wide">
              <span className="g-empty-icon"><Trophy size={18} aria-hidden="true" /></span>
              <strong>Champions appear after the first badge review</strong>
              <p>Reviewed Skill Badges unlock ranked podium positions for this campaign.</p>
            </div>
          )}
        </section>

        <section className="g-section g-top10-section" aria-labelledby="top10-title">
          <div className="g-section-head">
            <div>
              <p className="g-kicker">LEADERBOARD SNAPSHOT</p>
              <h2 id="top10-title">The top 10</h2>
            </div>
            <Link className="g-text-link" href="/progress">Open full explorer <ArrowRight size={15} aria-hidden="true" /></Link>
          </div>

          {topTen.length > 0 ? (
            <div className="g-top10-grid">
              {topTen.map((entry) => {
                const { participant, rank } = entry;
                return (
                  <button
                    type="button"
                    key={participant.id}
                    className="g-top10-row"
                    onClick={() => setSelected(participant)}
                    aria-label={`Open ${participant.displayName}'s profile, rank ${rank}`}
                  >
                    <span className={`g-top10-rank${rank === 1 ? " is-first" : ""}`}>{rank === 1 ? <Trophy size={14} aria-hidden="true" /> : `#${rank}`}</span>
                    <Avatar participant={participant} size="sm" />
                    <span className="g-top10-person">
                      <strong>{participant.displayName}</strong>
                      <small>{participant.frozenRank ? "Frozen rank" : "Skill Badge pace"}</small>
                    </span>
                    <span className="g-top10-metrics">
                      <span className="g-top10-skill"><Award size={12} aria-hidden="true" />{participant.skillBadgeCount ?? "—"}</span>
                      <span className="g-top10-arcade"><Gamepad2 size={12} aria-hidden="true" />{participant.arcadeGameBadgeCount ?? "—"}</span>
                    </span>
                    <span className="g-top10-bar" aria-hidden="true">
                      <span style={{ transform: `scaleX(${Math.min((participant.skillBadgeCount ?? 0) / 10, 1)})` }} />
                    </span>
                    {participant.frozenRank && <Lock size={11} className="g-top10-lock" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="g-empty">
              <span className="g-empty-icon"><Trophy size={18} aria-hidden="true" /></span>
              <strong>No ranked participants yet</strong>
              <p>The snapshot fills in as participant evidence is reviewed.</p>
            </div>
          )}

          <div className="g-view-all">
            <Link className="g-btn g-btn-primary g-btn-wide" href="/progress">
              View All {builderCount.toLocaleString("en-IN")} Participants on Leaderboard
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <span className="g-timestamp"><span>LAST UPDATED</span><time dateTime={lastSyncedAt}>{formatTimestamp(lastSyncedAt)} IST</time></span>
            <button className="g-refresh" type="button" onClick={() => startRefresh(() => router.refresh())} disabled={isRefreshing} aria-busy={isRefreshing}>
              <RefreshCw size={14} aria-hidden="true" className={isRefreshing ? "is-spinning" : undefined} />
              {isRefreshing ? "Refreshing" : "Refresh data"}
            </button>
          </div>
        </section>

        <section className="g-section" aria-labelledby="roadmap-title">
          <div className="g-section-head">
            <div>
              <p className="g-kicker">CAMPAIGN ROADMAP</p>
              <h2 id="roadmap-title">Three steps to a locked rank</h2>
            </div>
            <p className="g-section-copy">A simple path from registration to a permanent place on the chapter leaderboard.</p>
          </div>
          <div className="g-roadmap">
            {roadmap.map(({ step, title, detail, icon: Icon, tone }, index) => (
              <Tilt as="article" key={step} max={6} scale={1.02} className={`g-roadmap-card g-roadmap-${tone}`}>
                <span className="g-roadmap-step">{step}</span>
                <span className="g-roadmap-icon" aria-hidden="true"><Icon size={19} /></span>
                <h3>{title}</h3>
                <p>{detail}</p>
                {index < roadmap.length - 1 && <span className="g-roadmap-connector" aria-hidden="true"><ArrowRight size={16} /></span>}
              </Tilt>
            ))}
          </div>
        </section>

        <section className="g-cta-band" aria-labelledby="cta-title">
          <div>
            <p className="g-kicker">READY TO BUILD?</p>
            <h2 id="cta-title">Your next badge starts with one lab.</h2>
          </div>
          <div className="g-cta-actions">
            <Link className="g-btn g-btn-primary" href="/progress">Explore Leaderboard <ArrowRight size={16} aria-hidden="true" /></Link>
            <Link className="g-btn g-btn-ghost" href="/about">Meet the chapter <ArrowUpRight size={16} aria-hidden="true" /></Link>
          </div>
        </section>

        <CommunityFooter />
      </main>

      <AnimatePresence>
        {selected && <ParticipantDialog key={selected.id} participant={selected} onClose={() => setSelected(null)} reduceMotion={reduceMotion} />}
      </AnimatePresence>
    </div>
  );
}

function PodiumCard({ entry, slot, onOpen }: { entry: RankedParticipant; slot: 1 | 2 | 3; onOpen: () => void }) {
  const { participant, rank } = entry;
  const tone = slot === 1 ? "gold" : slot === 2 ? "blue" : "green";
  const Icon = slot === 1 ? Trophy : Medal;

  return (
    <Tilt as="article" max={9} scale={1.025} className={`g-podium-card g-podium-${tone}${slot === 1 ? " is-champion" : ""}`}>
      <button type="button" className="g-card-hit" onClick={onOpen} aria-label={`Open ${participant.displayName}'s profile, rank ${rank}`} />
      <div className="g-podium-top">
        <span className="g-podium-rank"><Icon size={15} aria-hidden="true" />#{rank}</span>
        {participant.frozenRank ? <span className="g-lock-chip"><Lock size={11} aria-hidden="true" />Frozen</span> : <span className="g-lock-chip g-lock-chip-soft">Live rank</span>}
      </div>
      <div className="g-podium-avatar">
        <Avatar participant={participant} size="lg" />
        {slot === 1 && <span className="g-crown" aria-hidden="true">★</span>}
      </div>
      <h3>{participant.displayName}</h3>
      <p className="g-podium-role">{slot === 1 ? "Campaign leader" : slot === 2 ? "Runner-up" : "Third place"}</p>
      <div className="g-podium-stats">
        <span className="g-podium-stat g-podium-skill"><Award size={14} aria-hidden="true" /><strong>{participant.skillBadgeCount ?? "—"}</strong><small>Skill</small></span>
        <span className="g-podium-stat g-podium-arcade"><Gamepad2 size={14} aria-hidden="true" /><strong>{participant.arcadeGameBadgeCount ?? "—"}</strong><small>Arcade</small></span>
      </div>
      {participant.skillBadgeCount !== null
        ? <ProgressMeter count={participant.skillBadgeCount} target={10} label={`${participant.displayName} skill badge progress`} />
        : <span className="g-podium-muted">Skill classification pending</span>}
      <span className="g-podium-cta">View profile <ArrowRight size={13} aria-hidden="true" /></span>
    </Tilt>
  );
}

"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  ArrowUpRight,
  Award,
  BadgeCheck,
  Code2,
  GitBranch,
  Lock,
  MapPin,
  Sparkles,
  Users,
} from "lucide-react";
import { AnimatedCounter } from "@/components/animated-counter";
import { CommunityFooter } from "@/components/community-footer";
import { CommunityNavigation } from "@/components/community-navigation";
import { GdgEmblem } from "@/components/gdg-emblem";
import { LeaderboardBoard } from "@/components/leaderboard-board";
import { Motion3DCard } from "@/components/motion-3d-card";
import type { LeaderboardSnapshot } from "@/lib/types";

const roadmap = [
  {
    step: "01",
    title: "Register & Map Profile",
    detail: "Join the campaign with your Google developer profile so your progress is tracked.",
    icon: Users,
    tone: "blue",
  },
  {
    step: "02",
    title: "Earn Skill & Arcade Badges",
    detail: "Complete Google Cloud Skill Badges and Arcade labs alongside the community.",
    icon: Award,
    tone: "yellow",
  },
  {
    step: "03",
    title: "Lock Permanent Rank at 10 Skill Badges",
    detail: "Reach the milestone to freeze a permanent rank on the chapter leaderboard.",
    icon: Lock,
    tone: "green",
  },
] as const;

const domains = [
  { label: "Cloud & Generative AI", detail: "Gemini · Vertex AI", tone: "blue" },
  { label: "Full-Stack Web", detail: "Next.js · React · Node", tone: "red" },
  { label: "Mobile & Flutter", detail: "Material 3", tone: "yellow" },
  { label: "Competitive Programming", detail: "DSA · Problem solving", tone: "green" },
  { label: "UI/UX & Community", detail: "Design systems · Mentorship", tone: "violet" },
] as const;

function toneStyle(tone: string) {
  return { "--tone": `var(--google-${tone === "violet" ? "blue" : tone})` } as CSSProperties;
}

export function HomeHub({ snapshot }: { snapshot: LeaderboardSnapshot }) {
  const { participants, registeredCount, lastSyncedAt } = snapshot;
  const reduceMotion = useReducedMotion();

  const reviewedCount = participants.filter((participant) => participant.lastCheckedAt).length;
  const hasReviewedParticipants = reviewedCount > 0;
  const awaitingVerification = participants.length - reviewedCount;
  const isDemo = snapshot.dataMode === "demo";
  const showVerifiedCounts = isDemo || hasReviewedParticipants;
  const builderCount = registeredCount || participants.length;

  const metrics = [
    { label: "Active Builders", detail: "Registered in the campaign", value: builderCount, suffix: "", icon: Users, tone: "blue" },
    { label: "Verified Badges", detail: "Skill + Arcade combined", value: showVerifiedCounts ? snapshot.totalVerifiedBadges : null, suffix: "+", icon: BadgeCheck, tone: "red" },
    { label: "Skill Badges", detail: "Counted toward rank", value: showVerifiedCounts ? snapshot.totalSkillBadges : null, suffix: "", icon: Award, tone: "yellow" },
    { label: "Frozen Ranks", detail: "Locked at 10+ Skill", value: showVerifiedCounts ? snapshot.frozenRankCount : null, suffix: "", icon: Lock, tone: "green" },
  ] as const;

  return (
    <div className="g-app">
      <CommunityNavigation dataMode={snapshot.dataMode} />

      <main className="g-main">
        <section className="g-hero" aria-labelledby="home-title">
          <motion.div
            className="g-hero-copy"
            initial={reduceMotion ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className="g-live-pill">
              <span className="g-live-pill-dot" aria-hidden="true" />
              GDGoC ACEIT · Jaipur
            </span>

            <h1 id="home-title" className="g-hero-title">
              <span className="g-hero-title-line">GDG On Campus</span>
              <span className="g-hero-title-line">
                <span className="g-wordmark" aria-hidden="true">
                  {"ACEIT".split("").map((letter, index) => <span key={`${letter}-${index}`}>{letter}</span>)}
                </span>
                <span className="sr-only">ACEIT</span>
              </span>
            </h1>

            <p className="g-hero-lede">
              The student developer community at Arya College of Engineering &amp; IT, building cloud, AI, and open-source skills together.
            </p>

            <div className="g-hero-actions">
              <Link className="g-btn g-btn-primary" href="#leaderboard">
                Jump to leaderboard
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <Link className="g-btn g-btn-ghost" href="/about">
                About Chapter
                <ArrowUpRight size={16} aria-hidden="true" />
              </Link>
            </div>

            <div className="g-hero-meta" aria-label="Chapter values">
              <span className="g-hero-meta-item"><Sparkles size={13} aria-hidden="true" />Learn</span>
              <span className="g-hero-meta-sep" aria-hidden="true" />
              <span className="g-hero-meta-item"><Code2 size={13} aria-hidden="true" />Build</span>
              <span className="g-hero-meta-sep" aria-hidden="true" />
              <span className="g-hero-meta-item"><GitBranch size={13} aria-hidden="true" />Connect</span>
              <span className="g-hero-meta-sep" aria-hidden="true" />
              <span className="g-hero-meta-item"><MapPin size={13} aria-hidden="true" />Kukas, Jaipur</span>
            </div>
          </motion.div>

          <motion.div
            className="g-hero-visual"
            initial={reduceMotion ? false : { opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.65, delay: reduceMotion ? 0 : 0.1, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className="g-hero-glow" aria-hidden="true" />
            <GdgEmblem />
          </motion.div>
        </section>

        <section className="g-kpi-strip" aria-label="Live campaign metrics">
          {metrics.map(({ label, detail, value, suffix, icon: Icon, tone }) => (
            <article className={`g-kpi-pill g-kpi-${tone}`} key={label}>
              <span className="g-kpi-icon" aria-hidden="true"><Icon size={17} /></span>
              <span className="g-kpi-copy">
                <AnimatedCounter as="strong" value={value} suffix={suffix} />
                <span>{label}</span>
                <small>{detail}</small>
              </span>
            </article>
          ))}
        </section>

        <section className="g-section g-leaderboard-section" id="leaderboard" aria-label="Live chapter leaderboard">
          <LeaderboardBoard
            snapshot={snapshot}
            kicker="LIVE RECORDS"
            title={isDemo ? "Sample leaderboard" : "The chapter leaderboard"}
            headingId="home-leaderboard-title"
            banner={
              !isDemo && awaitingVerification > 0 ? (
                <p className="g-inline-note" role="status">
                  <BadgeCheck size={15} aria-hidden="true" />
                  {awaitingVerification.toLocaleString("en-IN")} {awaitingVerification === 1 ? "record is" : "records are"} awaiting manual badge verification and stay unranked until reviewed.
                </p>
              ) : undefined
            }
          />
        </section>

        <section className="g-section" aria-labelledby="roadmap-title">
          <div className="g-section-head">
            <div>
              <p className="g-kicker">Campaign roadmap</p>
              <h2 id="roadmap-title">Three steps to a locked rank</h2>
            </div>
            <p className="g-section-copy">A simple path from registration to a permanent place on the chapter leaderboard.</p>
          </div>

          <div className="g-bento">
            <Motion3DCard as="article" className="g-bento-card g-bento-steps" max={5} lift={10}>
              <div className="g-bento-head">
                <h3 className="g-bento-title">How the campaign works</h3>
                <p className="g-bento-copy">Every builder follows the same transparent track. Skill Badges decide rank; Arcade is its own scoreboard.</p>
              </div>
              <div className="g-steps">
                {roadmap.map(({ step, title, detail, icon: Icon, tone }, index) => (
                  <div className="g-step" key={step} style={toneStyle(tone)}>
                    <span className="g-step-index">{step}</span>
                    <span className="g-step-icon" aria-hidden="true"><Icon size={18} /></span>
                    <span className="g-step-body">
                      <strong>{title}</strong>
                      <small>{detail}</small>
                    </span>
                    {index < roadmap.length - 1 && <ArrowRight size={15} className="g-step-arrow" aria-hidden="true" />}
                  </div>
                ))}
              </div>
            </Motion3DCard>

            <Motion3DCard as="article" className="g-bento-card g-bento-domains" max={5} lift={10}>
              <div className="g-bento-head">
                <h3 className="g-bento-title">Domains we build in</h3>
                <p className="g-bento-copy">Five tracks, one builder community.</p>
              </div>
              <div className="g-domain-list">
                {domains.map(({ label, detail, tone }, index) => (
                  <div className="g-domain-row" key={label}>
                    <span className="g-domain-dot" style={toneStyle(tone)} aria-hidden="true" />
                    <strong>{label}</strong>
                    <small>{index === 0 ? "Flagship" : detail}</small>
                  </div>
                ))}
              </div>
            </Motion3DCard>

            <Motion3DCard as="article" className="g-bento-card g-bento-note" max={5} lift={10}>
              <div>
                <span className="g-bento-badge"><BadgeCheck size={12} aria-hidden="true" />Chapter milestone</span>
                <h3>Google Cloud Study Jams — Tier 1 &amp; Top 5</h3>
                <p>Recognised on the national cohort leaderboard for campaign participation and verified builder outcomes.</p>
              </div>
              <Link className="g-bento-link" href="/about">
                Read the chapter story <ArrowUpRight size={14} aria-hidden="true" />
              </Link>
            </Motion3DCard>
          </div>
        </section>

        <section className="g-cta-band" aria-labelledby="cta-title">
          <div>
            <p className="g-kicker">Ready to build?</p>
            <h2 id="cta-title">Your next badge starts with one lab.</h2>
            <p className="g-cta-updated">Snapshot updated <time dateTime={lastSyncedAt}>{new Date(lastSyncedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}</time> · IST</p>
          </div>
          <div className="g-cta-actions">
            <Link className="g-btn g-btn-primary" href="#leaderboard">Explore Leaderboard <ArrowRight size={16} aria-hidden="true" /></Link>
            <Link className="g-btn g-btn-ghost" href="/about">Meet the chapter <ArrowUpRight size={16} aria-hidden="true" /></Link>
          </div>
        </section>

        <CommunityFooter />
      </main>
    </div>
  );
}

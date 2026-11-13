"use client";

import { useMemo, useState, useTransition } from "react";
import type { CSSProperties, FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  ArrowUpRight,
  Award,
  BadgeCheck,
  Binary,
  Cloud,
  Code2,
  Gamepad2,
  GitBranch,
  Lock,
  MapPin,
  Medal,
  Palette,
  RefreshCw,
  Search,
  Smartphone,
  Sparkles,
  Trophy,
  Users,
} from "lucide-react";
import { CommunityFooter } from "@/components/community-footer";
import { CommunityNavigation } from "@/components/community-navigation";
import { GdgEmblem } from "@/components/gdg-emblem";
import { Tilt } from "@/components/tilt";
import {
  Avatar,
  formatTimestamp,
  ParticipantDialog,
  ProgressMeter,
} from "@/components/leaderboard-ui";
import type { LeaderboardSnapshot, PublicParticipant } from "@/lib/types";
import { rankParticipants } from "@/lib/leaderboard";

type RankedParticipant = { participant: PublicParticipant; rank: number | null };

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
  { label: "Cloud & Generative AI", detail: "Gemini · Vertex AI", icon: Cloud, tone: "blue" },
  { label: "Full-Stack Web", detail: "Next.js · React · Node", icon: Code2, tone: "red" },
  { label: "Mobile & Flutter", detail: "Material 3", icon: Smartphone, tone: "yellow" },
  { label: "Competitive Programming", detail: "DSA · Problem solving", icon: Binary, tone: "green" },
  { label: "UI/UX & Community", detail: "Design systems · Mentorship", icon: Palette, tone: "violet" },
] as const;

function toneStyle(tone: string) {
  return { "--tone": `var(--google-${tone === "violet" ? "blue" : tone})` } as CSSProperties;
}

export function HomeHub({ snapshot }: { snapshot: LeaderboardSnapshot }) {
  const { participants, registeredCount, lastSyncedAt } = snapshot;
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [isRefreshing, startRefresh] = useTransition();
  const [selected, setSelected] = useState<PublicParticipant | null>(null);
  const [lookup, setLookup] = useState("");
  const [lookupOpen, setLookupOpen] = useState(false);

  const ranked = useMemo(() => rankParticipants(participants), [participants]);
  const rankedParticipants = useMemo(() => ranked.filter((entry) => entry.rank !== null), [ranked]);
  const podium = rankedParticipants.slice(0, 3);
  const topTen = rankedParticipants.slice(0, 10);

  const reviewedCount = participants.filter((participant) => participant.lastCheckedAt).length;
  const hasReviewedParticipants = reviewedCount > 0;
  const awaitingVerification = participants.length - reviewedCount;
  const isDemo = snapshot.dataMode === "demo";
  const showVerifiedCounts = isDemo || hasReviewedParticipants;
  const builderCount = registeredCount || participants.length;

  const formatCount = (value: number) => (showVerifiedCounts ? value.toLocaleString("en-IN") : "—");
  const verifiedDisplay = showVerifiedCounts ? `${snapshot.totalVerifiedBadges.toLocaleString("en-IN")}+` : "—";

  const normalizedLookup = lookup.trim().toLocaleLowerCase();
  const lookupMatches = useMemo(() => {
    if (!normalizedLookup) return [];
    return ranked
      .filter(({ participant }) => participant.displayName.toLocaleLowerCase().includes(normalizedLookup))
      .slice(0, 5);
  }, [normalizedLookup, ranked]);

  const tickerItems = [
    { label: "Builders", value: builderCount.toLocaleString("en-IN"), tone: "blue" },
    { label: "Verified badges", value: formatCount(snapshot.totalVerifiedBadges), tone: "red" },
    { label: "Skill badges", value: formatCount(snapshot.totalSkillBadges), tone: "yellow" },
    { label: "Frozen ranks", value: formatCount(snapshot.frozenRankCount), tone: "green" },
    { label: "Tier 1 Study Jams chapter", value: "Top 5 National", tone: "blue" },
    { label: "Learn with Communities 2026", value: "Live now", tone: "green" },
  ];

  function openParticipant(participant: PublicParticipant) {
    setSelected(participant);
    setLookup("");
    setLookupOpen(false);
  }

  function submitLookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const first = lookupMatches[0];
    if (first) {
      openParticipant(first.participant);
      return;
    }
    router.push("/progress");
  }

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
              <Link className="g-btn g-btn-primary" href="/progress">
                Explore Leaderboard
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

            <div
              className="g-hero-lookup"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setLookupOpen(false);
              }}
            >
              <label className="g-lookup-label" htmlFor="participant-lookup">Quick participant lookup</label>
              <form className="g-lookup-field" role="search" onSubmit={submitLookup}>
                <Search size={16} aria-hidden="true" />
                <input
                  id="participant-lookup"
                  value={lookup}
                  onChange={(event) => {
                    setLookup(event.target.value);
                    setLookupOpen(true);
                  }}
                  onFocus={() => setLookupOpen(true)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setLookupOpen(false);
                      event.currentTarget.blur();
                    }
                  }}
                  placeholder="Find a builder by name…"
                  autoComplete="off"
                  spellCheck={false}
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={lookupOpen && normalizedLookup.length > 0}
                  aria-controls="participant-lookup-results"
                />
                <button type="submit" className="g-lookup-submit">Open</button>
              </form>

              {lookupOpen && normalizedLookup.length > 0 && (
                <div className="g-lookup-results" id="participant-lookup-results">
                  {lookupMatches.length > 0 ? (
                    <>
                      <div className="g-lookup-options" role="listbox" aria-label="Participant search results">
                        {lookupMatches.map(({ participant, rank }) => (
                          <button
                            key={participant.id}
                            type="button"
                            role="option"
                            aria-selected={false}
                            className="g-lookup-result"
                            onClick={() => openParticipant(participant)}
                          >
                            <Avatar participant={participant} size="sm" />
                            <span className="g-lookup-result-copy">
                              <strong>{participant.displayName}</strong>
                              <small>{participant.frozenRank ? "Frozen rank captured" : participant.lastCheckedAt ? "Reviewed participant" : "Awaiting review"}</small>
                            </span>
                            <span className="g-lookup-result-meta">{rank ? `#${rank}` : "New"}</span>
                          </button>
                        ))}
                      </div>
                      <div className="g-lookup-footer">
                        <span>{lookupMatches.length} match{lookupMatches.length === 1 ? "" : "es"} shown</span>
                        <Link href="/progress">Full leaderboard →</Link>
                      </div>
                    </>
                  ) : (
                    <p className="g-lookup-empty">No builder matches “{lookup.trim()}”. Try another name.</p>
                  )}
                </div>
              )}
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
            <div className="g-hero-telemetry" aria-label="Live campaign telemetry">
              <span className="g-telemetry-pill g-telemetry-blue">
                <strong>{builderCount.toLocaleString("en-IN")}</strong>
                <span>Builders</span>
              </span>
              <span className="g-telemetry-pill g-telemetry-yellow">
                <strong>{verifiedDisplay}</strong>
                <span>Verified Badges</span>
              </span>
              <span className="g-telemetry-pill g-telemetry-green">
                <strong>{formatCount(snapshot.frozenRankCount)}</strong>
                <span>Milestone Locked</span>
              </span>
            </div>
          </motion.div>
        </section>

        <section className="g-ticker" aria-label="Campaign at a glance">
          <div className="g-ticker-viewport">
            <div className="g-ticker-track">
              {[0, 1].map((copy) => (
                <div className="g-ticker-group" key={copy} aria-hidden={copy === 1 ? "true" : undefined}>
                  {tickerItems.map((item, index) => (
                    <span className="g-ticker-item" key={`${copy}-${item.label}`}>
                      {index > 0 && <span className="g-ticker-sep" aria-hidden="true" />}
                      <span className="g-ticker-dot" style={toneStyle(item.tone)} aria-hidden="true" />
                      <strong>{item.value}</strong>
                      {item.label}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>

        {!isDemo && awaitingVerification > 0 && (
          <p className="g-inline-note" role="status">
            <BadgeCheck size={15} aria-hidden="true" />
            {awaitingVerification.toLocaleString("en-IN")} {awaitingVerification === 1 ? "record is" : "records are"} awaiting manual badge verification and stay unranked until reviewed.
          </p>
        )}

        <section className="g-section" aria-labelledby="podium-title">
          <div className="g-section-head">
            <div>
              <p className="g-kicker">Champions</p>
              <h2 id="podium-title">The top three of the campaign</h2>
            </div>
            <p className="g-section-copy">Verified Skill Badges set the pace. Arcade badges are celebrated separately and never change rank.</p>
          </div>

          {podium.length > 0 ? (
            <div className="g-podium">
              {[
                podium[1] ? { entry: podium[1], slot: 2 as const } : null,
                podium[0] ? { entry: podium[0], slot: 1 as const } : null,
                podium[2] ? { entry: podium[2], slot: 3 as const } : null,
              ].map((item, index) => item ? (
                <PodiumCard
                  key={item.entry.participant.id}
                  entry={item.entry}
                  slot={item.slot}
                  onOpen={() => setSelected(item.entry.participant)}
                />
              ) : <span key={`placeholder-${index}`} className="g-podium-placeholder" aria-hidden="true" />)}
            </div>
          ) : (
            <div className="g-empty">
              <span className="g-empty-icon"><Trophy size={18} aria-hidden="true" /></span>
              <strong>Champions appear after the first badge review</strong>
              <p>Reviewed Skill Badges unlock ranked podium positions for this campaign.</p>
            </div>
          )}
        </section>

        <section className="g-section g-top10-section" aria-labelledby="top10-title">
          <div className="g-section-head">
            <div>
              <p className="g-kicker">Leaderboard snapshot</p>
              <h2 id="top10-title">The top 10 builders</h2>
            </div>
            <Link className="g-text-link" href="/progress">Open full leaderboard <ArrowRight size={15} aria-hidden="true" /></Link>
          </div>

          {topTen.length > 0 ? (
            <div className="g-top10-grid">
              {topTen.map(({ participant, rank }) => (
                <button
                  type="button"
                  key={participant.id}
                  className="g-top10-row"
                  onClick={() => setSelected(participant)}
                  aria-label={`Open ${participant.displayName}'s profile, rank ${rank}`}
                >
                  <span className={`g-top10-rank${rank === 1 ? " is-first" : ""}`}>{rank === 1 ? <Trophy size={13} aria-hidden="true" /> : `#${rank}`}</span>
                  <Avatar participant={participant} size="sm" />
                  <span className="g-top10-person">
                    <strong>{participant.displayName}</strong>
                    <small>{participant.frozenRank ? `Frozen rank #${participant.frozenRank}` : "Climbing the Skill Badge track"}</small>
                  </span>
                  <span className="g-top10-metrics">
                    <span className="g-top10-skill"><Award size={12} aria-hidden="true" />{participant.skillBadgeCount ?? "—"}</span>
                    <span className="g-top10-arcade"><Gamepad2 size={12} aria-hidden="true" />{participant.arcadeGameBadgeCount ?? "—"}</span>
                  </span>
                  <span className="g-top10-bar" aria-hidden="true">
                    <motion.span
                      initial={reduceMotion ? false : { scaleX: 0 }}
                      animate={{ scaleX: Math.min((participant.skillBadgeCount ?? 0) / 10, 1) }}
                      transition={{ duration: reduceMotion ? 0 : 0.7, ease: [0.22, 1, 0.36, 1] }}
                    />
                  </span>
                  {participant.frozenRank ? <Lock size={11} className="g-top10-lock" aria-label="Frozen rank" /> : <span aria-hidden="true" />}
                </button>
              ))}
            </div>
          ) : (
            <div className="g-empty">
              <span className="g-empty-icon"><Trophy size={18} aria-hidden="true" /></span>
              <strong>No ranked participants yet</strong>
              <p>The snapshot fills in as participant evidence is reviewed.</p>
            </div>
          )}

          <div className="g-view-all">
            <Link className="g-btn g-btn-primary" href="/progress">
              View All {builderCount.toLocaleString("en-IN")} Builders on Full Leaderboard
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <span className="g-timestamp"><span>Last updated</span><time dateTime={lastSyncedAt}>{formatTimestamp(lastSyncedAt)} IST</time></span>
            <button
              className="g-refresh"
              type="button"
              onClick={() => startRefresh(() => router.refresh())}
              disabled={isRefreshing}
              aria-busy={isRefreshing}
            >
              <RefreshCw size={14} aria-hidden="true" className={isRefreshing ? "is-spinning" : undefined} />
              {isRefreshing ? "Refreshing" : "Refresh data"}
            </button>
          </div>
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
            <article className="g-bento-card g-bento-steps">
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
            </article>

            <article className="g-bento-card g-bento-domains">
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
            </article>

            <article className="g-bento-card g-bento-note">
              <div>
                <span className="g-bento-badge"><BadgeCheck size={12} aria-hidden="true" />Chapter milestone</span>
                <h3>Google Cloud Study Jams — Tier 1 &amp; Top 5</h3>
                <p>Recognised on the national cohort leaderboard for campaign participation and verified builder outcomes.</p>
              </div>
              <Link className="g-bento-link" href="/about">
                Read the chapter story <ArrowUpRight size={14} aria-hidden="true" />
              </Link>
            </article>
          </div>
        </section>

        <section className="g-cta-band" aria-labelledby="cta-title">
          <div>
            <p className="g-kicker">Ready to build?</p>
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
  const role = slot === 1 ? "Campaign champion" : slot === 2 ? "Runner-up" : "Third place";

  return (
    <Tilt as="article" max={8} scale={1.02} className={`g-podium-card g-podium-${tone}${slot === 1 ? " is-champion" : ""}`}>
      <button type="button" className="g-card-hit" onClick={onOpen} aria-label={`Open ${participant.displayName}'s profile, rank ${rank}`} />
      <div className="g-podium-top">
        <span className="g-podium-rank"><Icon size={14} aria-hidden="true" />#{rank}</span>
        {participant.frozenRank
          ? <span className="g-lock-chip"><Lock size={11} aria-hidden="true" />Frozen</span>
          : <span className="g-lock-chip g-lock-chip-soft">Live rank</span>}
      </div>
      <div className="g-podium-avatar">
        <Avatar participant={participant} size="lg" />
        {slot === 1 && <span className="g-crown" aria-hidden="true">★</span>}
      </div>
      <h3>{participant.displayName}</h3>
      <p className="g-podium-role">{role}</p>
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

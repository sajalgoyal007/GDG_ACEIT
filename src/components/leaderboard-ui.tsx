"use client";

import { useEffect, useRef } from "react";
import type { KeyboardEvent } from "react";
import { motion } from "motion/react";
import { Award, BadgeCheck, Check, ExternalLink, Gamepad2, Lock, Search, ShieldCheck, X } from "lucide-react";
import type { PublicParticipant } from "@/lib/types";
import { qualifiesForRankFreeze } from "@/lib/leaderboard";

export function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

export function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

export function Avatar({ participant, size = "md" }: { participant: PublicParticipant; size?: "sm" | "md" | "lg" }) {
  return <span className={`person-avatar avatar-${participant.color} g-avatar-${size}`}>{participant.initials}</span>;
}

export function RankBadge({ rank, frozen }: { rank: number | null; frozen?: boolean }) {
  if (rank === null) {
    return <span className="g-rank g-rank-unranked" aria-label="Unranked until badge verification">—</span>;
  }
  const tone = rank <= 3 ? ` g-rank-top g-rank-${rank}` : "";
  return (
    <span
      className={`g-rank${tone}${frozen ? " g-rank-frozen" : ""}`}
      title={frozen ? `Rank #${rank} (locked at 10 Skill Badges)` : `Rank #${rank}`}
    >
      <small>#</small>{rank}
      {frozen && <Lock size={10} className="g-rank-lock" aria-label="Frozen rank" />}
    </span>
  );
}

export function ProgressMeter({ count, target, label = "Skill milestone" }: { count: number; target: number; label?: string }) {
  const value = Math.min(Math.max(count, 0), target);
  const ratio = target > 0 ? value / target : 0;
  return (
    <span className="g-progress">
      <span
        className="g-progress-track"
        role="progressbar"
        aria-label={`${label}: ${value} of ${target}`}
        aria-valuemin={0}
        aria-valuemax={target}
        aria-valuenow={value}
      >
        <span className="g-progress-fill" style={{ transform: `scaleX(${ratio})` }} />
      </span>
      <span className="g-progress-value">{value}<small>/{target}</small></span>
    </span>
  );
}

export function RankStatus({ skillBadgeCount, frozenRank }: { skillBadgeCount: number | null; frozenRank?: number | null }) {
  if (skillBadgeCount === null) return <span className="g-status g-status-muted">Unclassified</span>;
  if (qualifiesForRankFreeze(skillBadgeCount)) {
    return frozenRank != null
      ? <span className="g-status g-status-green"><Check size={12} aria-hidden="true" />Rank locked</span>
      : <span className="g-status g-status-green"><Check size={12} aria-hidden="true" />Threshold met</span>;
  }
  return <span className="g-status g-status-blue">In progress</span>;
}

export function EmptyState({ hasParticipants, isDemo, onReset }: { hasParticipants: boolean; isDemo: boolean; onReset: () => void }) {
  const title = hasParticipants ? "No participants match these filters" : isDemo ? "No demo records available" : "No participants yet";
  const description = hasParticipants ? "Try another name or choose a different filter." : isDemo ? "The active demo provider returned no participant records." : "Registered participant records will appear here after they are added by an administrator.";
  return (
    <div className="g-empty" role="status">
      <span className="g-empty-icon"><Search size={18} aria-hidden="true" /></span>
      <strong>{title}</strong>
      <p>{description}</p>
      {hasParticipants && <button type="button" onClick={onReset}>Clear search and filters</button>}
    </div>
  );
}

export function ParticipantDialog({ participant, onClose, reduceMotion }: { participant: PublicParticipant; onClose: () => void; reduceMotion: boolean | null }) {
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
      <div className="profile-heading"><Avatar participant={participant} size="lg" /><div><span className="profile-kicker">{participant.badges ? "SYNTHETIC DEMO PROFILE" : "PARTICIPANT PROFILE"}</span><h2 id="profile-title">{participant.displayName}</h2><span className="profile-sample"><span />{participant.badges ? "Example record" : "Registered participant"}</span></div></div>
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
            ? <ProgressMeter count={participant.skillBadgeCount} target={10} label="Skill badge progress" />
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

export function BadgePills({ participant }: { participant: PublicParticipant }) {
  if (!participant.lastCheckedAt) {
    return <span className="g-pill g-pill-muted">Not reviewed</span>;
  }
  return (
    <span className="g-pill-row">
      <span className="g-pill g-pill-skill"><Award size={12} aria-hidden="true" /><strong>{participant.skillBadgeCount ?? "—"}</strong> Skill</span>
      <span className="g-pill g-pill-arcade"><Gamepad2 size={12} aria-hidden="true" /><strong>{participant.arcadeGameBadgeCount ?? "—"}</strong> Arcade</span>
      <span className="g-pill g-pill-total"><strong>{participant.verifiedBadgeCount}</strong> Total</span>
    </span>
  );
}

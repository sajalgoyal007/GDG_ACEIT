"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Award,
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  Gamepad2,
  Lock,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { CommunityFooter } from "@/components/community-footer";
import { CommunityNavigation } from "@/components/community-navigation";
import {
  Avatar,
  BadgePills,
  EmptyState,
  formatTimestamp,
  ParticipantDialog,
  ProgressMeter,
  RankBadge,
  RankStatus,
} from "@/components/leaderboard-ui";
import type { LeaderboardSnapshot, PublicParticipant } from "@/lib/types";
import { matchesRankFreezeFilter, rankParticipants } from "@/lib/leaderboard";

type FilterKey = "all" | "frozen" | "skill" | "arcade";
const PAGE_SIZE = 25;

const filters: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All Participants" },
  { key: "frozen", label: "Frozen Ranks (10+ Skill)" },
  { key: "skill", label: "Skill Leaders" },
  { key: "arcade", label: "Arcade Earners" },
];

export function ProgressExplorer({ snapshot, diagnostics }: {
  snapshot: LeaderboardSnapshot;
  diagnostics?: ReactNode;
}) {
  const { participants, registeredCount, lastSyncedAt } = snapshot;
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [isRefreshing, startRefresh] = useTransition();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<PublicParticipant | null>(null);

  const ranked = useMemo(() => rankParticipants(participants), [participants]);
  const reviewedCount = participants.filter((participant) => participant.lastCheckedAt).length;
  const awaitingVerification = participants.length - reviewedCount;
  const hasReviewedParticipants = reviewedCount > 0;
  const isDemo = snapshot.dataMode === "demo";

  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return ranked.filter(({ participant }) => {
      if (query && !participant.displayName.toLocaleLowerCase().includes(query)) return false;
      if (filter === "frozen") return matchesRankFreezeFilter(participant, 10);
      if (filter === "skill") return Boolean(participant.lastCheckedAt) && (participant.skillBadgeCount ?? 0) > 0;
      if (filter === "arcade") return Boolean(participant.lastCheckedAt) && (participant.arcadeGameBadgeCount ?? 0) > 0;
      return true;
    });
  }, [ranked, search, filter]);

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pageRows = visible.slice(pageStart, pageStart + PAGE_SIZE);
  const rangeStart = visible.length === 0 ? 0 : pageStart + 1;
  const rangeEnd = Math.min(pageStart + PAGE_SIZE, visible.length);

  useEffect(() => {
    setPage(1);
  }, [search, filter]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  function resetFilters() {
    setSearch("");
    setFilter("all");
  }

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
          <div className="g-progress-actions">
            <span className="g-timestamp"><span>LAST UPDATED</span><time dateTime={lastSyncedAt}>{formatTimestamp(lastSyncedAt)} IST</time></span>
            <button className="g-refresh" type="button" onClick={() => startRefresh(() => router.refresh())} disabled={isRefreshing} aria-busy={isRefreshing}>
              <RefreshCw size={14} aria-hidden="true" className={isRefreshing ? "is-spinning" : undefined} />
              {isRefreshing ? "Refreshing" : "Refresh data"}
            </button>
          </div>
        </section>

        <section className="g-progress-kpis" aria-label="Live leaderboard summary">
          <div className="g-progress-kpi g-kpi-blue"><Users size={16} aria-hidden="true" /><span>Active Builders</span><strong>{registeredCount.toLocaleString("en-IN")}</strong></div>
          <div className="g-progress-kpi g-kpi-red"><BadgeCheck size={16} aria-hidden="true" /><span>Total Badges</span><strong>{!isDemo && !hasReviewedParticipants ? "—" : snapshot.totalVerifiedBadges.toLocaleString("en-IN")}</strong></div>
          <div className="g-progress-kpi g-kpi-yellow"><Award size={16} aria-hidden="true" /><span>Skill Badges</span><strong>{!isDemo && !hasReviewedParticipants ? "—" : snapshot.totalSkillBadges.toLocaleString("en-IN")}</strong></div>
          <div className="g-progress-kpi g-kpi-green"><Lock size={16} aria-hidden="true" /><span>Frozen Ranks</span><strong>{!isDemo && !hasReviewedParticipants ? "—" : snapshot.frozenRankCount.toLocaleString("en-IN")}</strong></div>
        </section>

        {!isDemo && awaitingVerification > 0 && (
          <p className="g-inline-note" role="status">
            <ShieldCheck size={15} aria-hidden="true" />
            {awaitingVerification.toLocaleString("en-IN")} {awaitingVerification === 1 ? "record is" : "records are"} awaiting manual verification. Unreviewed registrations stay unranked and keep a default badge count of zero.
          </p>
        )}

        <section className="g-board" aria-labelledby="leaderboard-title">
          <div className="g-board-head">
            <div>
              <p className="g-kicker">LIVE RECORDS</p>
              <h2 id="leaderboard-title">{isDemo ? "Sample leaderboard" : "Participant progress"}</h2>
            </div>
            <span className="g-board-count"><strong>{visible.length.toLocaleString("en-IN")}</strong> {visible.length === 1 ? "participant" : "participants"}</span>
          </div>

          <div className="g-board-controls">
            <label className="g-search">
              <Search size={16} aria-hidden="true" />
              <span className="sr-only">Search participants by name</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by participant name"
                autoComplete="off"
                spellCheck={false}
              />
              {search && <button type="button" className="g-search-clear" onClick={() => setSearch("")} aria-label="Clear search"><X size={14} /></button>}
            </label>

            <div className="g-filter-pills" role="group" aria-label="Filter leaderboard">
              {filters.map(({ key, label }) => {
                const active = filter === key;
                return (
                  <button key={key} type="button" className={active ? "g-filter is-active" : "g-filter"} aria-pressed={active} onClick={() => setFilter(key)}>
                    {active && <motion.span className="g-filter-bg" layoutId="g-active-filter" transition={{ type: "spring", stiffness: 380, damping: 32 }} />}
                    <span className="g-filter-label">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="g-board-meta">
            <span>Showing <strong>{rangeStart.toLocaleString("en-IN")}–{rangeEnd.toLocaleString("en-IN")}</strong> of <strong>{visible.length.toLocaleString("en-IN")}</strong></span>
            <span className="g-board-rule">Ranked by verified Skill Badges · Arcade never affects rank</span>
          </div>

          {visible.length === 0 ? (
            <EmptyState hasParticipants={participants.length > 0} isDemo={isDemo} onReset={resetFilters} />
          ) : (
            <>
              <div className="g-table-wrap">
                <table className="g-table">
                  <thead>
                    <tr>
                      <th scope="col">Rank</th>
                      <th scope="col">Participant</th>
                      <th scope="col">Skill</th>
                      <th scope="col">Arcade</th>
                      <th scope="col">Total</th>
                      <th scope="col">Progress to 10</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <motion.tbody key={`page-${safePage}-${filter}-${search}`} initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reduceMotion ? 0 : 0.24 }}>
                    {pageRows.map(({ participant, rank }) => (
                      <tr key={participant.id}>
                        <td><RankBadge rank={rank} frozen={Boolean(participant.frozenRank)} /></td>
                        <td>
                          <button type="button" className="g-row-person" onClick={() => setSelected(participant)} aria-label={`Open ${participant.displayName}'s profile`}>
                            <Avatar participant={participant} size="sm" />
                            <span><strong>{participant.displayName}</strong><small>{participant.frozenRank ? "Frozen rank captured" : isDemo ? "Synthetic example" : "Registered participant"}</small></span>
                          </button>
                        </td>
                        <td>{participant.lastCheckedAt ? <span className="g-cell-badge g-cell-skill"><Award size={13} aria-hidden="true" />{participant.skillBadgeCount ?? "—"}</span> : <span className="g-cell-muted">—</span>}</td>
                        <td>{participant.lastCheckedAt ? <span className="g-cell-badge g-cell-arcade"><Gamepad2 size={13} aria-hidden="true" />{participant.arcadeGameBadgeCount ?? "—"}</span> : <span className="g-cell-muted">—</span>}</td>
                        <td>{participant.lastCheckedAt ? <strong className="g-cell-total">{participant.verifiedBadgeCount}</strong> : <span className="g-cell-muted">—</span>}</td>
                        <td>
                          {!participant.lastCheckedAt
                            ? <span className="g-cell-muted">After review</span>
                            : participant.skillBadgeCount !== null
                              ? <ProgressMeter count={participant.skillBadgeCount} target={10} label={`${participant.displayName} skill badge progress`} />
                              : <span className="g-cell-muted">Not classified</span>}
                        </td>
                        <td>{participant.lastCheckedAt ? <RankStatus skillBadgeCount={participant.skillBadgeCount} frozenRank={participant.frozenRank} /> : <span className="g-status g-status-yellow">Awaiting review</span>}</td>
                      </tr>
                    ))}
                  </motion.tbody>
                </table>
              </div>

              <ul className="g-mobile-board" aria-label="Leaderboard participants">
                {pageRows.map(({ participant, rank }) => (
                  <li key={participant.id}>
                    <button type="button" className="g-mobile-card" onClick={() => setSelected(participant)} aria-label={`Open ${participant.displayName}'s profile`}>
                      <span className="g-mobile-top">
                        <RankBadge rank={rank} frozen={Boolean(participant.frozenRank)} />
                        <Avatar participant={participant} />
                        <span className="g-mobile-person">
                          <strong>{participant.displayName}</strong>
                          <small>{participant.frozenRank ? "Frozen rank" : isDemo ? "Synthetic example" : "Registered participant"}</small>
                        </span>
                        {participant.frozenRank && <span className="g-lock-chip"><Lock size={10} aria-hidden="true" />Frozen</span>}
                      </span>
                      <BadgePills participant={participant} />
                      <span className="g-mobile-bottom">
                        {participant.lastCheckedAt
                          ? participant.skillBadgeCount !== null
                            ? <ProgressMeter count={participant.skillBadgeCount} target={10} label={`${participant.displayName} skill badge progress`} />
                            : <span className="g-cell-muted">Skill badges not classified</span>
                          : <span className="g-cell-muted">Progress appears after manual review</span>}
                        {participant.lastCheckedAt && <RankStatus skillBadgeCount={participant.skillBadgeCount} frozenRank={participant.frozenRank} />}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>

              <Pagination page={safePage} pageCount={pageCount} onPage={setPage} />
            </>
          )}
        </section>

        {diagnostics && <div className="g-diagnostics">{diagnostics}</div>}

        <CommunityFooter />
      </main>

      <AnimatePresence>
        {selected && <ParticipantDialog key={selected.id} participant={selected} onClose={() => setSelected(null)} reduceMotion={reduceMotion} />}
      </AnimatePresence>
    </div>
  );
}

function Pagination({ page, pageCount, onPage }: { page: number; pageCount: number; onPage: (page: number) => void }) {
  if (pageCount <= 1) return null;
  const tokens: (number | "gap")[] = [];
  if (pageCount <= 7) {
    for (let index = 1; index <= pageCount; index += 1) tokens.push(index);
  } else {
    tokens.push(1);
    const start = Math.max(2, page - 1);
    const end = Math.min(pageCount - 1, page + 1);
    if (start > 2) tokens.push("gap");
    for (let index = start; index <= end; index += 1) tokens.push(index);
    if (end < pageCount - 1) tokens.push("gap");
    tokens.push(pageCount);
  }

  return (
    <nav className="g-pagination" aria-label="Leaderboard pages">
      <button type="button" className="g-page-arrow" onClick={() => onPage(page - 1)} disabled={page === 1} aria-label="Previous page"><ChevronLeft size={16} /></button>
      <span className="g-page-numbers">
        {tokens.map((token, index) => token === "gap"
          ? <span key={`gap-${index}`} className="g-page-gap" aria-hidden="true">…</span>
          : <button key={token} type="button" className={token === page ? "g-page-number is-active" : "g-page-number"} aria-current={token === page ? "page" : undefined} onClick={() => onPage(token)}>{token}</button>)}
      </span>
      <button type="button" className="g-page-arrow" onClick={() => onPage(page + 1)} disabled={page === pageCount} aria-label="Next page"><ChevronRight size={16} /></button>
      <span className="g-page-summary">Page {page} of {pageCount}</span>
    </nav>
  );
}

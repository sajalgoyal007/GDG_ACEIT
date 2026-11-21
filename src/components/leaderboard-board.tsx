"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { ArrowUp, Award, Gamepad2, Lock, RefreshCw, Search, X } from "lucide-react";
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

const filters: { key: FilterKey; label: string; shortLabel: string }[] = [
  { key: "all", label: "All", shortLabel: "All" },
  { key: "frozen", label: "Frozen Ranks (10+ Skill)", shortLabel: "Frozen Ranks" },
  { key: "skill", label: "Skill", shortLabel: "Skill" },
  { key: "arcade", label: "Arcade", shortLabel: "Arcade" },
];

/**
 * The single interactive leaderboard used by both the home page and /progress.
 * It owns search, filters, the full continuous list, the participant dialog,
 * and the LAST UPDATED / Refresh data controls so both pages behave identically.
 */
export function LeaderboardBoard({
  snapshot,
  kicker = "LIVE LEADERBOARD",
  title,
  banner,
  headingId = "leaderboard-title",
}: {
  snapshot: LeaderboardSnapshot;
  kicker?: string;
  title: string;
  banner?: ReactNode;
  headingId?: string;
}) {
  const { participants, lastSyncedAt } = snapshot;
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const filterLayoutId = useId();
  const [isRefreshing, startRefresh] = useTransition();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [selected, setSelected] = useState<PublicParticipant | null>(null);
  const boardRef = useRef<HTMLElement>(null);
  const nativeListRef = useRef<HTMLUListElement>(null);
  const backTopRef = useRef<HTMLButtonElement>(null);

  const ranked = useMemo(() => rankParticipants(participants), [participants]);
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

  useEffect(() => {
    let frame = 0;

    const update = () => {
      frame = 0;
      const isMobile = window.matchMedia("(max-width: 767.98px)").matches;
      const row = nativeListRef.current?.children[14];
      const visible =
        isMobile && row instanceof HTMLElement && row.getBoundingClientRect().bottom < 72;
      backTopRef.current?.classList.toggle("is-visible", visible);
    };

    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [visible]);

  function resetFilters() {
    setSearch("");
    setFilter("all");
  }

  return (
    <div className="g-board-wrap">
      {banner}
      <section ref={boardRef} className="g-board" aria-labelledby={headingId}>
        <div className="g-board-head">
          <div>
            <p className="g-kicker">{kicker}</p>
            <h2 id={headingId}>{title}</h2>
          </div>
          <div className="g-board-tools">
            <span className="g-timestamp">
              <span>LAST UPDATED</span>
              <time dateTime={lastSyncedAt}>{formatTimestamp(lastSyncedAt)} IST</time>
            </span>
            <button
              type="button"
              className="g-refresh"
              onClick={() => startRefresh(() => router.refresh())}
              disabled={isRefreshing}
              aria-busy={isRefreshing}
            >
              <RefreshCw size={14} aria-hidden="true" className={isRefreshing ? "is-spinning" : undefined} />
              {isRefreshing ? "Refreshing" : "Refresh data"}
            </button>
            <span className="g-board-count">
              <strong>{visible.length.toLocaleString("en-IN")}</strong>{" "}
              {visible.length === 1 ? "builder" : "builders"}
            </span>
          </div>
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
            {search && (
              <button type="button" className="g-search-clear" onClick={() => setSearch("")} aria-label="Clear search">
                <X size={14} />
              </button>
            )}
          </label>

          <LayoutGroup>
            <div className="g-filter-pills no-scrollbar" role="group" aria-label="Filter leaderboard">
              {filters.map(({ key, label, shortLabel }) => {
                const active = filter === key;
                return (
                  <motion.button
                    key={key}
                    type="button"
                    className={active ? "g-filter is-active" : "g-filter"}
                    aria-pressed={active}
                    onClick={() => setFilter(key)}
                    whileTap={{ scale: 0.96 }}
                    transition={{ type: "spring", stiffness: 500, damping: 34 }}
                  >
                    {active && (
                      <motion.span
                        className="g-filter-bg"
                        layoutId={`${filterLayoutId}-active-filter`}
                        transition={{ type: "spring", stiffness: 380, damping: 32 }}
                      />
                    )}
                    <span className="g-filter-label">
                      <span className="g-filter-label-full">{label}</span>
                      <span className="g-filter-label-short">{shortLabel}</span>
                    </span>
                  </motion.button>
                );
              })}
            </div>
          </LayoutGroup>
        </div>

        <div className="g-board-meta">
          <span>
            Showing all <strong>{visible.length.toLocaleString("en-IN")}</strong>{" "}
            {visible.length === 1 ? "builder" : "builders"} in one continuous list
          </span>
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
                <tbody>
                  {visible.map(({ participant, rank }) => (
                    <tr key={participant.id}>
                      <td>
                        <RankBadge rank={rank} frozen={Boolean(participant.frozenRank)} />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="g-row-person"
                          onClick={() => setSelected(participant)}
                          aria-label={`Open ${participant.displayName}'s profile`}
                        >
                          <Avatar participant={participant} size="sm" />
                          <span>
                            <strong>{participant.displayName}</strong>
                            <small>
                              {participant.frozenRank
                                ? "Frozen rank captured"
                                : isDemo
                                  ? "Synthetic example"
                                  : "Registered participant"}
                            </small>
                          </span>
                        </button>
                      </td>
                      <td>
                        {participant.lastCheckedAt ? (
                          <span className="g-cell-badge g-cell-skill">
                            <Award size={13} aria-hidden="true" />
                            {participant.skillBadgeCount ?? "—"}
                          </span>
                        ) : (
                          <span className="g-cell-muted">—</span>
                        )}
                      </td>
                      <td>
                        {participant.lastCheckedAt ? (
                          <span className="g-cell-badge g-cell-arcade">
                            <Gamepad2 size={13} aria-hidden="true" />
                            {participant.arcadeGameBadgeCount ?? "—"}
                          </span>
                        ) : (
                          <span className="g-cell-muted">—</span>
                        )}
                      </td>
                      <td>
                        {participant.lastCheckedAt ? (
                          <strong className="g-cell-total">{participant.verifiedBadgeCount}</strong>
                        ) : (
                          <span className="g-cell-muted">—</span>
                        )}
                      </td>
                      <td>
                        {!participant.lastCheckedAt ? (
                          <span className="g-cell-muted">After review</span>
                        ) : participant.skillBadgeCount !== null ? (
                          <ProgressMeter
                            count={participant.skillBadgeCount}
                            target={10}
                            label={`${participant.displayName} skill badge progress`}
                          />
                        ) : (
                          <span className="g-cell-muted">Not classified</span>
                        )}
                      </td>
                      <td>
                        {participant.lastCheckedAt ? (
                          <RankStatus
                            skillBadgeCount={participant.skillBadgeCount}
                            frozenRank={participant.frozenRank}
                          />
                        ) : (
                          <span className="g-status g-status-yellow">Awaiting review</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="g-mobile-board" aria-label="Leaderboard participants">
              {visible.map(({ participant, rank }) => (
                <li key={participant.id}>
                  <button
                    type="button"
                    className="g-mobile-card"
                    onClick={() => setSelected(participant)}
                    aria-label={`Open ${participant.displayName}'s profile`}
                  >
                    <span className="g-mobile-top">
                      <RankBadge rank={rank} frozen={Boolean(participant.frozenRank)} />
                      <Avatar participant={participant} />
                      <span className="g-mobile-person">
                        <strong>{participant.displayName}</strong>
                        <small>
                          {participant.frozenRank ? "Frozen rank" : isDemo ? "Synthetic example" : "Registered participant"}
                        </small>
                      </span>
                      {participant.frozenRank && (
                        <span className="g-lock-chip">
                          <Lock size={10} aria-hidden="true" />
                          Frozen
                        </span>
                      )}
                    </span>
                    <BadgePills participant={participant} />
                    <span className="g-mobile-bottom">
                      {participant.lastCheckedAt ? (
                        participant.skillBadgeCount !== null ? (
                          <ProgressMeter
                            count={participant.skillBadgeCount}
                            target={10}
                            label={`${participant.displayName} skill badge progress`}
                          />
                        ) : (
                          <span className="g-cell-muted">Skill badges not classified</span>
                        )
                      ) : (
                        <span className="g-cell-muted">Progress appears after manual review</span>
                      )}
                      {participant.lastCheckedAt && (
                        <RankStatus
                          skillBadgeCount={participant.skillBadgeCount}
                          frozenRank={participant.frozenRank}
                        />
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            <ul ref={nativeListRef} className="g-native-board" aria-label="Leaderboard participants">
              {visible.map(({ participant, rank }) => {
                const reviewed = Boolean(participant.lastCheckedAt);
                const skill = participant.skillBadgeCount ?? 0;
                const cappedSkill = Math.min(Math.max(skill, 0), 10);
                const statusClass = participant.frozenRank
                  ? "g-native-status is-frozen"
                  : reviewed
                    ? "g-native-status"
                    : "g-native-status is-pending";

                return (
                  <li key={participant.id}>
                    <button
                      type="button"
                      className="g-native-row"
                      onClick={() => setSelected(participant)}
                      aria-label={`Open ${participant.displayName}'s profile`}
                    >
                      <span className="g-native-line g-native-line-top">
                        <RankBadge rank={rank} frozen={Boolean(participant.frozenRank)} />
                        <Avatar participant={participant} size="sm" />
                        <span className="g-native-name">{participant.displayName}</span>
                        <span className={statusClass}>
                          {participant.frozenRank && <Lock size={11} aria-hidden="true" />}
                          {reviewed ? `${cappedSkill}/10` : "—"}
                        </span>
                      </span>
                      <span className="g-native-line g-native-line-detail">
                        <span className="g-native-chips">
                          {reviewed ? (
                            <>
                              <span><strong>{participant.skillBadgeCount ?? "—"}</strong> Skill</span>
                              <span className="g-native-chip-sep" aria-hidden="true">·</span>
                              <span><strong>{participant.arcadeGameBadgeCount ?? "—"}</strong> Arcade</span>
                              <span className="g-native-chip-sep" aria-hidden="true">·</span>
                              <span>Total <strong>{participant.verifiedBadgeCount}</strong></span>
                            </>
                          ) : (
                            <span>Awaiting manual review</span>
                          )}
                        </span>
                        <span
                          className="g-native-track"
                          role="progressbar"
                          aria-label={`${participant.displayName} skill badge progress`}
                          aria-valuemin={0}
                          aria-valuemax={10}
                          aria-valuenow={reviewed ? cappedSkill : 0}
                        >
                          <span className="g-native-fill" style={{ transform: `scaleX(${reviewed ? cappedSkill / 10 : 0})` }} />
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      <button
        ref={backTopRef}
        type="button"
        className="g-back-top"
        aria-label="Back to top of leaderboard"
        onClick={() => boardRef.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" })}
      >
        <ArrowUp size={14} aria-hidden="true" /> Top
      </button>

      <AnimatePresence>
        {selected && (
          <ParticipantDialog
            key={selected.id}
            participant={selected}
            onClose={() => setSelected(null)}
            reduceMotion={reduceMotion}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

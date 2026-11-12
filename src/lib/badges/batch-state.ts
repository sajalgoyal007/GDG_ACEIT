/**
 * Client-side state for the one-click badge sync.
 *
 * The reducer is intentionally pure so the polling/looping behavior can be
 * tested without a browser. The route is still the authority: this only mirrors
 * what it reported and never derives counts on its own.
 */

import type { BadgeSyncFetchProgress } from "./fetch-queue.ts";
import type { BadgeSyncSnapshot } from "./snapshot.ts";

export type BadgeSyncPhase =
  | "idle"
  | "starting"
  | "running"
  | "paused"
  | "previewed"
  | "applied"
  | "rolled_back"
  | "disabled"
  | "error";

export type BadgeSyncResponseStatus =
  | "idle"
  | "running"
  | "paused"
  | "previewed"
  | "applied"
  | "rolled_back"
  | "disabled"
  | "error"
  | "temporarily_unavailable";

export interface BadgeSyncBatchResponse {
  status: BadgeSyncResponseStatus;
  message: string;
  runId?: string;
  progress?: BadgeSyncFetchProgress;
  snapshot?: BadgeSyncSnapshot;
  halted?: "rate_limited" | "blocked" | null;
}

export interface BadgeSyncViewState {
  phase: BadgeSyncPhase;
  runId: string | null;
  progress: BadgeSyncFetchProgress | null;
  snapshot: BadgeSyncSnapshot | null;
  message: string;
  halted: "rate_limited" | "blocked" | null;
  /** Number of route round-trips, used to bound the client loop. */
  batches: number;
}

export const initialBadgeSyncViewState: BadgeSyncViewState = {
  phase: "idle",
  runId: null,
  progress: null,
  snapshot: null,
  message: "",
  halted: null,
  batches: 0,
};

export type BadgeSyncViewAction =
  | { type: "start" }
  | { type: "response"; response: BadgeSyncBatchResponse }
  | { type: "pause_requested" }
  | { type: "resume_requested" }
  | { type: "snapshot"; snapshot: BadgeSyncSnapshot; message?: string }
  | { type: "failure"; message: string }
  | { type: "reset" };

function phaseForStatus(status: BadgeSyncResponseStatus): BadgeSyncPhase {
  if (status === "running") return "running";
  if (status === "paused") return "paused";
  if (status === "previewed") return "previewed";
  if (status === "applied") return "applied";
  if (status === "rolled_back") return "rolled_back";
  if (status === "disabled") return "disabled";
  if (status === "idle") return "idle";
  return "error";
}

export function badgeSyncViewReducer(
  state: BadgeSyncViewState,
  action: BadgeSyncViewAction,
): BadgeSyncViewState {
  switch (action.type) {
    case "start":
      return {
        ...initialBadgeSyncViewState,
        phase: "starting",
        message: "Creating a profile-evidence run…",
      };
    case "pause_requested":
      return { ...state, phase: "paused", message: "Pausing after the current reads finish…" };
    case "resume_requested":
      return { ...state, phase: "running", message: "Resuming the queue…" };
    case "failure":
      return { ...state, phase: "error", message: action.message };
    case "snapshot": {
      const runStatus = action.snapshot.run.status;
      const phase: BadgeSyncPhase = runStatus === "applied"
        ? "applied"
        : runStatus === "rolled_back"
          ? "rolled_back"
          : runStatus === "previewed" || runStatus === "approved"
            ? "previewed"
            : "running";
      return {
        ...state,
        phase,
        runId: action.snapshot.run.id,
        snapshot: action.snapshot,
        message: action.message ?? state.message,
      };
    }
    case "response": {
      const { response } = action;
      return {
        ...state,
        phase: phaseForStatus(response.status),
        runId: response.runId ?? state.runId,
        progress: response.progress ?? state.progress,
        snapshot: response.snapshot ?? state.snapshot,
        message: response.message,
        halted: response.halted ?? null,
        batches: state.batches + 1,
      };
    }
    case "reset":
      return { ...initialBadgeSyncViewState };
    default:
      return state;
  }
}

/** The client loop stops for everything except a normal running batch. */
export function shouldContinueBadgeSyncLoop(state: BadgeSyncViewState, maxBatches = 64): boolean {
  return state.phase === "running" && state.batches < maxBatches;
}

export function badgeSyncProgressPercent(progress: BadgeSyncFetchProgress | null): number {
  if (!progress || progress.total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((progress.processed / progress.total) * 100)));
}

export function badgeSyncUnclassifiedBadges(snapshot: BadgeSyncSnapshot | null) {
  if (!snapshot) return [];
  const seen = new Map<string, { badgeKey: string; badgeTitle: string; participants: number }>();
  for (const badge of snapshot.badges) {
    if (badge.category !== "unclassified") continue;
    const existing = seen.get(badge.badge_key);
    if (existing) existing.participants += 1;
    else seen.set(badge.badge_key, { badgeKey: badge.badge_key, badgeTitle: badge.badge_title, participants: 1 });
  }
  return [...seen.values()].sort((left, right) => left.badgeKey.localeCompare(right.badgeKey));
}

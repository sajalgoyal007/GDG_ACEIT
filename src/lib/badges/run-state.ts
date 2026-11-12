/**
 * Badge sync run lifecycle.
 *
 *   draft -> staged -> previewed -> approved -> applying -> applied
 *
 * `failed` and `cancelled` are terminal only when reached explicitly. A failed
 * apply transaction rolls back, so the run remains `approved` and can be
 * retried. An already-`applied` run is replayed from its stored result; it is
 * never applied a second time.
 */

export const BADGE_SYNC_RUN_STATUSES = [
  "draft",
  "staged",
  "previewed",
  "approved",
  "applying",
  "applied",
  "rolled_back",
  "failed",
  "cancelled",
] as const;

export type BadgeSyncRunStatus = (typeof BADGE_SYNC_RUN_STATUSES)[number];

const TRANSITIONS: Record<BadgeSyncRunStatus, readonly BadgeSyncRunStatus[]> = {
  draft: ["staged", "cancelled"],
  staged: ["staged", "previewed", "cancelled"],
  previewed: ["previewed", "approved", "staged", "cancelled"],
  approved: ["applying", "approved", "cancelled"],
  applying: ["applied"],
  applied: ["rolled_back"],
  rolled_back: [],
  failed: [],
  cancelled: [],
};

export class BadgeSyncTransitionError extends Error {
  readonly from: BadgeSyncRunStatus;
  readonly to: BadgeSyncRunStatus;

  constructor(from: BadgeSyncRunStatus, to: BadgeSyncRunStatus) {
    super(`Badge sync run cannot move from ${from} to ${to}.`);
    this.name = "BadgeSyncTransitionError";
    this.from = from;
    this.to = to;
  }
}

export function isBadgeSyncRunStatus(value: unknown): value is BadgeSyncRunStatus {
  return typeof value === "string" && (BADGE_SYNC_RUN_STATUSES as readonly string[]).includes(value);
}

export function canTransition(from: BadgeSyncRunStatus, to: BadgeSyncRunStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: BadgeSyncRunStatus, to: BadgeSyncRunStatus): void {
  if (!canTransition(from, to)) throw new BadgeSyncTransitionError(from, to);
}

export function isTerminalStatus(status: BadgeSyncRunStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

export function isAwaitingApproval(status: BadgeSyncRunStatus): boolean {
  return status === "previewed";
}

export type ApplyDisposition =
  | { action: "apply" }
  | { action: "replay"; reason: "already-applied" }
  | { action: "reject"; reason: string };

/**
 * Decide what an apply request may do for a run in the given state. This mirrors
 * the server-side guard; it is never the sole protection.
 */
export function applyDisposition(status: BadgeSyncRunStatus): ApplyDisposition {
  if (status === "applied") return { action: "replay", reason: "already-applied" };
  if (status === "approved") return { action: "apply" };
  if (status === "applying") return { action: "reject", reason: "This run is already being applied." };
  if (status === "rolled_back") return { action: "reject", reason: "This run has already been rolled back." };
  return { action: "reject", reason: "Only an approved run can be applied." };
}

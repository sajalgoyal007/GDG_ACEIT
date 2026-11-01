export type AutoFetchStatus =
  | "ok" | "private" | "not_found" | "rate_limited" | "blocked" | "timeout"
  | "upstream_error" | "parse_error" | "incomplete" | "duplicate_profile" | "unavailable";

export type AutoProgressDisplayState = "current" | "stale" | "unavailable";

export type AutoProgressRow = {
  participantId: string;
  displayName: string;
  fetchStatus: AutoFetchStatus;
  eligibleBadgeCount: number | null;
  lastSuccessfulCheckAt: string | null;
  lastProgressChangeAt: string | null;
  tenBadgeFirstObservedAt: string | null;
  tenBadgeFinishRank: number | null;
  unverifiedBadgeCount?: number | null;
  unverifiedImportedAt?: string | null;
  unverifiedSource?: "organizer_csv" | null;
  displayState: AutoProgressDisplayState;
  progressLabel: string;
  milestoneLabel: string | null;
};

export function toAutoProgressRow(input: Omit<AutoProgressRow, "displayState" | "progressLabel" | "milestoneLabel">, now = Date.now(), freshnessMs = 30 * 60 * 1000): AutoProgressRow {
  const lastSuccess = input.lastSuccessfulCheckAt ? Date.parse(input.lastSuccessfulCheckAt) : NaN;
  const age = now - lastSuccess;
  const ambiguousDuplicate = input.fetchStatus === "duplicate_profile";
  const displayState: AutoProgressDisplayState =
    input.eligibleBadgeCount === null || ambiguousDuplicate || !Number.isFinite(lastSuccess)
      ? "unavailable"
      : input.fetchStatus !== "ok" || age < 0 || age > freshnessMs
        ? "stale"
        : "current";
  const count = displayState === "unavailable" ? null : input.eligibleBadgeCount;
  const progressLabel = count === null ? "Unavailable / 10" : `${Math.min(count, 10)} / 10`;
  return {
    ...input,
    eligibleBadgeCount: count,
    displayState,
    progressLabel,
    milestoneLabel: input.tenBadgeFirstObservedAt
      ? `10 badges first observed ${input.tenBadgeFirstObservedAt}`
      : null,
  };
}

export function sortAutoProgressRows<T extends Pick<AutoProgressRow, "eligibleBadgeCount" | "lastProgressChangeAt" | "participantId">>(rows: readonly T[]): T[] {
  return [...rows].sort((left, right) => {
    const countOrder = (right.eligibleBadgeCount ?? -1) - (left.eligibleBadgeCount ?? -1);
    if (countOrder !== 0) return countOrder;
    const leftTime = left.lastProgressChangeAt ? Date.parse(left.lastProgressChangeAt) : Number.NEGATIVE_INFINITY;
    const rightTime = right.lastProgressChangeAt ? Date.parse(right.lastProgressChangeAt) : Number.NEGATIVE_INFINITY;
    if (rightTime !== leftTime) return rightTime - leftTime;
    return left.participantId.localeCompare(right.participantId);
  });
}

export type AuditEventFilter =
  | "participant_imported"
  | "participant_synced"
  | "badge_count_updated"
  | "participant_removed";

export type AuditFilter = "all" | AuditEventFilter;

/**
 * The searchable projection of an audit event. Labels are supplied by the UI so
 * this helper has no dependency on React or presentation strings.
 */
export type AuditActivity = {
  eventType: AuditEventFilter;
  participantName: string;
  actionLabel: string;
  sourceLabel: string;
  note: string | null;
  actorUserId: string | null;
};

export function filterAuditActivities<T extends AuditActivity>(
  activities: readonly T[],
  { query, filter }: { query: string; filter: AuditFilter },
): T[] {
  const normalized = query.trim().toLocaleLowerCase();
  return activities.filter((event) => {
    if (filter !== "all" && event.eventType !== filter) return false;
    if (!normalized) return true;
    return [
      event.participantName,
      event.actionLabel,
      event.sourceLabel,
      event.note ?? "",
      event.actorUserId ?? "",
    ].some((value) => value.toLocaleLowerCase().includes(normalized));
  });
}

export function paginateAuditActivities<T>(
  activities: readonly T[],
  limit: number,
): { visible: T[]; hasMore: boolean; total: number } {
  const safeLimit = Math.max(0, Math.floor(limit));
  return {
    visible: activities.slice(0, safeLimit),
    hasMore: activities.length > safeLimit,
    total: activities.length,
  };
}

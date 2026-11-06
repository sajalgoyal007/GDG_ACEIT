export interface RawAdminParticipantRow {
  id: string;
  participant_key: string;
  display_name: string;
  profile_url: string | null;
  registration_status: "registered" | "pending" | "removed";
  verified_badge_count: number;
  skill_badge_count?: number | null;
  arcade_game_badge_count?: number | null;
  last_verified_at: string | null;
  verification_source: string | null;
  removed_at?: string | null;
  removal_reason?: string | null;
  created_at: string;
  updated_at: string;
}

export interface RawAuditEventRow {
  id: string;
  participant_id: string;
  event_type: string;
  source: string;
  previous_badge_count: number | null;
  new_badge_count: number | null;
  note: string | null;
  actor_user_id: string | null;
  created_at: string;
  verified_at: string | null;
}

export interface AdminParticipantRow extends RawAdminParticipantRow {
  audit: {
    id: string;
    eventType: "participant_imported" | "participant_synced" | "badge_count_updated" | "participant_removed";
    source: "csv_import" | "admin_manual" | "google_sheets_sync";
    previousBadgeCount: number | null;
    newBadgeCount: number | null;
    note: string | null;
    actorUserId: string | null;
    createdAt: string;
    verifiedAt: string | null;
  }[];
}

export function buildAdminParticipantRows(
  participants: readonly RawAdminParticipantRow[],
  auditEvents?: readonly RawAuditEventRow[] | null
): AdminParticipantRow[] {
  const auditByParticipant = new Map<string, NonNullable<AdminParticipantRow["audit"]>>();
  for (const event of auditEvents ?? []) {
    const events = auditByParticipant.get(event.participant_id) ?? [];
    events.push({
      id: event.id,
      eventType: event.event_type as "participant_imported" | "participant_synced" | "badge_count_updated" | "participant_removed",
      source: event.source as "csv_import" | "admin_manual" | "google_sheets_sync",
      previousBadgeCount: event.previous_badge_count,
      newBadgeCount: event.new_badge_count,
      note: event.note,
      actorUserId: event.actor_user_id,
      createdAt: event.created_at,
      verifiedAt: event.verified_at,
    });
    auditByParticipant.set(event.participant_id, events);
  }

  return (participants ?? []).map((participant) => ({
    ...participant,
    audit: auditByParticipant.get(participant.id) ?? [],
  }));
}


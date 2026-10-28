import "server-only";

import { createSupabaseServerClient } from "./server";

export interface AdminParticipantRow {
  id: string;
  participant_key: string;
  display_name: string;
  profile_url: string | null;
  registration_status: "registered" | "pending";
  verified_badge_count: number;
  last_verified_at: string | null;
  verification_source: string | null;
  created_at: string;
  updated_at: string;
  audit: {
    id: string;
    eventType: "participant_imported" | "participant_synced" | "badge_count_updated";
    source: "csv_import" | "admin_manual" | "google_sheets_sync";
    previousBadgeCount: number | null;
    newBadgeCount: number | null;
    note: string | null;
    actorUserId: string | null;
    createdAt: string;
    verifiedAt: string | null;
  }[];
}

export async function getAdminParticipants() {
  const supabase = await createSupabaseServerClient();
  const [participantsResult, auditResult] = await Promise.all([
    supabase.from("participants")
      .select("id,participant_key,display_name,profile_url,registration_status,verified_badge_count,last_verified_at,verification_source,created_at,updated_at")
      .order("display_name", { ascending: true }),
    supabase.from("participant_audit_events")
      .select("id,participant_id,event_type,source,previous_badge_count,new_badge_count,note,actor_user_id,created_at,verified_at")
      .order("created_at", { ascending: false }),
  ]);
  if (participantsResult.error || auditResult.error) throw new Error("Admin participant or audit data could not be loaded. Check database policies.");
  const auditByParticipant = new Map<string, NonNullable<AdminParticipantRow["audit"]>>();
  for (const event of auditResult.data ?? []) {
    const events = auditByParticipant.get(event.participant_id) ?? [];
    events.push({
      id: event.id,
      eventType: event.event_type as "participant_imported" | "participant_synced" | "badge_count_updated",
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
  return (participantsResult.data ?? []).map((participant) => ({
    ...participant,
    audit: auditByParticipant.get(participant.id) ?? [],
  })) as unknown as AdminParticipantRow[];
}

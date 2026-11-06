import "server-only";

import { createSupabaseServerClient } from "./server";
import {
  buildAdminParticipantRows,
  type AdminParticipantRow,
  type RawAdminParticipantRow,
  type RawAuditEventRow,
} from "./admin-data-helper";

export type { AdminParticipantRow };

export async function getAdminParticipants() {
  const supabase = await createSupabaseServerClient();
  const [participantsResult, auditResult] = await Promise.all([
    supabase
      .from("participants")
      .select("id,participant_key,display_name,profile_url,registration_status,verified_badge_count,skill_badge_count,arcade_game_badge_count,last_verified_at,verification_source,removed_at,removal_reason,created_at,updated_at")
      .order("display_name", { ascending: true }),
    Promise.resolve(
      supabase
        .from("participant_audit_events")
        .select("id,participant_id,event_type,source,previous_badge_count,new_badge_count,note,actor_user_id,created_at,verified_at")
        .order("created_at", { ascending: false })
    ).catch((error: unknown) => ({ data: null, error })),
  ]);

  // Participant data is mandatory: if the table cannot be queried, fail explicitly.
  if (participantsResult.error) {
    throw new Error("Admin participant data could not be loaded. Check database policies.");
  }

  // Audit history is optional and non-fatal: if audit querying fails or is empty,
  // participants still render successfully with empty audit records.
  const auditEvents = auditResult && !auditResult.error && Array.isArray(auditResult.data)
    ? (auditResult.data as unknown as RawAuditEventRow[])
    : [];

  return buildAdminParticipantRows(
    (participantsResult.data ?? []) as unknown as RawAdminParticipantRow[],
    auditEvents
  );
}

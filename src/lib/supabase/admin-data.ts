import "server-only";

import { createSupabaseServerClient } from "./server";
import {
  buildAdminParticipantRows,
  type AdminParticipantRow,
  type RawAdminParticipantRow,
  type RawAuditEventRow,
} from "./admin-data-helper";

export type { AdminParticipantRow };

const AUDIT_PAGE_SIZE = 1000;

/**
 * Reads every audit event, not just the first PostgREST page. The Admin History
 * panel paginates client-side, so the complete immutable trail must be loaded.
 */
async function getAllAuditEvents(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>) {
  const events: RawAuditEventRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("participant_audit_events")
      .select("id,participant_id,event_type,source,previous_badge_count,new_badge_count,note,actor_user_id,created_at,verified_at")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + AUDIT_PAGE_SIZE - 1);

    if (error) break;

    const page = (data ?? []) as unknown as RawAuditEventRow[];
    events.push(...page);
    if (page.length < AUDIT_PAGE_SIZE) break;
    from += AUDIT_PAGE_SIZE;
  }

  return events;
}

export async function getAdminParticipants() {
  const supabase = await createSupabaseServerClient();
  const [participantsResult, auditEvents] = await Promise.all([
    supabase
      .from("participants")
      .select("id,participant_key,display_name,profile_url,registration_status,verified_badge_count,skill_badge_count,arcade_game_badge_count,last_verified_at,verification_source,removed_at,removal_reason,created_at,updated_at")
      .order("display_name", { ascending: true }),
    // Audit history is optional and non-fatal: if audit querying fails or is
    // empty, participants still render successfully with empty audit records.
    getAllAuditEvents(supabase).catch(() => []),
  ]);

  // Participant data is mandatory: if the table cannot be queried, fail explicitly.
  if (participantsResult.error) {
    throw new Error("Admin participant data could not be loaded. Check database policies.");
  }

  return buildAdminParticipantRows(
    (participantsResult.data ?? []) as unknown as RawAdminParticipantRow[],
    auditEvents
  );
}

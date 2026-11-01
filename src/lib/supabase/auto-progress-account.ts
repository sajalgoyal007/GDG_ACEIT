import "server-only";

import { validateGoogleSkillsProfileUrl } from "@/lib/auto-progress/profile-url";
import { participantKeyForVerifiedEmail } from "@/lib/auto-progress/participant-identity";
import { createSupabaseServerClient } from "./server";
import { createSupabaseServiceClient } from "./service";
import { isSupabaseConfigured } from "./config";

export type AuthenticatedParticipant = {
  participantId: string;
  profileUrl: string;
};

export type ParticipantIdentityResult =
  | { status: "unconfigured" | "signed_out" | "unverified_email" | "not_linked" | "check_failed" }
  | { status: "linked"; participant: AuthenticatedParticipant };

/**
 * Resolves only the signed-in user's confirmed registration email. No browser
 * supplied participant ID or profile URL participates in this lookup.
 */
export async function getAuthenticatedParticipant(): Promise<ParticipantIdentityResult> {
  if (!isSupabaseConfigured()) return { status: "unconfigured" };
  const authClient = await createSupabaseServerClient();
  const { data, error } = await authClient.auth.getUser();
  if (error || !data.user) return { status: "signed_out" };
  if (!data.user.email || !data.user.email_confirmed_at) return { status: "unverified_email" };

  const matchSecret = process.env.PARTICIPANT_MATCH_HMAC_SECRET;
  if (!matchSecret || Buffer.byteLength(matchSecret, "utf8") < 32) return { status: "unconfigured" };
  let serviceClient;
  try {
    serviceClient = createSupabaseServiceClient();
  } catch {
    return { status: "unconfigured" };
  }

  const participantKey = participantKeyForVerifiedEmail(data.user.email, matchSecret);
  if (!participantKey) return { status: "unverified_email" };
  const { data: participant, error: participantError } = await serviceClient
    .from("participants")
    .select("id,profile_url")
    .eq("participant_key", participantKey)
    .eq("registration_status", "registered")
    .maybeSingle();
  if (participantError) return { status: "check_failed" };
  if (!participant?.profile_url) return { status: "not_linked" };
  if (!validateGoogleSkillsProfileUrl(participant.profile_url).ok) return { status: "check_failed" };

  return {
    status: "linked",
    participant: { participantId: participant.id, profileUrl: participant.profile_url },
  };
}

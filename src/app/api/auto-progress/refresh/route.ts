import { NextResponse, type NextRequest } from "next/server";
import { refreshParticipantAutoProgress } from "@/lib/auto-progress/service";
import { googleSkillsAutoProgressProvider } from "@/lib/auto-progress/provider";
import { handleRefreshRequest } from "@/lib/auto-progress/refresh-handler";
import { isAutoProgressEnabled } from "@/lib/auto-progress/config";
import { getAuthenticatedParticipant } from "@/lib/supabase/auto-progress-account";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

function json(status: number, body: { status: string; message: string; retryAfterSeconds?: number }) {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (body.retryAfterSeconds) headers.set("Retry-After", String(body.retryAfterSeconds));
  return NextResponse.json(body, { status, headers });
}

export async function POST(request: NextRequest) {
  try {
    const result = await handleRefreshRequest({
      origin: request.headers.get("origin"),
      requestOrigin: request.nextUrl.origin,
      configured: isSupabaseConfigured(),
      getAuthStatus: async () => {
        const auth = await createSupabaseServerClient();
        const { data, error } = await auth.auth.getUser();
        if (error || !data.user) return "signed_out";
        return data.user.email && data.user.email_confirmed_at ? "authenticated" : "unverified_email";
      },
      // Never accept participant IDs or profile URLs from the browser.
      resolveIdentity: async () => {
        const identity = await getAuthenticatedParticipant();
        return identity.status === "linked"
          ? { status: "linked", participantId: identity.participant.participantId }
          : { status: identity.status };
      },
      enabled: isAutoProgressEnabled(),
      providerAvailable: googleSkillsAutoProgressProvider.availability === "available",
      execute: async (participantId) => refreshParticipantAutoProgress(createSupabaseServiceClient(), participantId),
    });
    return json(result.status, result.body);
  } catch {
    return json(503, { status: "temporarily_unavailable", message: "The refresh could not be completed. Any previous successful progress is unchanged." });
  }
}

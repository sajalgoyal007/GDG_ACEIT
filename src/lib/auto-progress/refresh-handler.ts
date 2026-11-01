import type { ClaimResult, PersistResult } from "./service.ts";
import { toRefreshHttpResult, type RefreshHttpResult } from "./refresh-response.ts";

export type RefreshIdentity =
  | { status: "linked"; participantId: string }
  | { status: "signed_out" | "not_linked" | "unconfigured" | "unverified_email" | "check_failed" };

export async function handleRefreshRequest(input: {
  origin: string | null;
  requestOrigin: string;
  configured: boolean;
  getAuthStatus: () => Promise<"authenticated" | "signed_out" | "unverified_email">;
  resolveIdentity: () => Promise<RefreshIdentity>;
  enabled: boolean;
  providerAvailable: boolean;
  execute: (participantId: string) => Promise<ClaimResult | PersistResult>;
}): Promise<RefreshHttpResult> {
  if (!input.origin || input.origin !== input.requestOrigin) {
    return { status: 403, body: { status: "invalid_origin", message: "This refresh request was rejected." } };
  }
  if (!input.configured) {
    return { status: 503, body: { status: "unconfigured", message: "Participant sign-in is not configured." } };
  }

  const authStatus = await input.getAuthStatus();
  if (authStatus === "signed_out") {
    return { status: 401, body: { status: "signed_out", message: "Sign in with the email used for your registration before refreshing progress." } };
  }
  if (authStatus === "unverified_email") {
    return { status: 403, body: { status: "unverified_email", message: "Confirm your account email before refreshing progress." } };
  }

  const identity = await input.resolveIdentity();
  if (identity.status === "not_linked") {
    return { status: 404, body: { status: "not_linked", message: "No registered participant with a linked public profile matches this account." } };
  }
  if (identity.status === "signed_out") {
    return { status: 401, body: { status: "signed_out", message: "Sign in before refreshing progress." } };
  }
  if (identity.status === "unverified_email") {
    return { status: 403, body: { status: "unverified_email", message: "Confirm your account email before refreshing progress." } };
  }
  if (identity.status !== "linked") {
    return { status: 503, body: { status: identity.status, message: "Participant identity could not be verified. No progress was changed." } };
  }

  if (!input.enabled) {
    return { status: 503, body: { status: "disabled", message: "Automatic progress refresh is disabled. Your last successful progress remains unchanged." } };
  }
  if (!input.providerAvailable) {
    return toRefreshHttpResult({ status: "provider_unavailable" });
  }
  return toRefreshHttpResult(await input.execute(identity.participantId));
}

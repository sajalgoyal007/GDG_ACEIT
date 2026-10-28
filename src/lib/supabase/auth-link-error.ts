export type AuthLinkErrorKind = "expired" | "invalid";

const expiredCodes = new Set(["otp_expired", "token_expired", "flow_state_expired"]);

export function getAuthLinkErrorKind(code: string | null | undefined): AuthLinkErrorKind {
  return code && expiredCodes.has(code.toLowerCase()) ? "expired" : "invalid";
}

export function getAuthLinkErrorMessage(kind: AuthLinkErrorKind) {
  return kind === "expired"
    ? "This sign-in link has expired. Request a fresh link to continue."
    : "This sign-in link is invalid or has already been used. Request a fresh link to continue.";
}

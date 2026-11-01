import { createHmac } from "node:crypto";

/** Matches the exact normalized email/HMAC format used by Google Form sync. */
export function participantKeyForVerifiedEmail(email: string, secret: string): string | null {
  const normalizedEmail = email.trim().toLocaleLowerCase("en-US");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
    || Buffer.byteLength(secret, "utf8") < 32) return null;
  const digest = createHmac("sha256", secret)
    .update(`participant-match:v1:${normalizedEmail}`)
    .digest("hex");
  return `form:${digest}`;
}

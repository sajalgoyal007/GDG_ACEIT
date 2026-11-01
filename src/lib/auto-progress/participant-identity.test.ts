import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { participantKeyForVerifiedEmail } from "./participant-identity.ts";

test("matches the existing registration email HMAC without storing the email", () => {
  const secret = "a sufficiently long non-secret test key used only by this test";
  const expectedDigest = createHmac("sha256", secret)
    .update("participant-match:v1:participant@example.com")
    .digest("hex");
  assert.equal(participantKeyForVerifiedEmail(" Participant@Example.com ", secret), `form:${expectedDigest}`);
});

test("rejects malformed email values and short HMAC secrets", () => {
  assert.equal(participantKeyForVerifiedEmail("not-an-email", "x".repeat(32)), null);
  assert.equal(participantKeyForVerifiedEmail("participant@example.com", "short"), null);
});

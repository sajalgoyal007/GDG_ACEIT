import test from "node:test";
import assert from "node:assert/strict";
import { getAuthLinkErrorKind, getAuthLinkErrorMessage } from "./auth-link-error.ts";

test("expired auth codes receive a fresh-link message", () => {
  assert.equal(getAuthLinkErrorKind("otp_expired"), "expired");
  assert.equal(getAuthLinkErrorKind("TOKEN_EXPIRED"), "expired");
  assert.match(getAuthLinkErrorMessage("expired"), /Request a fresh link/);
});

test("unknown and reused-link errors are handled without exposing raw values", () => {
  const rawError = "access_denied: private-token-fragment";
  const kind = getAuthLinkErrorKind(rawError);
  const message = getAuthLinkErrorMessage(kind);
  assert.equal(kind, "invalid");
  assert.match(message, /invalid or has already been used/);
  assert.doesNotMatch(message, /private-token-fragment|access_denied/);
});

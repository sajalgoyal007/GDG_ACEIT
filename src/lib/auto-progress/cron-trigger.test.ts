import assert from "node:assert/strict";
import test from "node:test";
import { authorizeCronRequest, cronProviderGate, scheduledRefreshDedupeKey } from "./cron-trigger.ts";

test("Cron authorization rejects missing, malformed, and incorrect secrets", () => {
  assert.equal(authorizeCronRequest("Bearer correct-secret-value", undefined), "unconfigured");
  assert.equal(authorizeCronRequest(null, "correct-secret-value"), "unauthorized");
  assert.equal(authorizeCronRequest("Basic correct-secret-value", "correct-secret-value"), "unauthorized");
  assert.equal(authorizeCronRequest("Bearer wrong-secret-value", "correct-secret-value"), "unauthorized");
});

test("Cron authorization accepts only a configured bearer secret", () => {
  assert.equal(authorizeCronRequest("Bearer correct-secret-value", "correct-secret-value"), "authorized");
  assert.equal(authorizeCronRequest("bearer correct-secret-value", "correct-secret-value"), "authorized");
  assert.equal(authorizeCronRequest("Bearer short", "short"), "unconfigured");
  assert.equal(authorizeCronRequest(`Bearer ${"x".repeat(1025)}`, "x".repeat(1025)), "unauthorized");
});

test("scheduled invocations share one dedupe key within a UTC six-hour window", () => {
  const first = Date.parse("2026-11-01T12:00:00.000Z");
  assert.equal(scheduledRefreshDedupeKey(first), "scheduled:2026-11-01T12:00:00.000Z");
  assert.equal(scheduledRefreshDedupeKey(first + 5 * 60 * 60 * 1000), "scheduled:2026-11-01T12:00:00.000Z");
  assert.equal(scheduledRefreshDedupeKey(first + 6 * 60 * 60 * 1000), "scheduled:2026-11-01T18:00:00.000Z");
});

test("disabled feature or unavailable provider gates scheduled work before job creation", () => {
  assert.equal(cronProviderGate(false, true), "disabled");
  assert.equal(cronProviderGate(true, false), "provider_unavailable");
  assert.equal(cronProviderGate(true, true), "ready");
});

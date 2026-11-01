import assert from "node:assert/strict";
import test from "node:test";
import { validateAutoProgressProviderResult, type CompleteAutoProgressSnapshot } from "./provider.ts";

const profileUrl = "https://skills.google/public_profiles/provider-fixture";

function snapshot(overrides: Partial<CompleteAutoProgressSnapshot> = {}): CompleteAutoProgressSnapshot {
  return {
    status: "complete",
    normalizedProfileUrl: profileUrl,
    retrievedAt: "2026-11-01T10:00:00.000Z",
    source: "approved-provider-fixture",
    badges: [{ id: "badge-1", title: "Cloud Basics", category: "skill", eligible: true }],
    pagination: { pagesFetched: 1, hasMore: false, truncated: false },
    ...overrides,
  };
}

test("accepts an explicit complete zero-badge snapshot", () => {
  const result = validateAutoProgressProviderResult(snapshot({ badges: [] }), profileUrl);
  assert.equal(result.status, "complete");
  if (result.status === "complete") assert.deepEqual(result.badges, []);
});

test("rejects missing badge arrays and malformed snapshot metadata", () => {
  const missingBadges = { ...snapshot(), badges: undefined } as unknown;
  assert.deepEqual(validateAutoProgressProviderResult(missingBadges, profileUrl), { status: "malformed" });
  assert.deepEqual(validateAutoProgressProviderResult({ ...snapshot(), retrievedAt: "unknown" }, profileUrl), { status: "malformed" });
  assert.deepEqual(validateAutoProgressProviderResult({ ...snapshot(), source: "" }, profileUrl), { status: "malformed" });
});

test("rejects partial or truncated pagination instead of accepting a snapshot", () => {
  assert.deepEqual(validateAutoProgressProviderResult({
    ...snapshot(), pagination: { pagesFetched: 1, hasMore: true, truncated: false },
  }, profileUrl), { status: "incomplete" });
  assert.deepEqual(validateAutoProgressProviderResult({
    ...snapshot(), pagination: { pagesFetched: 2, hasMore: false, truncated: true },
  }, profileUrl), { status: "incomplete" });
});

test("rejects duplicate stable badge identities and profile mismatches", () => {
  const duplicate = snapshot({ badges: [
    { id: "badge-1", title: "Cloud Basics", category: "skill", eligible: true },
    { id: "badge-1", title: "Duplicate", category: "skill", eligible: true },
  ] });
  assert.deepEqual(validateAutoProgressProviderResult(duplicate, profileUrl), { status: "malformed" });
  assert.deepEqual(validateAutoProgressProviderResult(snapshot(), "https://skills.google/public_profiles/other"), { status: "profile_mismatch" });
});

test("preserves typed provider errors without treating them as empty snapshots", () => {
  assert.deepEqual(validateAutoProgressProviderResult({ status: "rate_limited", retryAfter: "30" }, profileUrl), {
    status: "rate_limited", retryAfter: "30",
  });
  assert.deepEqual(validateAutoProgressProviderResult({ status: "ok", badges: [] }, profileUrl), { status: "malformed" });
});

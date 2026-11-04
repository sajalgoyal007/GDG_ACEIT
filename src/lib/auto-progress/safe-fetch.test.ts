import assert from "node:assert/strict";
import test from "node:test";
import { fetchPublicProfileHtml } from "./safe-fetch.ts";

const profile = "https://skills.google/public_profiles/fixture";
const html = (value: string) => new Response(value, { status: 200, headers: { "content-type": "text/html" } });

function withFlag(value: string | undefined, operation: () => Promise<void>) {
  const previous = process.env.AUTO_PROGRESS_ENABLED;
  const previousAuthorization = process.env.GOOGLE_SKILLS_PROFILE_FETCH_AUTHORIZED;
  if (value === undefined) delete process.env.AUTO_PROGRESS_ENABLED;
  else process.env.AUTO_PROGRESS_ENABLED = value;
  process.env.GOOGLE_SKILLS_PROFILE_FETCH_AUTHORIZED = "true";
  return operation().finally(() => {
    if (previous === undefined) delete process.env.AUTO_PROGRESS_ENABLED;
    else process.env.AUTO_PROGRESS_ENABLED = previous;
    if (previousAuthorization === undefined) delete process.env.GOOGLE_SKILLS_PROFILE_FETCH_AUTHORIZED;
    else process.env.GOOGLE_SKILLS_PROFILE_FETCH_AUTHORIZED = previousAuthorization;
  });
}

test("does not call fetch while the mandatory environment feature flag is unset", async () => withFlag(undefined, async () => {
  let calls = 0;
  const result = await fetchPublicProfileHtml(profile, { fetchImpl: async () => { calls += 1; return html("x"); } });
  assert.deepEqual(result, { status: "disabled" });
  assert.equal(calls, 0);
}));

test("rejects redirects to arbitrary hosts and a different profile", async () => withFlag("true", async () => {
  const unsafe = await fetchPublicProfileHtml(profile, { fetchImpl: async () => new Response(null, { status: 302, headers: { location: "https://example.com/" } }) });
  const otherProfile = await fetchPublicProfileHtml(profile, { fetchImpl: async () => new Response(null, { status: 302, headers: { location: "https://skills.google/public_profiles/other" } }) });
  assert.deepEqual(unsafe, { status: "unsafe_redirect" });
  assert.deepEqual(otherProfile, { status: "unsafe_redirect" });
}));

test("allows a same-profile canonical redirect and enforces the response byte limit", async () => withFlag("true", async () => {
  let calls = 0;
  const redirected = await fetchPublicProfileHtml(profile, {
    fetchImpl: async () => ++calls === 1
      ? new Response(null, { status: 301, headers: { location: "https://www.skills.google/public_profiles/fixture" } })
      : html("fixture"),
  });
  assert.equal(redirected.status, "ok");
  if (redirected.status === "ok") assert.equal(redirected.html, "fixture");

  const tooLarge = await fetchPublicProfileHtml(profile, { maxBytes: 3, fetchImpl: async () => html("large") });
  assert.deepEqual(tooLarge, { status: "too_large" });

  const cannotRaiseHardLimit = await fetchPublicProfileHtml(profile, {
    maxBytes: Number.POSITIVE_INFINITY,
    fetchImpl: async () => html("x".repeat(1_000_001)),
  });
  assert.deepEqual(cannotRaiseHardLimit, { status: "too_large" });
}));

test("returns private, blocked, missing, throttled, and unavailable responses as failures, never as zero", async () => withFlag("true", async () => {
  for (const [code, status] of [[401, "private"], [403, "blocked"], [404, "not_found"], [429, "rate_limited"], [503, "upstream_error"]] as const) {
    const result = await fetchPublicProfileHtml(profile, { fetchImpl: async () => new Response(null, { status: code }) });
    assert.equal(result.status, status);
  }
}));

test("enforces the request timeout", async () => withFlag("true", async () => {
  const result = await fetchPublicProfileHtml(profile, {
    timeoutMs: 5,
    fetchImpl: (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  });
  assert.deepEqual(result, { status: "timeout" });
}));

import assert from "node:assert/strict";
import test from "node:test";
import { inspectGoogleSkillsPublicProfile } from "./public-profile-observer.ts";

const profileUrl = "https://www.skills.google/public_profiles/observer-fixture";
const html = `<!doctype html><html><head><link rel="canonical" href="${profileUrl}" /></head><body><div class="profile-badges"><div class="profile-badge"><a class="badge-image" href="${profileUrl}"><img src="https://cdn.qwiklabs.com/test-image" /></a><span class="ql-title-medium">Observed Badge</span><span class="ql-body-medium">Earned Oct 31, 2026 EDT</span></div></div></body></html>`;
const response = (status: number, body = html, headers: Record<string, string> = { "content-type": "text/html; charset=utf-8" }) => new Response(body, { status, headers });

async function withEnabledFeature<T>(run: () => Promise<T>): Promise<T> {
  const before = process.env.AUTO_PROGRESS_ENABLED;
  const beforeAuthorization = process.env.GOOGLE_SKILLS_PROFILE_FETCH_AUTHORIZED;
  process.env.AUTO_PROGRESS_ENABLED = "true";
  process.env.GOOGLE_SKILLS_PROFILE_FETCH_AUTHORIZED = "true";
  try { return await run(); }
  finally {
    if (before === undefined) delete process.env.AUTO_PROGRESS_ENABLED;
    else process.env.AUTO_PROGRESS_ENABLED = before;
    if (beforeAuthorization === undefined) delete process.env.GOOGLE_SKILLS_PROFILE_FETCH_AUTHORIZED;
    else process.env.GOOGLE_SKILLS_PROFILE_FETCH_AUTHORIZED = beforeAuthorization;
  }
}

test("safe public HTML observer returns extracted fields as incomplete diagnostic data only", async () => withEnabledFeature(async () => {
  let requests = 0;
  const result = await inspectGoogleSkillsPublicProfile(profileUrl, {
    fetchImpl: async () => { requests += 1; return response(200); },
  });
  assert.equal(requests, 1);
  assert.equal(result.status, "incomplete");
  if (result.status !== "incomplete") return;
  assert.equal(result.observation.identityStatus, "matched");
  assert.equal(result.observation.badgeCandidates, 1);
  assert.equal(result.observation.entries[0]?.earnedOn, "2026-10-31");
  assert.equal(result.observation.entries[0]?.stableId, null);
}));

test("disabled feature exits before any outbound request", async () => {
  const before = process.env.AUTO_PROGRESS_ENABLED;
  delete process.env.AUTO_PROGRESS_ENABLED;
  let requests = 0;
  try {
    const result = await inspectGoogleSkillsPublicProfile(profileUrl, {
      fetchImpl: async () => { requests += 1; return response(200); },
    });
    assert.deepEqual(result, { status: "disabled" });
    assert.equal(requests, 0);
  } finally {
    if (before !== undefined) process.env.AUTO_PROGRESS_ENABLED = before;
  }
});

test("blocked, throttled, and upstream errors remain failures, not empty profiles", async () => withEnabledFeature(async () => {
  for (const [status, expected] of [[403, "blocked"], [429, "rate_limited"], [503, "upstream_error"]] as const) {
    const result = await inspectGoogleSkillsPublicProfile(profileUrl, { fetchImpl: async () => response(status, "") });
    assert.equal(result.status, expected);
  }
}));

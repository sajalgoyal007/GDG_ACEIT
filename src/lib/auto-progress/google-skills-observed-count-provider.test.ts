import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildUnverifiedObservationRpcArgs, buildVerifiedZeroRpcArgs, fetchGoogleSkillsObservedBadgeCount } from "./google-skills-observed-count-provider.ts";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const samples = [
  { name: "synthetic-profile-small.html", url: "https://www.skills.google/public_profiles/11111111-1111-4111-8111-111111111111", count: 2 },
  { name: "synthetic-profile-medium.html", url: "https://www.skills.google/public_profiles/22222222-2222-4222-8222-222222222222", count: 4 },
  { name: "synthetic-profile-ten.html", url: "https://www.skills.google/public_profiles/33333333-3333-4333-8333-333333333333", count: 10 },
];
const htmlResponse = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });

async function withEnabled<T>(fn: () => Promise<T>): Promise<T> {
  const before = process.env.AUTO_PROGRESS_ENABLED;
  const beforeAuthorization = process.env.GOOGLE_SKILLS_PROFILE_FETCH_AUTHORIZED;
  process.env.AUTO_PROGRESS_ENABLED = "true";
  process.env.GOOGLE_SKILLS_PROFILE_FETCH_AUTHORIZED = "true";
  try { return await fn(); }
  finally {
    if (before === undefined) delete process.env.AUTO_PROGRESS_ENABLED;
    else process.env.AUTO_PROGRESS_ENABLED = before;
    if (beforeAuthorization === undefined) delete process.env.GOOGLE_SKILLS_PROFILE_FETCH_AUTHORIZED;
    else process.env.GOOGLE_SKILLS_PROFILE_FETCH_AUTHORIZED = beforeAuthorization;
  }
}

test("count-only provider returns synthetic fixture candidates as explicitly unverified for all three identities", async () => withEnabled(async () => {
  for (const sample of samples) {
    const html = await readFile(join(fixtures, sample.name), "utf8");
    const result = await fetchGoogleSkillsObservedBadgeCount(sample.url, { fetchImpl: async () => htmlResponse(html) });
    assert.equal(result.status, "unverified", sample.name);
    if (result.status === "unverified") {
      assert.equal(result.candidateCount, sample.count, sample.name);
      assert.equal(result.detailCount, sample.count, sample.name);
      assert.equal(result.httpStatus, 200);
      assert.equal(result.normalizedProfileUrl, sample.url.replace("www.", ""));
    }
  }
}));

test("invalid URL and canonical identity mismatch are rejected before returning a count", async () => withEnabled(async () => {
  let requests = 0;
  const invalid = await fetchGoogleSkillsObservedBadgeCount("https://example.com/public_profiles/id", { fetchImpl: async () => { requests += 1; return htmlResponse(""); } });
  assert.deepEqual(invalid, { status: "invalid_url" });
  assert.equal(requests, 0);

  const body = await readFile(join(fixtures, samples[0].name), "utf8");
  const mismatch = body.replace(samples[0].url, "https://www.skills.google/public_profiles/someone-else");
  const result = await fetchGoogleSkillsObservedBadgeCount(samples[0].url, { fetchImpl: async () => htmlResponse(mismatch) });
  assert.deepEqual(result, { status: "identity_mismatch" });
}));

test("HTTP failures, unverified identity, malformed pages, and empty containers never become verified zero", async () => withEnabled(async () => {
  for (const [status, expected] of [[403, "blocked"], [429, "rate_limited"], [503, "upstream_error"]] as const) {
    const result = await fetchGoogleSkillsObservedBadgeCount(samples[0].url, { fetchImpl: async () => htmlResponse("", status) });
    assert.equal(result.status, expected);
  }
  const missing = await fetchGoogleSkillsObservedBadgeCount(samples[0].url, { fetchImpl: async () => htmlResponse("<html><body>Profile</body></html>") });
  assert.deepEqual(missing, { status: "identity_unverified" });
  const missingContainer = `<html><head><link rel="canonical" href="${samples[0].url}"></head><body>Profile</body></html>`;
  const missingContainerResult = await fetchGoogleSkillsObservedBadgeCount(samples[0].url, { fetchImpl: async () => htmlResponse(missingContainer) });
  assert.deepEqual(missingContainerResult, { status: "confirmed_zero" });
  assert.equal(buildUnverifiedObservationRpcArgs(missingContainerResult, "test:participant", samples[0].url), null);
  const zeroArgs = buildVerifiedZeroRpcArgs(missingContainerResult, "00000000-0000-4000-8000-000000000001");
  assert.equal(zeroArgs?.p_badge_count, 0);
  assert.match(zeroArgs?.p_note ?? "", /HTTP 200.*matching canonical profile identity.*no badge container/i);
  assert.equal(buildVerifiedZeroRpcArgs(missingContainerResult, "not-a-uuid"), null);
  const malformed = await fetchGoogleSkillsObservedBadgeCount(samples[0].url, { fetchImpl: async () => htmlResponse("Not HTML") });
  assert.deepEqual(malformed, { status: "identity_unverified" });

  const profile = samples[0].url;
  const empty = `<html><head><link rel="canonical" href="${profile}"></head><body><div class="profile-badges"></div></body></html>`;
  const emptyResult = await fetchGoogleSkillsObservedBadgeCount(profile, { fetchImpl: async () => htmlResponse(empty) });
  assert.deepEqual(emptyResult, { status: "empty_unconfirmed" });
}));

test("owner-policy verified zero requires HTTP 200, matched identity, complete document, and no recognized page markers", async () => withEnabled(async () => {
  const profile = samples[0].url;
  const page = (body: string) => `<html><head><link rel="canonical" href="${profile}"></head><body>${body}</body></html>`;
  const safeMissing = page("<main>Profile content</main>");
  assert.deepEqual(await fetchGoogleSkillsObservedBadgeCount(profile, { fetchImpl: async () => htmlResponse(safeMissing) }), {
    status: "confirmed_zero",
  });
  assert.deepEqual(await fetchGoogleSkillsObservedBadgeCount(profile, { fetchImpl: async () => htmlResponse(safeMissing, 201) }), {
    status: "profile_response_incomplete",
  });
  for (const body of [
    '<div class="profile-loading" role="status">Loading profile</div>',
    '<div id="cf-challenge">Checking your browser</div>',
    '<div class="access-denied">Access denied</div>',
  ]) {
    const result = await fetchGoogleSkillsObservedBadgeCount(profile, { fetchImpl: async () => htmlResponse(page(body)) });
    assert.equal(result.status, "profile_response_incomplete", body);
  }
  const truncated = `<html><head><link rel="canonical" href="${profile}"></head><body>Profile`;
  assert.deepEqual(await fetchGoogleSkillsObservedBadgeCount(profile, { fetchImpl: async () => htmlResponse(truncated) }), {
    status: "profile_response_incomplete",
  });
}));

test("parser failures preserve safe structure-specific reasons without producing a count", async () => withEnabled(async () => {
  const profile = samples[0].url;
  const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
  const identified = async (name: string) => {
    const body = await readFile(join(fixtures, name), "utf8");
    return body.replace(/<html([^>]*)>/i, `<html$1><head><link rel="canonical" href="${profile}"></head>`);
  };

  for (const [fixture, expected] of [
    ["observed-no-container.html", "confirmed_zero"],
    ["observed-unexpected.html", "confirmed_zero"],
  ] as const) {
    const result = await fetchGoogleSkillsObservedBadgeCount(profile, {
      fetchImpl: async () => htmlResponse(await identified(fixture)),
    });
    assert.deepEqual(result, { status: expected }, fixture);
  }

  const ambiguous = await fetchGoogleSkillsObservedBadgeCount(profile, {
    fetchImpl: async () => htmlResponse(`<html><head><link rel="canonical" href="${profile}"></head><body><div class="profile-badges"></div><div class="profile-badges"></div></body></html>`),
  });
  assert.deepEqual(ambiguous, { status: "profile_structure_ambiguous" });

  const multipleCards = await fetchGoogleSkillsObservedBadgeCount(profile, {
    fetchImpl: async () => htmlResponse(`<html><head><link rel="canonical" href="${profile}"></head><body><div class="profile-badges"><div class="profile-badge"><span class="ql-title-medium">One</span></div><div class="profile-badge"><span class="ql-title-medium">Two</span></div></div></body></html>`),
  });
  assert.equal(multipleCards.status, "unverified");
  if (multipleCards.status === "unverified") {
    assert.equal(multipleCards.candidateCount, 2);
    assert.equal(buildVerifiedZeroRpcArgs(multipleCards, "00000000-0000-4000-8000-000000000001"), null);
  }
}));

test("production provider withholds counts for duplicate, nested, hidden, and truncated cards", async () => withEnabled(async () => {
  const profile = samples[0].url;
  const page = (cards: string) => `<html><head><link rel="canonical" href="${profile}"></head><body><div class="profile-badges">${cards}</div></body></html>`;
  const duplicate = `<div class="profile-badge"><span class="ql-title-medium">Same</span><span class="ql-body-medium">Earned Oct 31, 2026 EDT</span></div><div class="profile-badge"><span class="ql-title-medium">Same</span><span class="ql-body-medium">Earned Oct 31, 2026 EDT</span></div>`;
  const nested = `<div class="profile-badge"><span class="ql-title-medium">Outer</span><div class="profile-badge"><span class="ql-title-medium">Inner</span></div></div>`;
  const hidden = `<div hidden class="profile-badge"><span class="ql-title-medium">Hidden</span></div>`;
  const truncated = `<div class="profile-badge"><span class="ql-title-medium">Partial`;
  const cases = [
    [page(duplicate), "ambiguous_card_structure"],
    [page(nested), "ambiguous_card_structure"],
    [page(hidden), "explicit_hidden_markup"],
    [page(truncated) + "</body></html>", "incomplete_relevant_markup"],
  ] as const;
  for (const [body, expected] of cases) {
    const result = await fetchGoogleSkillsObservedBadgeCount(profile, { fetchImpl: async () => htmlResponse(body) });
    assert.deepEqual(result, { status: expected });
  }
}));

test("the single-profile persistence payload accepts only unverified candidate results", async () => withEnabled(async () => {
  const profile = samples[2].url;
  const html = await readFile(join(fixtures, samples[2].name), "utf8");
  const observed = await fetchGoogleSkillsObservedBadgeCount(profile, { fetchImpl: async () => htmlResponse(html) });
  assert.equal(observed.status, "unverified");
  if (observed.status !== "unverified") return;
  const payload = buildUnverifiedObservationRpcArgs(observed, "participant.test", profile);
  assert.ok(payload);
  assert.equal(payload.p_completeness_status, "unverified");
  assert.equal(payload.p_reported_total, 10);
  assert.equal(payload.p_detail_count, 10);
  assert.equal(payload.p_unique_badge_count, null);
  assert.match(payload.p_summary_note, /not a confirmed total/i);

  for (const status of [
    "ambiguous_card_structure", "explicit_hidden_markup", "incomplete_relevant_markup",
    "confirmed_zero", "profile_structure_ambiguous", "empty_unconfirmed", "identity_unverified",
  ] as const) {
    assert.equal(buildUnverifiedObservationRpcArgs({ status }, "participant.test", profile), null, status);
  }
}));

test("provider is disabled by default and does not make a request", async () => {
  const before = process.env.AUTO_PROGRESS_ENABLED;
  delete process.env.AUTO_PROGRESS_ENABLED;
  let requests = 0;
  try {
    const result = await fetchGoogleSkillsObservedBadgeCount(samples[0].url, { fetchImpl: async () => { requests += 1; return htmlResponse(""); } });
    assert.deepEqual(result, { status: "disabled" });
    assert.equal(requests, 0);
  } finally {
    if (before !== undefined) process.env.AUTO_PROGRESS_ENABLED = before;
  }
});

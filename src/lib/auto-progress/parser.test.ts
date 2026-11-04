import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { inspectObservedGoogleProfileHtml, parseObservedGoogleSkillsProfileHtml, parseProfileFixture } from "./parser.ts";

const fixtureDirectory = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name: string) => readFile(join(fixtureDirectory, name), "utf8");

test("parses only eligible earned fixture badges and deduplicates stable IDs", async () => {
  const result = parseProfileFixture(await fixture("complete.html"));
  assert.equal(result.status, "complete");
  if (result.status === "complete") {
    assert.equal(result.eligibleBadgeCount, 1);
    assert.deepEqual(result.badges.map((badge) => badge.key), ["cloud-basics"]);
  }
});

test("distinguishes a complete zero-badge result from an incomplete page", async () => {
  const zero = parseProfileFixture(await fixture("zero.html"));
  assert.deepEqual(zero, { status: "complete", badges: [], eligibleBadgeCount: 0 });
  assert.deepEqual(parseProfileFixture(await fixture("incomplete.html")), {
    status: "incomplete",
    reason: "completion_marker_missing",
  });
});

test("rejects malformed marked badge entries rather than silently counting zero", () => {
  assert.deepEqual(parseProfileFixture('<main data-auto-progress-complete="true"><article data-auto-badge></article></main>'), {
    status: "incomplete",
    reason: "malformed_badge_marker",
  });
});

test("rejects truncated markup even when a premature completion marker is present", () => {
  const result = parseProfileFixture('<main data-auto-progress-complete="true"><article data-auto-badge data-badge-id="unfinished" data-earned="true" data-eligible="true">');
  assert.deepEqual(result, { status: "incomplete", reason: "completion_marker_missing" });
});

test("observed profile markers produce diagnostic candidates, never a verified count", async () => {
  const html = await fixture("observed-multiple.html");
  assert.deepEqual(inspectObservedGoogleProfileHtml(html), {
    status: "incomplete",
    reason: "completeness_unverified",
    badgeCandidates: 2,
    badgeImageMarkers: 2,
  });
});

test("duplicate-looking entries remain ambiguous and are not deduplicated into a verified count", async () => {
  assert.deepEqual(inspectObservedGoogleProfileHtml(await fixture("observed-duplicates.html")), {
    status: "incomplete",
    reason: "completeness_unverified",
    badgeCandidates: 2,
    badgeImageMarkers: 2,
  });
});

test("missing title or earned date details cannot turn badge candidates into a verified count", async () => {
  assert.deepEqual(inspectObservedGoogleProfileHtml(await fixture("observed-missing-details.html")), {
    status: "incomplete",
    reason: "completeness_unverified",
    badgeCandidates: 1,
    badgeImageMarkers: 1,
  });
});

test("empty and missing badge containers are not reported as a confirmed zero", async () => {
  assert.deepEqual(inspectObservedGoogleProfileHtml(await fixture("observed-empty.html")), {
    status: "incomplete",
    reason: "empty_unconfirmed",
    badgeCandidates: 0,
    badgeImageMarkers: 0,
  });
  assert.deepEqual(inspectObservedGoogleProfileHtml(await fixture("observed-no-container.html")), {
    status: "incomplete",
    reason: "badge_container_missing",
    badgeCandidates: 0,
    badgeImageMarkers: 0,
  });
});

test("unexpected and partial marker structures fail closed", async () => {
  assert.equal(inspectObservedGoogleProfileHtml(await fixture("observed-unexpected.html")).reason, "badge_container_missing");
  assert.deepEqual(inspectObservedGoogleProfileHtml('<div class="profile-badges"><div class="profile-badge"></div></div>'), {
    status: "incomplete",
    reason: "badge_marker_mismatch",
    badgeCandidates: 1,
    badgeImageMarkers: 0,
  });
  assert.equal(inspectObservedGoogleProfileHtml('<div class="profile-badges"><div class="profile-badge">').reason, "unexpected_html");
});

test("missing-container candidates require a complete page with matched identity and no access or loading markers", () => {
  const page = (body: string) => `<!doctype html><html><head><link rel="canonical" href="${observedProfileUrl}"></head><body>${body}</body></html>`;
  const eligible = parseObservedGoogleSkillsProfileHtml(page("<main>Profile content</main>"), observedProfileUrl);
  assert.equal(eligible.reason, "badge_container_missing");
  assert.equal(eligible.identityStatus, "matched");
  assert.deepEqual(eligible.qualityWarnings, []);

  for (const [body, warning] of [
    ['<div class="profile-loading" role="status">Loading profile</div>', "loading_indicator"],
    ['<div id="cf-challenge">Checking your browser</div>', "challenge_indicator"],
    ['<div class="access-denied">Access denied</div>', "access_denied_indicator"],
  ] as const) {
    const parsed = parseObservedGoogleSkillsProfileHtml(page(body), observedProfileUrl);
    assert.equal(parsed.reason, warning);
    assert.equal(parsed.identityStatus, "matched");
  }

  const incomplete = parseObservedGoogleSkillsProfileHtml(
    `<!doctype html><html><head><link rel="canonical" href="${observedProfileUrl}"></head><body>Profile`,
    observedProfileUrl,
  );
  assert.equal(incomplete.reason, "incomplete_document_markup");
});

const observedProfileUrl = "https://www.skills.google/public_profiles/profile-001";
const observedBadge = (title: string, earned = "Earned Oct 31, 2026 EDT") => `<div class="profile-badge"><a class="badge-image" href="${observedProfileUrl}"><img role="presentation" src="https://cdn.qwiklabs.com/asset-hash" /></a><span class="ql-title-medium">${title}</span><span class="ql-body-medium">${earned}</span><ql-button label="More" /></div>`;
const observedPage = (contents: string, canonical = observedProfileUrl) => `<!doctype html><html><head><link rel="canonical" href="${canonical}" /></head><body><div class="profile-badges">${contents}</div></body></html>`;

test("extracts observed title, image, and earned date without inventing badge identity or completeness", () => {
  const parsed = parseObservedGoogleSkillsProfileHtml(observedPage(observedBadge("Cloud Foundations")), observedProfileUrl);
  assert.equal(parsed.status, "incomplete");
  assert.equal(parsed.reason, "completeness_unverified");
  assert.equal(parsed.identityStatus, "matched");
  assert.equal(parsed.badgeCandidates, 1);
  assert.equal(parsed.visibleBadgeCandidates, 1);
  assert.equal(parsed.hiddenBadgeCandidates, 0);
  assert.deepEqual(parsed.qualityWarnings, []);
  assert.deepEqual(parsed.entries[0], {
    title: "Cloud Foundations",
    canonicalBadgeUrl: null,
    imageUrl: "https://cdn.qwiklabs.com/asset-hash",
    earnedOn: "2026-10-31",
    earnedTimezoneLabel: "EDT",
    explicitlyHidden: false,
    stableId: null,
  });
});

test("preserves duplicate titles and classifies them as ambiguous without deduplicating", () => {
  const parsed = parseObservedGoogleSkillsProfileHtml(observedPage(`${observedBadge("Repeated Badge", "Earned Oct 30, 2026 EDT")}${observedBadge("Repeated Badge")}`), observedProfileUrl);
  assert.equal(parsed.entries.length, 2);
  assert.equal(parsed.badgeCandidates, 2);
  assert.equal(parsed.duplicateTitleGroups, 1);
  assert.deepEqual(parsed.qualityWarnings, ["ambiguous_card_structure"]);
  assert.equal(parsed.reason, "ambiguous_card_structure");
  assert.deepEqual(parsed.entries.map((entry) => entry.stableId), [null, null]);
});

test("identical-looking cards are retained as candidates and marked ambiguous", () => {
  const card = observedBadge("Same Badge");
  const parsed = parseObservedGoogleSkillsProfileHtml(observedPage(`${card}${card}`), observedProfileUrl);
  assert.equal(parsed.badgeCandidates, 2);
  assert.equal(parsed.entries.length, 2);
  assert.equal(parsed.duplicateLookingGroups, 1);
  assert.deepEqual(parsed.qualityWarnings, ["ambiguous_card_structure"]);
});

test("cards outside the one recognized badge container are ignored", () => {
  const parsed = parseObservedGoogleSkillsProfileHtml(
    `<!doctype html><html><head><link rel="canonical" href="${observedProfileUrl}" /></head><body>${observedBadge("Outside")}<div class="profile-badges">${observedBadge("Inside")}</div></body></html>`,
    observedProfileUrl,
  );
  assert.equal(parsed.identityStatus, "matched");
  assert.equal(parsed.badgeCandidates, 1);
  assert.equal(parsed.entries[0]?.title, "Inside");
});

test("nested badge-card markup is retained but classified as ambiguous", () => {
  const nested = `<div class="profile-badge"><span class="ql-title-medium">Outer</span><div class="profile-badge"><span class="ql-title-medium">Inner</span></div></div>`;
  const parsed = parseObservedGoogleSkillsProfileHtml(observedPage(nested), observedProfileUrl);
  assert.equal(parsed.badgeCandidates, 2);
  assert.equal(parsed.entries.length, 2);
  assert.ok(parsed.qualityWarnings.includes("ambiguous_card_structure"));
});

test("explicit hidden and aria-hidden markup is reported without treating CSS classes as visibility", () => {
  const hidden = `<div hidden class="profile-badge"><span class="ql-title-medium">Hidden attribute</span></div>`;
  const ariaHidden = `<div aria-hidden="TRUE" class="profile-badge"><span class="ql-title-medium">Hidden aria</span></div>`;
  const cssOnly = observedBadge("CSS only", "Earned Nov 1, 2026 EDT").replace('class="profile-badge"', 'class="profile-badge visually-hidden"');
  const parsed = parseObservedGoogleSkillsProfileHtml(observedPage(`${hidden}${ariaHidden}${cssOnly}`), observedProfileUrl);
  assert.equal(parsed.badgeCandidates, 3);
  assert.equal(parsed.hiddenBadgeCandidates, 2);
  assert.equal(parsed.visibleBadgeCandidates, 1);
  assert.equal(parsed.entries[0]?.explicitlyHidden, true);
  assert.ok(parsed.qualityWarnings.includes("explicit_hidden_markup"));

  const hiddenAncestor = `<section aria-hidden="true"><div class="profile-badges">${observedBadge("Inherited hidden")}</div></section>`;
  const inherited = parseObservedGoogleSkillsProfileHtml(
    `<!doctype html><html><head><link rel="canonical" href="${observedProfileUrl}" /></head><body>${hiddenAncestor}</body></html>`,
    observedProfileUrl,
  );
  assert.equal(inherited.hiddenBadgeCandidates, 1);
  assert.equal(inherited.visibleBadgeCandidates, 0);
  assert.ok(inherited.qualityWarnings.includes("explicit_hidden_markup"));
});

test("missing earned dates remain null and do not convert a candidate list into a complete result", () => {
  const parsed = parseObservedGoogleSkillsProfileHtml(observedPage(observedBadge("No Date", "Badge awarded")), observedProfileUrl);
  assert.equal(parsed.status, "incomplete");
  assert.equal(parsed.entries[0]?.earnedOn, null);
  assert.equal(parsed.entries[0]?.earnedTimezoneLabel, null);
});

test("empty, missing, malformed, error, and identity-mismatched pages never become zero or complete", () => {
  const empty = parseObservedGoogleSkillsProfileHtml(observedPage(""), observedProfileUrl);
  assert.deepEqual([empty.status, empty.reason, empty.badgeCandidates], ["incomplete", "empty_unconfirmed", 0]);
  const missing = parseObservedGoogleSkillsProfileHtml("<html><body><h1>Profile</h1></body></html>", observedProfileUrl);
  assert.equal(missing.reason, "badge_container_missing");
  assert.equal(missing.identityStatus, "unverified");
  const malformed = parseObservedGoogleSkillsProfileHtml("Service unavailable", observedProfileUrl);
  assert.equal(malformed.reason, "unexpected_html");
  const mismatch = parseObservedGoogleSkillsProfileHtml(observedPage(observedBadge("Wrong Profile"), "https://www.skills.google/public_profiles/other-profile"), observedProfileUrl);
  assert.equal(mismatch.reason, "identity_mismatch");
  assert.equal(mismatch.badgeCandidates, 0);
  assert.deepEqual(parseObservedGoogleSkillsProfileHtml(observedPage(observedBadge("Unknown Identity"), ""), observedProfileUrl).identityStatus, "unverified");
});

test("canonical identity must be exactly one valid matching link", () => {
  const valid = `<link rel="canonical" href="https://example.com/profile" />`;
  const duplicate = `<link rel="canonical" href="${observedProfileUrl}" /><link rel="canonical" href="${observedProfileUrl}" />`;
  const duplicatedCanonical = `<!doctype html><html><head>${duplicate}</head><body><div class="profile-badges">${observedBadge("Badge")}</div></body></html>`;
  const invalidCanonical = `<!doctype html><html><head>${valid}</head><body><div class="profile-badges">${observedBadge("Badge")}</div></body></html>`;
  assert.equal(parseObservedGoogleSkillsProfileHtml(duplicatedCanonical, observedProfileUrl).identityStatus, "unverified");
  assert.equal(parseObservedGoogleSkillsProfileHtml(invalidCanonical, observedProfileUrl).identityStatus, "unverified");
  assert.equal(parseObservedGoogleSkillsProfileHtml(observedPage(observedBadge("Badge"), "https://www.skills.google/public_profiles/different"), observedProfileUrl).identityStatus, "mismatch");
  assert.equal(parseObservedGoogleSkillsProfileHtml(observedPage(observedBadge("Badge")), "https://example.com/profile").identityStatus, "unverified");
});

test("truncated relevant div markup is incomplete while valid optional list-item ends remain accepted", () => {
  const truncated = `<!doctype html><html><head><link rel="canonical" href="${observedProfileUrl}"></head><body><div class="profile-badges"><div class="profile-badge"><span class="ql-title-medium">Partial`;
  const parsedTruncated = parseObservedGoogleSkillsProfileHtml(truncated, observedProfileUrl);
  assert.equal(parsedTruncated.reason, "incomplete_relevant_markup");
  assert.ok(parsedTruncated.qualityWarnings.includes("incomplete_relevant_markup"));

  const optionalLiEnds = `<!doctype html><html><head><link rel="canonical" href="${observedProfileUrl}"></head><body><div class="profile-badges"><ul><li>${observedBadge("List one")}<li>${observedBadge("List two")}</ul></div></body></html>`;
  const parsedOptional = parseObservedGoogleSkillsProfileHtml(optionalLiEnds, observedProfileUrl);
  assert.equal(parsedOptional.reason, "completeness_unverified");
  assert.equal(parsedOptional.badgeCandidates, 2);
});

test("synthetic profile badge markup for all three profiles parses to identity-bound unverified candidates", async () => {
  const samples = [
    { file: "synthetic-profile-small.html", url: "https://www.skills.google/public_profiles/11111111-1111-4111-8111-111111111111", count: 2 },
    { file: "synthetic-profile-medium.html", url: "https://www.skills.google/public_profiles/22222222-2222-4222-8222-222222222222", count: 4 },
    { file: "synthetic-profile-ten.html", url: "https://www.skills.google/public_profiles/33333333-3333-4333-8333-333333333333", count: 10 },
  ];
  for (const sample of samples) {
    const parsed = parseObservedGoogleSkillsProfileHtml(await fixture(sample.file), sample.url);
    assert.equal(parsed.status, "incomplete", sample.file);
    assert.equal(parsed.identityStatus, "matched", sample.file);
    assert.equal(parsed.badgeCandidates, sample.count, sample.file);
    assert.equal(parsed.duplicateTitleGroups, 0, sample.file);
    assert.ok(parsed.entries.every((entry) => entry.title && entry.earnedOn && entry.imageUrl
      && !entry.explicitlyHidden && entry.stableId === null && entry.canonicalBadgeUrl === null), sample.file);
    assert.deepEqual(parsed.qualityWarnings, [], sample.file);
  }
});

const observedBadgeWithHref = (title: string, href: string, earned = "Earned Oct 31, 2026 EDT") =>
  `<div class="profile-badge"><a class="badge-image" href="${href}"><img role="presentation" src="https://cdn.qwiklabs.com/asset-hash" /></a><span class="ql-title-medium">${title}</span><span class="ql-body-medium">${earned}</span><ql-button label="More" /></div>`;

test("T14: preserves same-title badges with distinct stable IDs while tracking title group", () => {
  const card1 = observedBadgeWithHref("Cloud Architect", "/public_profiles/profile-001/badges/10001", "Earned Oct 1, 2026 EDT");
  const card2 = observedBadgeWithHref("Cloud Architect", "/public_profiles/profile-001/badges/10002", "Earned Oct 2, 2026 EDT");
  const parsed = parseObservedGoogleSkillsProfileHtml(observedPage(`${card1}${card2}`), observedProfileUrl);

  assert.equal(parsed.badgeCandidates, 2);
  assert.equal(parsed.entries.length, 2);
  assert.equal(parsed.entries[0]?.stableId, "10001");
  assert.equal(parsed.entries[0]?.canonicalBadgeUrl, "https://www.skills.google/public_profiles/profile-001/badges/10001");
  assert.equal(parsed.entries[1]?.stableId, "10002");
  assert.equal(parsed.entries[1]?.canonicalBadgeUrl, "https://www.skills.google/public_profiles/profile-001/badges/10002");
  assert.notEqual(parsed.entries[0]?.stableId, parsed.entries[1]?.stableId);
  assert.equal(parsed.duplicateTitleGroups, 1);
  assert.equal(parsed.duplicateLookingGroups, 0);
  assert.deepEqual(parsed.qualityWarnings, ["ambiguous_card_structure"]);
});

test("T15: extracts canonical badge URL from relative, skills.google, and cloudskillsboost.google URLs", () => {
  const rel = observedBadgeWithHref("Badge Rel", "/public_profiles/profile-001/badges/29286880");
  const absSkills = observedBadgeWithHref("Badge Skills", "https://skills.google/public_profiles/profile-001/badges/29286881");
  const absWwwSkills = observedBadgeWithHref("Badge WwwSkills", "https://www.skills.google/public_profiles/profile-001/badges/29286882");
  const absCs = observedBadgeWithHref("Badge CS", "https://cloudskillsboost.google/public_profiles/profile-001/badges/29286883");
  const absWwwCs = observedBadgeWithHref("Badge WwwCS", "https://www.cloudskillsboost.google/public_profiles/profile-001/badges/29286884");

  const parsed = parseObservedGoogleSkillsProfileHtml(
    observedPage(`${rel}${absSkills}${absWwwSkills}${absCs}${absWwwCs}`),
    observedProfileUrl,
  );

  assert.equal(parsed.badgeCandidates, 5);
  assert.equal(parsed.entries[0]?.canonicalBadgeUrl, "https://www.skills.google/public_profiles/profile-001/badges/29286880");
  assert.equal(parsed.entries[1]?.canonicalBadgeUrl, "https://www.skills.google/public_profiles/profile-001/badges/29286881");
  assert.equal(parsed.entries[2]?.canonicalBadgeUrl, "https://www.skills.google/public_profiles/profile-001/badges/29286882");
  assert.equal(parsed.entries[3]?.canonicalBadgeUrl, "https://www.skills.google/public_profiles/profile-001/badges/29286883");
  assert.equal(parsed.entries[4]?.canonicalBadgeUrl, "https://www.skills.google/public_profiles/profile-001/badges/29286884");
});

test("T16: extracts numeric badge ID and handles trailing slashes", () => {
  const cardWithSlash = observedBadgeWithHref("With Slash", "/public_profiles/profile-001/badges/12345678/");
  const cardWithoutSlash = observedBadgeWithHref("Without Slash", "https://www.skills.google/public_profiles/profile-001/badges/87654321");

  const parsed = parseObservedGoogleSkillsProfileHtml(
    observedPage(`${cardWithSlash}${cardWithoutSlash}`),
    observedProfileUrl,
  );

  assert.equal(parsed.entries[0]?.stableId, "12345678");
  assert.equal(parsed.entries[0]?.canonicalBadgeUrl, "https://www.skills.google/public_profiles/profile-001/badges/12345678");
  assert.equal(parsed.entries[1]?.stableId, "87654321");
  assert.equal(parsed.entries[1]?.canonicalBadgeUrl, "https://www.skills.google/public_profiles/profile-001/badges/87654321");
});

test("T17: extracts all 115 unique badge IDs from observed-profile-current fixture", async () => {
  const currentHtml = await fixture("observed-profile-current.html");
  const profileUrl = "https://www.skills.google/public_profiles/1f30ae3d-ccdd-44cc-9285-38fdc6febd05";
  const parsed = parseObservedGoogleSkillsProfileHtml(currentHtml, profileUrl);

  assert.equal(parsed.status, "incomplete");
  assert.equal(parsed.identityStatus, "matched");
  assert.equal(parsed.badgeCandidates, 115);
  assert.equal(parsed.entries.length, 115);

  const stableIds = parsed.entries.map((entry) => entry.stableId);
  assert.ok(stableIds.every((id): id is string => typeof id === "string" && /^\d+$/.test(id)));

  const uniqueIds = new Set(stableIds);
  assert.equal(uniqueIds.size, 115, "All 115 badge IDs must be unique");

  assert.ok(parsed.entries.every((entry) =>
    entry.canonicalBadgeUrl !== null
    && entry.canonicalBadgeUrl.startsWith("https://www.skills.google/public_profiles/1f30ae3d-ccdd-44cc-9285-38fdc6febd05/badges/")
  ));
});

test("negative: invalid or missing badge href fails safe with null stableId and canonicalBadgeUrl", () => {
  const noHref = `<div class="profile-badge"><a class="badge-image"><img src="https://cdn.qwiklabs.com/h" /></a><span class="ql-title-medium">No Href</span></div>`;
  const emptyHref = observedBadgeWithHref("Empty", "");
  const externalDomain = observedBadgeWithHref("External", "https://evil.com/public_profiles/profile-001/badges/9999");
  const wrongProfile = observedBadgeWithHref("Wrong Profile", "https://www.skills.google/public_profiles/wrong-user/badges/9999");
  const nonNumericId = observedBadgeWithHref("Non Numeric", "/public_profiles/profile-001/badges/notanumber");
  const withQuery = observedBadgeWithHref("With Query", "/public_profiles/profile-001/badges/9999?query=1");
  const withHash = observedBadgeWithHref("With Hash", "/public_profiles/profile-001/badges/9999#hash");
  const protocolRelative = observedBadgeWithHref("Protocol Rel", "//www.skills.google/public_profiles/profile-001/badges/9999");
  const insecureHttp = observedBadgeWithHref("HTTP", "http://www.skills.google/public_profiles/profile-001/badges/9999");
  const profileOnly = observedBadgeWithHref("Profile Only", "https://www.skills.google/public_profiles/profile-001");

  const cards = [noHref, emptyHref, externalDomain, wrongProfile, nonNumericId, withQuery, withHash, protocolRelative, insecureHttp, profileOnly].join("");
  const parsed = parseObservedGoogleSkillsProfileHtml(observedPage(cards), observedProfileUrl);

  assert.equal(parsed.badgeCandidates, 10);
  assert.equal(parsed.entries.length, 10);
  for (const entry of parsed.entries) {
    assert.equal(entry.stableId, null, `stableId should be null for ${entry.title}`);
    assert.equal(entry.canonicalBadgeUrl, null, `canonicalBadgeUrl should be null for ${entry.title}`);
  }
});

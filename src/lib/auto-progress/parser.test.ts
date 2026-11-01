import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { inspectObservedGoogleProfileHtml, parseProfileFixture } from "./parser.ts";

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

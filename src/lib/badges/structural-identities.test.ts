import assert from "node:assert/strict";
import test from "node:test";
import type {
  StructuralBadgeParseResult,
  StructuralBadgeSignal,
} from "../auto-progress/parser.ts";
import {
  failedFetchObservation,
  isHaltStatus,
  structuralSignalsToObservation,
} from "./structural-identities.ts";

function signal(overrides: Partial<StructuralBadgeSignal> = {}): StructuralBadgeSignal {
  return {
    title: "Explore Generative AI",
    structuralTarget: "/course_templates/959",
    badgeKey: "course_template:959",
    awardBadgeId: "29297988",
    earnedOn: "2026-10-31",
    unresolvedReason: null,
    ...overrides,
  };
}

function ok(signals: StructuralBadgeSignal[], duplicateBadgeKeys: string[] = []): StructuralBadgeParseResult {
  return { status: "ok", signals, duplicateBadgeKeys, dialogCount: signals.length };
}

function incomplete(reason: Extract<StructuralBadgeParseResult, { status: "incomplete" }>["reason"]): StructuralBadgeParseResult {
  return { status: "incomplete", reason, signals: [], duplicateBadgeKeys: [], dialogCount: 0 };
}

const participantId = "00000000-0000-4000-8000-000000000101";

test("resolved structural cards become a complete observation with structural keys", () => {
  const decision = structuralSignalsToObservation(participantId, ok([
    signal(),
    signal({
      title: "Arcade Adventure",
      structuralTarget: "/games/102804",
      badgeKey: "game:102804",
      awardBadgeId: "29272127",
      earnedOn: "2026-10-30",
    }),
  ]));

  assert.equal(decision.status, "complete");
  assert.equal(decision.reason, "complete");
  assert.equal(decision.resolvedCount, 2);
  assert.equal(decision.unresolvedCount, 0);
  assert.deepEqual(decision.participant.badges, [
    {
      badgeKey: "course_template:959",
      badgeTitle: "Explore Generative AI",
      sourceBadgeId: "29297988",
      earnedOn: "2026-10-31",
    },
    {
      badgeKey: "game:102804",
      badgeTitle: "Arcade Adventure",
      sourceBadgeId: "29272127",
      earnedOn: "2026-10-30",
    },
  ]);
  assert.equal(decision.participant.observationStatus, "complete");
});

test("a single unresolved card makes the participant incomplete with no badges", () => {
  const decision = structuralSignalsToObservation(participantId, ok([
    signal(),
    signal({ badgeKey: null, structuralTarget: null, unresolvedReason: "missing_modal", title: "Unknown" }),
  ]));

  assert.equal(decision.status, "incomplete");
  assert.equal(decision.reason, "structural_identity_unresolved");
  assert.equal(decision.resolvedCount, 1);
  assert.equal(decision.unresolvedCount, 1);
  assert.deepEqual(decision.participant.badges, []);
  assert.match(decision.participant.reviewNote ?? "", /1 of 2 structural badge cards/);
});

test("a duplicate structural identity is ambiguous and stages nothing", () => {
  const decision = structuralSignalsToObservation(participantId, ok([signal(), signal()], ["course_template:959"]));

  assert.equal(decision.status, "incomplete");
  assert.equal(decision.reason, "duplicate_structural_identity");
  assert.deepEqual(decision.participant.badges, []);
});

test("empty and ambiguous pages are incomplete, never zero counts", () => {
  for (const reason of ["empty_unconfirmed", "badge_container_missing", "badge_container_ambiguous"] as const) {
    const decision = structuralSignalsToObservation(participantId, incomplete(reason));
    assert.equal(decision.status, "incomplete");
    assert.equal(decision.reason, reason);
    assert.deepEqual(decision.participant.badges, []);
    assert.equal(decision.participant.observationStatus, "incomplete");
  }
});

test("identity, challenge, access, loading, and malformed evidence fail", () => {
  for (const reason of [
    "identity_unverified",
    "identity_mismatch",
    "challenge_indicator",
    "access_denied_indicator",
    "loading_indicator",
    "unexpected_html",
    "incomplete_relevant_markup",
  ] as const) {
    const decision = structuralSignalsToObservation(participantId, incomplete(reason));
    assert.equal(decision.status, "failed", reason);
    assert.equal(decision.participant.observationStatus, "failed", reason);
    assert.deepEqual(decision.participant.badges, [], reason);
  }
});

test("fetch failures keep NULL counts and name the category", () => {
  const participant = failedFetchObservation(participantId, "timeout");
  assert.equal(participant.observationStatus, "failed");
  assert.deepEqual(participant.badges, []);
  assert.match(participant.reviewNote ?? "", /timeout/);
});

test("only 403 and 429 halt the run", () => {
  assert.equal(isHaltStatus("rate_limited"), true);
  assert.equal(isHaltStatus("blocked"), true);
  assert.equal(isHaltStatus("timeout"), false);
  assert.equal(isHaltStatus("upstream_error"), false);
});

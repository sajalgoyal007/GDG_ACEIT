import assert from "node:assert/strict";
import test from "node:test";
import { toStagingPayload, validateObservationBatch } from "./observations.ts";

const PARTICIPANT = "11111111-1111-4111-8111-111111111111";

function complete(overrides: Record<string, unknown> = {}) {
  return {
    participantId: PARTICIPANT,
    observationStatus: "complete" as const,
    badges: [
      { badgeKey: "course_template:754", badgeTitle: "A verified Skill badge" },
      { badgeKey: "game:76266", badgeTitle: "A verified Arcade badge" },
    ],
    ...overrides,
  };
}

test("a complete observation batch is accepted and shaped for the RPC", () => {
  const result = validateObservationBatch([complete({ reviewNote: " reviewed " })]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value[0]!.participantId, PARTICIPANT);
  assert.equal(result.value[0]!.reviewNote, "reviewed");
  assert.deepEqual(toStagingPayload(result.value)[0], {
    participant_id: PARTICIPANT,
    observation_status: "complete",
    review_note: "reviewed",
    badges: [
      {
        badge_key: "course_template:754",
        badge_title: "A verified Skill badge",
        source_badge_id: null,
        observed_at: null,
        earned_on: null,
      },
      {
        badge_key: "game:76266",
        badge_title: "A verified Arcade badge",
        source_badge_id: null,
        observed_at: null,
        earned_on: null,
      },
    ],
  });
});

test("duplicate participants are rejected", () => {
  const result = validateObservationBatch([complete(), complete()]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /same participant twice/);
});

test("duplicate badge identities in one participant are rejected", () => {
  const result = validateObservationBatch([
    complete({
      badges: [
        { badgeKey: "course_template:754", badgeTitle: "First" },
        { badgeKey: "course_template:754", badgeTitle: "Second" },
      ],
    }),
  ]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /Duplicate badge identity/);
});

test("award-scoped /badges ids are rejected as identities", () => {
  const result = validateObservationBatch([
    complete({ badges: [{ badgeKey: "/badges/29485277", badgeTitle: "Award scoped" }] }),
  ]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /award-scoped/);
});

test("incomplete and failed observations must not include badges", () => {
  for (const observationStatus of ["incomplete", "failed"] as const) {
    const withBadges = validateObservationBatch([complete({ observationStatus })]);
    assert.equal(withBadges.ok, false, observationStatus);
    const withoutBadges = validateObservationBatch([
      { participantId: PARTICIPANT, observationStatus, badges: [] },
    ]);
    assert.equal(withoutBadges.ok, true, observationStatus);
    if (!withoutBadges.ok) continue;
    assert.deepEqual(withoutBadges.value[0]!.badges, []);
  }
});

test("invalid titles, dates, and award ids are rejected", () => {
  const cases = [
    complete({ badges: [{ badgeKey: "course_template:754", badgeTitle: " " }] }),
    complete({ badges: [{ badgeKey: "course_template:754", badgeTitle: "Bad\u0001title" }] }),
    complete({ badges: [{ badgeKey: "course_template:754", badgeTitle: "Ok", sourceBadgeId: "/badges/1" }] }),
    complete({ badges: [{ badgeKey: "course_template:754", badgeTitle: "Ok", observedAt: "not-a-date" }] }),
    complete({ badges: [{ badgeKey: "course_template:754", badgeTitle: "Ok", earnedOn: "2026-13-40" }] }),
    complete({ reviewNote: "x".repeat(1001) }),
  ];
  for (const input of cases) {
    assert.equal(validateObservationBatch([input]).ok, false, JSON.stringify(input));
  }
});

test("observation timestamps normalize to UTC instants", () => {
  const result = validateObservationBatch([
    complete({
      badges: [
        {
          badgeKey: "course_template:754",
          badgeTitle: "Ok",
          observedAt: "2026-11-09T10:30:00+05:30",
          earnedOn: "2026-11-09",
        },
      ],
    }),
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value[0]!.badges[0]!.observedAt, "2026-11-09T05:00:00.000Z");
  assert.equal(result.value[0]!.badges[0]!.earnedOn, "2026-11-09");
});

test("empty and oversized batches are rejected", () => {
  assert.equal(validateObservationBatch([]).ok, false);
  const many = Array.from({ length: 501 }, (_, index) => ({
    participantId: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
    observationStatus: "incomplete" as const,
    badges: [],
  }));
  assert.equal(validateObservationBatch(many).ok, false);
});

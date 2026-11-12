import assert from "node:assert/strict";
import test from "node:test";
import { computeBadgeSyncPreview } from "./preview.ts";
import type { PreviewParticipantInput } from "./preview.ts";

function participant(overrides: Partial<PreviewParticipantInput> = {}): PreviewParticipantInput {
  return {
    participantId: "11111111-1111-4111-8111-111111111111",
    participantKey: "participant-one",
    displayName: "Participant One",
    rowNumber: 2,
    registrationStatus: "registered",
    observationStatus: "complete",
    previous: {
      verifiedTotal: 0,
      skill: null,
      arcade: null,
      lastVerifiedAt: null,
      verificationSource: null,
    },
    ...overrides,
  };
}

test("classified preview computes skill, arcade, total and delta", () => {
  const preview = computeBadgeSyncPreview({
    runId: "run-1",
    mode: "classified_counts",
    participants: [participant({ counts: { skill: 5, arcade: 2, total: 7 } })],
  });
  const row = preview.participants[0]!;
  assert.equal(row.skillCount, 5);
  assert.equal(row.arcadeCount, 2);
  assert.equal(row.totalCount, 7);
  assert.equal(row.delta, 7);
  assert.equal(row.status, "approved");
  assert.equal(preview.totals.total, 7);
});

test("classified preview enforces skill + arcade = total", () => {
  assert.throws(
    () =>
      computeBadgeSyncPreview({
        runId: "run-1",
        mode: "classified_counts",
        participants: [participant({ counts: { skill: 5, arcade: 2, total: 9 } })],
      }),
    /must equal total_count/,
  );
});

test("regressions are rejected but keep their proposed classified counts", () => {
  const preview = computeBadgeSyncPreview({
    runId: "run-1",
    mode: "classified_counts",
    participants: [
      participant({
        counts: { skill: 4, arcade: 1 },
        previous: { verifiedTotal: 10, skill: 8, arcade: 2, lastVerifiedAt: null, verificationSource: null },
      }),
    ],
  });
  const row = preview.participants[0]!;
  assert.equal(row.status, "rejected");
  assert.equal(row.isRegression, true);
  assert.equal(row.totalCount, 5);
  assert.equal(row.delta, -5);
  assert.match(row.blockingReason ?? "", /Regression/);
  assert.equal(preview.totals.blockedParticipants, 1);
});

test("incomplete and failed observations store null counts, never zero", () => {
  for (const observationStatus of ["incomplete", "failed"] as const) {
    const preview = computeBadgeSyncPreview({
      runId: "run-1",
      mode: "badge_observations",
      participants: [participant({ observationStatus })],
    });
    const row = preview.participants[0]!;
    assert.equal(row.status, "rejected");
    assert.equal(row.skillCount, null);
    assert.equal(row.arcadeCount, null);
    assert.equal(row.totalCount, null);
    assert.equal(row.delta, null);
    assert.match(row.blockingReason ?? "", /unknown, not zero/);
  }
});

test("removed participants are always rejected and never applied", () => {
  const preview = computeBadgeSyncPreview({
    runId: "run-1",
    mode: "classified_counts",
    participants: [
      participant({
        registrationStatus: "removed",
        counts: { skill: 3, arcade: 1 },
        previous: { verifiedTotal: 4, skill: 3, arcade: 1, lastVerifiedAt: null, verificationSource: null },
      }),
    ],
  });
  const row = preview.participants[0]!;
  assert.equal(row.status, "rejected");
  assert.equal(row.isRemoved, true);
  assert.equal(row.skillCount, null);
  assert.equal(row.totalCount, null);
  assert.match(row.blockingReason ?? "", /removed/i);
  assert.equal(preview.totals.participants, 0);
});

test("unclassified and pending badges block the affected participant", () => {
  for (const [category, status] of [
    ["unclassified", "unclassified"],
    ["skill", "pending"],
  ] as const) {
    const preview = computeBadgeSyncPreview({
      runId: "run-1",
      mode: "badge_observations",
      participants: [
        participant({
          badges: [
            { badgeKey: "course_template:754", category: "skill", status: "approved" },
            { badgeKey: "course_template:999", category, status },
          ],
        }),
      ],
    });
    const row = preview.participants[0]!;
    assert.equal(row.status, category === "unclassified" ? "unclassified" : "pending");
    assert.equal(row.skillCount, 1);
    assert.equal(row.unclassifiedBadgeCount, category === "unclassified" ? 1 : 0);
    assert.equal(row.pendingBadgeCount, status === "pending" ? 1 : 0);
    assert.ok(row.blockingReason);
  }
});

test("ignored badges are excluded and do not block", () => {
  const preview = computeBadgeSyncPreview({
    runId: "run-1",
    mode: "badge_observations",
    participants: [
      participant({
        badges: [
          { badgeKey: "course_template:754", category: "skill", status: "approved" },
          { badgeKey: "game:999", category: "ignored", status: "ignored" },
        ],
      }),
    ],
  });
  const row = preview.participants[0]!;
  assert.equal(row.status, "approved");
  assert.equal(row.skillCount, 1);
  assert.equal(row.arcadeCount, 0);
  assert.equal(row.totalCount, 1);
});

test("preview fingerprint is stable across ordering and changes with content", () => {
  const first = participant({ counts: { skill: 2, arcade: 1 } });
  const second = participant({
    participantId: "22222222-2222-4222-8222-222222222222",
    participantKey: "participant-two",
    displayName: "Participant Two",
    rowNumber: 3,
    counts: { skill: 0, arcade: 0 },
  });
  const baseline = computeBadgeSyncPreview({
    runId: "run-1",
    mode: "badge_observations",
    participants: [
      { ...first, badges: [
        { badgeKey: "course_template:754", category: "skill", status: "approved" },
        { badgeKey: "game:1", category: "arcade", status: "approved" },
      ] },
      second,
    ],
  });
  const reordered = computeBadgeSyncPreview({
    runId: "run-1",
    mode: "badge_observations",
    participants: [
      second,
      { ...first, badges: [
        { badgeKey: "game:1", category: "arcade", status: "approved" },
        { badgeKey: "course_template:754", category: "skill", status: "approved" },
      ] },
    ],
  });
  assert.equal(baseline.fingerprint, reordered.fingerprint);
  assert.match(baseline.fingerprint, /^[0-9a-f]{32}$/);

  const changed = computeBadgeSyncPreview({
    runId: "run-1",
    mode: "badge_observations",
    participants: [
      { ...first, badges: [
        { badgeKey: "course_template:754", category: "skill", status: "approved" },
        { badgeKey: "game:1", category: "arcade", status: "rejected" },
      ] },
      second,
    ],
  });
  assert.notEqual(baseline.fingerprint, changed.fingerprint);

  const recategorized = computeBadgeSyncPreview({
    runId: "run-1",
    mode: "badge_observations",
    participants: [
      { ...first, badges: [
        { badgeKey: "course_template:754", category: "skill", status: "approved" },
        { badgeKey: "game:1", category: "unclassified", status: "unclassified" },
      ] },
      second,
    ],
  });
  assert.notEqual(recategorized.fingerprint, baseline.fingerprint);

  const newRun = computeBadgeSyncPreview({
    runId: "run-2",
    mode: "badge_observations",
    participants: baseline.participants.map((row) => ({
      participantId: row.participantId,
      participantKey: row.participantKey,
      displayName: row.displayName,
      rowNumber: row.rowNumber,
      registrationStatus: row.registrationStatus,
      observationStatus: row.observationStatus,
      previous: {
        verifiedTotal: row.previousVerifiedTotal,
        skill: row.previousSkillCount,
        arcade: row.previousArcadeCount,
        lastVerifiedAt: row.previousLastVerifiedAt,
        verificationSource: row.previousVerificationSource,
      },
      counts: { skill: row.skillCount ?? 0, arcade: row.arcadeCount ?? 0 },
    })),
  });
  assert.notEqual(newRun.fingerprint, baseline.fingerprint);
});

test("preview totals count only rows that Apply will write", () => {
  const preview = computeBadgeSyncPreview({
    runId: "run-1",
    mode: "classified_counts",
    participants: [
      // Eligible: counted.
      participant({ counts: { skill: 5, arcade: 2 } }),
      // Regression: rejected, counts not written.
      participant({
        participantId: "22222222-2222-4222-8222-222222222222",
        rowNumber: 3,
        counts: { skill: 1, arcade: 1 },
        previous: { verifiedTotal: 10, skill: 8, arcade: 2, lastVerifiedAt: null, verificationSource: null },
      }),
      // Removed: never written.
      participant({
        participantId: "33333333-3333-4333-8333-333333333333",
        rowNumber: 4,
        registrationStatus: "removed",
        counts: { skill: 4, arcade: 0 },
      }),
    ],
  });

  assert.equal(preview.totals.participants, 1);
  assert.equal(preview.totals.skill, 5);
  assert.equal(preview.totals.arcade, 2);
  assert.equal(preview.totals.total, 7);
  assert.equal(preview.totals.blockedParticipants, 2);
  assert.equal(preview.totals.skill + preview.totals.arcade, preview.totals.total);
});

test("incomplete, unclassified and pending rows never contribute to preview totals", () => {
  const preview = computeBadgeSyncPreview({
    runId: "run-1",
    mode: "badge_observations",
    participants: [
      participant({
        observationStatus: "incomplete",
        badges: [],
      }),
      participant({
        participantId: "22222222-2222-4222-8222-222222222222",
        rowNumber: 3,
        badges: [{ badgeKey: "course_template:999", category: "unclassified", status: "unclassified" }],
      }),
      participant({
        participantId: "33333333-3333-4333-8333-333333333333",
        rowNumber: 4,
        badges: [{ badgeKey: "course_template:754", category: "skill", status: "pending" }],
      }),
      participant({
        participantId: "44444444-4444-4444-8444-444444444444",
        rowNumber: 5,
        badges: [
          { badgeKey: "course_template:754", category: "skill", status: "approved" },
          { badgeKey: "game:1", category: "arcade", status: "approved" },
        ],
      }),
    ],
  });

  assert.equal(preview.totals.participants, 1);
  assert.equal(preview.totals.skill, 1);
  assert.equal(preview.totals.arcade, 1);
  assert.equal(preview.totals.total, 2);
  assert.equal(preview.totals.blockedParticipants, 3);
  assert.equal(preview.totals.unclassifiedParticipants, 1);
  assert.equal(preview.totals.pendingParticipants, 1);
});

test("preview totals always satisfy skill + arcade = total", () => {
  const preview = computeBadgeSyncPreview({
    runId: "run-1",
    mode: "classified_counts",
    participants: [
      participant({ counts: { skill: 3, arcade: 4 } }),
      participant({
        participantId: "22222222-2222-4222-8222-222222222222",
        participantKey: "participant-two",
        displayName: "Participant Two",
        rowNumber: 3,
        counts: { skill: 1, arcade: 0 },
      }),
    ],
  });
  assert.equal(preview.totals.skill, 4);
  assert.equal(preview.totals.arcade, 4);
  assert.equal(preview.totals.total, 8);
  assert.equal(preview.totals.skill + preview.totals.arcade, preview.totals.total);
});

test("the same badge identity cannot be counted twice from one participant", () => {
  assert.throws(
    () =>
      computeBadgeSyncPreview({
        runId: "run-1",
        mode: "badge_observations",
        participants: [
          participant({
            badges: [
              { badgeKey: "course_template:754", category: "skill", status: "approved" },
              { badgeKey: "course_template:754", category: "skill", status: "approved" },
            ],
          }),
        ],
      }),
    /Duplicate badge identity/,
  );
});

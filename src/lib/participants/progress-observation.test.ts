import assert from "node:assert/strict";
import test from "node:test";
import { parseProgressObservationDraft } from "./progress-observation.ts";

const valid = {
  participantKey: "aceit-001",
  profileUrl: "https://www.skills.google/public_profiles/profile-001",
  sourceName: "arcadecalc_frontend",
  retrievedAt: "2026-11-01T16:22:12.087Z",
  httpStatus: "200",
  reportedTotal: "115",
  detailCount: "115",
  uniqueBadgeCount: "",
  completenessStatus: "unverified",
  summaryNote: "Detail identities and completeness were not established.",
};

test("parses a third-party report while keeping its completeness unverified", () => {
  const result = parseProgressObservationDraft(valid);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.reportedTotal, 115);
  assert.equal(result.value.detailCount, 115);
  assert.equal(result.value.uniqueBadgeCount, null);
  assert.equal(result.value.completenessStatus, "unverified");
  assert.equal(result.value.normalizedProfileUrl, "https://skills.google/public_profiles/profile-001");
});

test("records partial discrepancies without promoting the source total to a complete count", () => {
  const result = parseProgressObservationDraft({ ...valid, reportedTotal: "136", detailCount: "12", completenessStatus: "partial" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.completenessStatus, "partial");
});

test("rejects unknown identities, unsupported profile hosts, and unsupported source names", () => {
  assert.equal(parseProgressObservationDraft({ ...valid, participantKey: "" }).ok, false);
  assert.equal(parseProgressObservationDraft({ ...valid, profileUrl: "https://example.com/public_profiles/profile-001" }).ok, false);
  assert.equal(parseProgressObservationDraft({ ...valid, sourceName: "unknown_api" }).ok, false);
});

test("rejects malformed, negative, fractional, and out-of-range totals and details", () => {
  for (const reportedTotal of ["-1", "1.2", "10001", "NaN"]) {
    assert.equal(parseProgressObservationDraft({ ...valid, reportedTotal }).ok, false);
  }
  for (const detailCount of ["-1", "1.2", "10001"]) {
    assert.equal(parseProgressObservationDraft({ ...valid, detailCount }).ok, false);
  }
});

test("rejects impossible uniqueness, unsuccessful response counts, and unverified status without counts", () => {
  assert.equal(parseProgressObservationDraft({ ...valid, detailCount: "2", uniqueBadgeCount: "3" }).ok, false);
  assert.equal(parseProgressObservationDraft({ ...valid, httpStatus: "403", completenessStatus: "partial" }).ok, false);
  assert.equal(parseProgressObservationDraft({ ...valid, reportedTotal: "", detailCount: "", completenessStatus: "unverified" }).ok, false);
});

test("failed and blocked observations can be recorded without inventing zero counts", () => {
  const failed = parseProgressObservationDraft({ ...valid, httpStatus: "503", reportedTotal: "", detailCount: "", completenessStatus: "failed" });
  const blocked = parseProgressObservationDraft({ ...valid, httpStatus: "403", reportedTotal: "", detailCount: "", completenessStatus: "blocked" });
  assert.equal(failed.ok, true);
  assert.equal(blocked.ok, true);
  assert.equal(parseProgressObservationDraft({ ...valid, httpStatus: "503", completenessStatus: "failed" }).ok, false);
});

test("rejects invalid retrieval timestamps, future timestamps, invalid HTTP codes, and unsafe notes", () => {
  assert.equal(parseProgressObservationDraft({ ...valid, retrievedAt: "no-date" }).ok, false);
  assert.equal(parseProgressObservationDraft({ ...valid, retrievedAt: new Date(Date.now() + 10 * 60_000).toISOString() }).ok, false);
  assert.equal(parseProgressObservationDraft({ ...valid, httpStatus: "99" }).ok, false);
  assert.equal(parseProgressObservationDraft({ ...valid, summaryNote: "x\u0000y" }).ok, false);
});

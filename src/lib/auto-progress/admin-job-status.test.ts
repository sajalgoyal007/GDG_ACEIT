import assert from "node:assert/strict";
import test from "node:test";
import { parseAdminAutoProgressJob } from "./admin-job-status.ts";

const valid = [{
  job_id: "job-id",
  trigger_source: "scheduled",
  job_status: "partial",
  created_at: "2026-11-01T12:00:00Z",
  started_at: "2026-11-01T12:00:01Z",
  completed_at: "2026-11-01T12:01:00Z",
  total_count: 5,
  fetched_count: 4,
  validated_count: 3,
  saved_count: 2,
  unchanged_count: 0,
  failed_count: 1,
  skipped_count: 0,
  error_category: "timeout",
}];

test("parses a bounded persisted job summary without participant data", () => {
  const parsed = parseAdminAutoProgressJob(valid);
  assert.equal(parsed?.status, "partial");
  assert.equal(parsed?.total, 5);
  assert.equal(parsed?.failed, 1);
  assert.equal("participantId" in (parsed ?? {}), false);
});

test("preserves zero counters and distinguishes no job from malformed state", () => {
  assert.equal(parseAdminAutoProgressJob([]), null);
  assert.equal(parseAdminAutoProgressJob([{ ...valid[0], total_count: 0, fetched_count: 0, validated_count: 0, saved_count: 0, failed_count: 0 }])?.total, 0);
  assert.equal(parseAdminAutoProgressJob([{ ...valid[0], fetched_count: 9 }]), null);
});

test("rejects unknown statuses, malformed timestamps, and unsafe error details", () => {
  assert.equal(parseAdminAutoProgressJob([{ ...valid[0], job_status: "unknown" }]), null);
  assert.equal(parseAdminAutoProgressJob([{ ...valid[0], created_at: "yesterday" }]), null);
  assert.equal(parseAdminAutoProgressJob([{ ...valid[0], error_category: "raw stack trace" }]), null);
});

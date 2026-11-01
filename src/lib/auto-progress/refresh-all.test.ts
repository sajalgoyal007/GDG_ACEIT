import assert from "node:assert/strict";
import test from "node:test";
import { refreshAllParticipants } from "./refresh-all.ts";

const success = { status: "recorded" as const, result: [{ result_status: "ok" }], fetched: true, validated: true };
const failure = { status: "recorded" as const, result: [{ result_status: "timeout" }], fetched: false, validated: false };

test("Refresh All bounds concurrent profile work and reports partial results without exposing errors", async () => {
  let active = 0;
  let maximum = 0;
  const summary = await refreshAllParticipants(["a", "b", "c", "d", "e", "f"], async (id) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    if (id === "b") return failure;
    if (id === "e") throw new Error("profile URL and private upstream body");
    return success;
  }, { concurrency: 3, timeoutMs: 500 });

  assert.equal(maximum, 3);
  assert.equal(summary.total, 6);
  assert.equal(summary.fetched, 4);
  assert.equal(summary.updated, 4);
  assert.equal(summary.refreshed, 4);
  assert.equal(summary.failed, 2);
  assert.equal(summary.results.find((item) => item.participantId === "b")?.status, "failed");
  assert.equal(summary.results.some((item) => item.message.includes("private upstream")), false);
});

test("empty roster reports zero work and a large roster is processed exactly once within the concurrency bound", async () => {
  let emptyCalls = 0;
  const empty = await refreshAllParticipants([], async () => { emptyCalls += 1; return success; });
  assert.deepEqual([empty.total, empty.fetched, empty.updated, empty.failed, empty.skipped], [0, 0, 0, 0, 0]);
  assert.equal(emptyCalls, 0);

  const ids = Array.from({ length: 1_205 }, (_, index) => `participant-${index}`);
  const seen = new Set<string>();
  let active = 0;
  let maximum = 0;
  const large = await refreshAllParticipants(ids, async (id) => {
    active += 1;
    maximum = Math.max(maximum, active);
    assert.equal(seen.has(id), false);
    seen.add(id);
    await Promise.resolve();
    active -= 1;
    return success;
  }, { concurrency: 4 });
  assert.equal(seen.size, ids.length);
  assert.equal(maximum, 4);
  assert.equal(large.total, 1_205);
  assert.equal(large.updated, 1_205);
});

test("a complete fetch whose database write fails is reported as fetched, failed, and not updated", async () => {
  const summary = await refreshAllParticipants(["write-failure"], async () => ({ status: "write_failed", fetched: true, validated: true }));
  assert.equal(summary.fetched, 1);
  assert.equal(summary.updated, 0);
  assert.equal(summary.failed, 1);
});

test("Refresh All timeout aborts the per-profile operation and records an isolated timeout result", async () => {
  const summary = await refreshAllParticipants(["slow", "fast"], async (_id, signal) => {
    if (_id === "fast") return success;
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  }, { concurrency: 2, timeoutMs: 10 });

  assert.equal(summary.refreshed, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.results.find((item) => item.participantId === "slow")?.status, "timeout");
});

test("Refresh All stops scheduling after losing the durable job lease", async () => {
  let calls = 0;
  const summary = await refreshAllParticipants(["a", "b", "c"], async () => {
    calls += 1;
    return success;
  }, { concurrency: 1, renewJobLease: async () => calls === 0 });

  assert.equal(summary.status, "lock_lost");
  assert.equal(calls, 1);
  assert.equal(summary.results.length, 3);
  assert.equal(summary.results.filter((item) => item.status === "skipped").length, 2);
});

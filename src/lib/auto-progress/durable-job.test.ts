import assert from "node:assert/strict";
import test from "node:test";
import { claimDurableJobBatch, runDurableBatch, startOrResumeDurableJob, type DurableJobItem } from "./durable-job.ts";
import type { RpcWriter } from "./service.ts";

const item = (participantId: string, id = `item-${participantId}`): DurableJobItem => ({ id, participantId, claimToken: `claim-${id}`, attempt: 1 });

test("duplicate job triggers with the same idempotency key return the existing durable job", async () => {
  let starts = 0;
  const writer: RpcWriter = { rpc: async (_name, args) => {
    starts += 1;
    assert.equal(args.p_dedupe_key, "schedule:2026-10-31T00");
    return { data: [{ job_status: "running", job_id: "job-1", total_count: 125, fetched_count: 3, validated_count: 2, saved_count: 2, unchanged_count: 0, failed_count: 0, skipped_count: 0, is_complete: false }], error: null };
  } };
  const [first, retry] = await Promise.all([
    startOrResumeDurableJob(writer, "token", "scheduled", "schedule:2026-10-31T00"),
    startOrResumeDurableJob(writer, "token", "scheduled", "schedule:2026-10-31T00"),
  ]);
  assert.equal(starts, 2);
  assert.deepEqual(retry, first);
  assert.equal(first.total, 125);
  assert.equal(first.saved, 2);
});

test("a non-stale job response without a durable job ID fails closed", async () => {
  const writer: RpcWriter = { rpc: async () => ({ data: [{
    job_status: "running", job_id: null, total_count: 1, fetched_count: 0,
    validated_count: 0, saved_count: 0, unchanged_count: 0, failed_count: 0,
    skipped_count: 0, is_complete: false,
  }], error: null }) };
  await assert.rejects(startOrResumeDurableJob(writer, "token", "admin", "admin:test"), /durable_job_start_failed/);
});

test("a batch with more work than its size remains resumable and each participant is claimed once", async () => {
  const roster = Array.from({ length: 21 }, (_, i) => `p-${i}`);
  const claimed = new Set<string>();
  const writer: RpcWriter = { rpc: async (_name, args) => {
    const batch = roster.filter((id) => !claimed.has(id)).slice(0, Number(args.p_batch_size));
    for (const id of batch) claimed.add(id);
    return { data: batch.map((id) => ({ item_id: `i-${id}`, participant_id: id, item_claim_token: `t-${id}`, attempt_count: 1 })), error: null };
  } };
  const first = await claimDurableJobBatch(writer, "job", "lock", 8);
  const second = await claimDurableJobBatch(writer, "job", "lock", 8);
  const third = await claimDurableJobBatch(writer, "job", "lock", 8);
  assert.deepEqual([first.length, second.length, third.length], [8, 8, 5]);
  assert.equal(claimed.size, roster.length);
});

test("bounded durable batch survives one participant failure and continues remaining items", async () => {
  const items = Array.from({ length: 10 }, (_, i) => item(`p-${i}`));
  let inFlight = 0;
  let peak = 0;
  const outcomes = await runDurableBatch(items, async (current) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await Promise.resolve();
    inFlight -= 1;
    if (current.participantId === "p-4") throw new Error("private fetch detail");
    return "persisted";
  }, { concurrency: 3 });
  assert.equal(peak, 3);
  assert.equal(outcomes.length, 10);
  assert.equal(outcomes.filter((result) => result.error === "failed").length, 1);
  assert.equal(outcomes.filter((result) => result.value === "persisted").length, 9);
});

test("an interrupted item receives an abort signal and an accurate timeout result", async () => {
  const outcomes = await runDurableBatch([item("slow")], async (_current, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  }), { timeoutMs: 5 });
  assert.equal(outcomes[0].error, "timeout");
});

test("malformed database batch rows fail closed instead of silently dropping participants", async () => {
  const writer: RpcWriter = { rpc: async () => ({ data: [{ item_id: "i1", participant_id: "p1", item_claim_token: "t1" }, {}], error: null }) };
  await assert.rejects(claimDurableJobBatch(writer, "job", "lock"), /durable_job_batch_invalid/);
});

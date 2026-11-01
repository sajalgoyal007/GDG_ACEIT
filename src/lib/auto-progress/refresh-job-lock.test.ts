import assert from "node:assert/strict";
import test from "node:test";
import { claimRefreshJob, releaseRefreshJob, renewRefreshJob } from "./refresh-job-lock.ts";
import type { RpcWriter } from "./service.ts";

test("only one concurrent Refresh All attempt acquires the job lease", async () => {
  let claimCalls = 0;
  let leaseHeld = false;
  const rpc: RpcWriter = { rpc: async (name, args) => {
    if (name === "claim_participant_auto_refresh_job") {
      claimCalls += 1;
      if (leaseHeld) return { data: [{ job_status: "busy", lease_expires_at: new Date(Date.now() + 15_000).toISOString() }], error: null };
      leaseHeld = true;
      return { data: [{ job_status: "claimed", lock_token: "winner-token" }], error: null };
    }
    if (name === "release_participant_auto_refresh_job" && args.p_lock_token === "winner-token") {
      leaseHeld = false;
      return { data: [{ job_status: "released" }], error: null };
    }
    return { data: null, error: null };
  } };
  const [first, second] = await Promise.all([claimRefreshJob(rpc), claimRefreshJob(rpc)]);
  assert.equal(claimCalls, 2);
  assert.equal([first, second].filter((claim) => claim.status === "claimed").length, 1);
  assert.equal([first, second].filter((claim) => claim.status === "busy").length, 1);
  assert.equal(await releaseRefreshJob(rpc, "winner-token"), true);
});

test("only a current lock token can renew or release a job", async () => {
  const rpc: RpcWriter = { rpc: async (name, args) => {
    if (name === "renew_participant_auto_refresh_job") {
      return { data: [{ job_status: args.p_lock_token === "current-token" ? "renewed" : "stale" }], error: null };
    }
    if (name === "release_participant_auto_refresh_job") {
      return { data: [{ job_status: args.p_lock_token === "current-token" ? "released" : "stale" }], error: null };
    }
    return { data: [{ job_status: "claimed", lock_token: "current-token" }], error: null };
  } };
  const claim = await claimRefreshJob(rpc);
  assert.deepEqual(claim, { status: "claimed", token: "current-token" });
  assert.equal(await renewRefreshJob(rpc, "old-token"), false);
  assert.equal(await releaseRefreshJob(rpc, "old-token"), false);
  assert.equal(await renewRefreshJob(rpc, "current-token"), true);
  assert.equal(await releaseRefreshJob(rpc, "current-token"), true);
});

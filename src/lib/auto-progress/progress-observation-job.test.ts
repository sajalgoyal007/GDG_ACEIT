import assert from "node:assert/strict";
import test from "node:test";
import { executeObservationBatch, type ObservationJobItem } from "./progress-observation-job.ts";
import type { FetchLike } from "./safe-fetch.ts";
import type { RpcWriter } from "./service.ts";

const profileUrl = "https://www.skills.google/public_profiles/77777777-7777-4777-8777-777777777777";
const html = `<html><head><link rel="canonical" href="${profileUrl}"></head><body><div class="profile-badges"><div class="profile-badge"><a class="badge-image"><img src="https://cdn.example.test/badge.png"></a><span class="ql-title-medium">Fixture badge</span></div></div></body></html>`;
const item: ObservationJobItem = { id: "item-1", participantId: "participant-1", claimToken: "claim-1", attempt: 1 };

function dependencies(options: { fetchImpl?: FetchLike; rpcResult?: unknown } = {}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const writer = { rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    return { data: options.rpcResult ?? [{ item_status: args.p_status }], error: null };
  } } as unknown as RpcWriter;
  const adminClient = {
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({
      data: { participant_key: "participant-1", profile_url: profileUrl, auto_profile_revision: 1 }, error: null,
    }) }) }) }) }),
  } as never;
  const fetchImpl: FetchLike = options.fetchImpl ?? (async () => new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }));
  return { writer, adminClient, calls, fetchImpl };
}

async function withEnabled(run: () => Promise<void>) {
  const previous = process.env.AUTO_PROGRESS_ENABLED;
  const previousAuthorization = process.env.GOOGLE_SKILLS_PROFILE_FETCH_AUTHORIZED;
  process.env.AUTO_PROGRESS_ENABLED = "true";
  process.env.GOOGLE_SKILLS_PROFILE_FETCH_AUTHORIZED = "true";
  try { await run(); }
  finally {
    if (previous === undefined) delete process.env.AUTO_PROGRESS_ENABLED; else process.env.AUTO_PROGRESS_ENABLED = previous;
    if (previousAuthorization === undefined) delete process.env.GOOGLE_SKILLS_PROFILE_FETCH_AUTHORIZED;
    else process.env.GOOGLE_SKILLS_PROFILE_FETCH_AUTHORIZED = previousAuthorization;
  }
}

test("a matching page stores only an explicitly unverified observation through the fenced RPC", async () => withEnabled(async () => {
  const deps = dependencies();
  const results = await executeObservationBatch({
    ...deps, actorUserId: "admin-1", jobId: "job-1", lockToken: "lock-1", items: [item], renewLease: async () => true,
  });
  assert.equal(results[0]?.status, "observed");
  assert.equal(deps.calls.length, 1);
  assert.equal(deps.calls[0]?.name, "finish_progress_observation_item");
  assert.equal(deps.calls[0]?.args.p_status, "observed");
  assert.equal(deps.calls[0]?.args.p_reported_total, 1);
  assert.equal(deps.calls[0]?.args.p_detail_count, 1);
  assert.equal("p_verified_badge_count" in (deps.calls[0]?.args ?? {}), false);
}));

test("blocked and rate-limited fetches never submit counts and safe retries remain queued", async () => withEnabled(async () => {
  const deps = dependencies({ fetchImpl: async () => new Response("", { status: 429, headers: { "content-type": "text/html", "retry-after": "90" } }) });
  const results = await executeObservationBatch({
    ...deps, actorUserId: "admin-1", jobId: "job-1", lockToken: "lock-1", items: [item], renewLease: async () => true,
  });
  assert.equal(results[0]?.status, "retrying");
  assert.equal(deps.calls[0]?.args.p_status, "pending");
  assert.equal(deps.calls[0]?.args.p_error_category, "rate_limited");
  assert.equal(deps.calls[0]?.args.p_retry_after_seconds, 90);
  assert.equal("p_reported_total" in (deps.calls[0]?.args ?? {}), false);
}));

test("lease loss prevents profile requests and persistence", async () => withEnabled(async () => {
  let requests = 0;
  const deps = dependencies({ fetchImpl: async () => { requests += 1; return new Response(html); } });
  const result = await executeObservationBatch({
    ...deps, actorUserId: "admin-1", jobId: "job-1", lockToken: "lock-1", items: [item], renewLease: async () => false,
  });
  assert.equal(result[0]?.status, "stale");
  assert.equal(requests, 0);
  assert.equal(deps.calls.length, 0);
}));

test("profile identity mismatch is skipped without recording a count", async () => withEnabled(async () => {
  const deps = dependencies({ fetchImpl: async () => new Response(html.replace(profileUrl, `${profileUrl}-other`), { status: 200, headers: { "content-type": "text/html" } }) });
  const result = await executeObservationBatch({
    ...deps, actorUserId: "admin-1", jobId: "job-1", lockToken: "lock-1", items: [item], renewLease: async () => true,
  });
  assert.equal(result[0]?.status, "skipped");
  assert.equal(deps.calls[0]?.args.p_status, "skipped");
  assert.equal("p_reported_total" in (deps.calls[0]?.args ?? {}), false);
}));

test("timed-out requests are abort-signalled and retried without persisting a count", async () => withEnabled(async () => {
  let aborted = false;
  const deps = dependencies({ fetchImpl: async (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); }, { once: true });
  }) });
  const result = await executeObservationBatch({
    ...deps, actorUserId: "admin-1", jobId: "job-1", lockToken: "lock-1", items: [item], renewLease: async () => true, timeoutMs: 5,
  });
  assert.equal(aborted, true);
  assert.equal(result[0]?.status, "retrying");
  assert.equal(deps.calls[0]?.args.p_error_category, "timeout");
  assert.equal("p_reported_total" in (deps.calls[0]?.args ?? {}), false);
}));

test("observation requests remain bounded to four concurrent profiles", async () => withEnabled(async () => {
  let active = 0;
  let maximum = 0;
  const deps = dependencies({ fetchImpl: async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
  } });
  const items = Array.from({ length: 7 }, (_, index) => ({ ...item, id: `item-${index}`, participantId: `participant-${index}` }));
  await executeObservationBatch({
    ...deps, actorUserId: "admin-1", jobId: "job-1", lockToken: "lock-1", items, renewLease: async () => true,
  });
  assert.equal(maximum, 4);
  assert.equal(deps.calls.length, 7);
}));

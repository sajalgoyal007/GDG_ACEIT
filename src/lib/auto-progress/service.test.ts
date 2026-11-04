import assert from "node:assert/strict";
import test from "node:test";
import { claimProfileFetch, refreshParticipantAutoProgress, type RpcWriter } from "./service.ts";
import { fetchPublicProfileHtml } from "./safe-fetch.ts";
import { parseProfileFixture } from "./parser.ts";
import type { AutoProgressProvider, AutoProgressProviderResult } from "./provider.ts";

const complete = '<main data-auto-progress-complete="true"><article data-auto-badge data-badge-id="badge-a" data-earned="true" data-eligible="true"></article></main>';
const url = "https://skills.google/public_profiles/fixture";

function fixtureProvider() {
  return {
    availability: "available" as const,
    async fetchProfile(profileUrl: string, fetchImpl?: (input: string | URL, init?: RequestInit) => Promise<Response>, signal?: AbortSignal): Promise<AutoProgressProviderResult> {
      const fetched = await fetchPublicProfileHtml(profileUrl, { fetchImpl, signal });
      if (fetched.status !== "ok") {
        const statuses: Record<string, AutoProgressProviderResult> = {
          disabled: { status: "unavailable" }, invalid_url: { status: "invalid_url" },
          unsafe_redirect: { status: "blocked" }, too_many_redirects: { status: "blocked" },
          provider_unavailable: { status: "unavailable" }, timeout: { status: "timeout" },
          too_large: { status: "incomplete" }, private: { status: "unauthorized" },
          not_found: { status: "not_found" }, rate_limited: { status: "rate_limited" },
          blocked: { status: "blocked" }, upstream_error: { status: "unavailable" },
        };
        return statuses[fetched.status] ?? { status: "unavailable" };
      }
      const parsed = parseProfileFixture(fetched.html);
      if (parsed.status === "incomplete") return { status: "incomplete" };
      return {
        status: "complete",
        normalizedProfileUrl: fetched.normalizedProfileUrl,
        retrievedAt: new Date().toISOString(),
        source: "local-fixture",
        badges: parsed.badges.map((badge) => ({ id: badge.key, title: badge.key, category: null, eligible: true })),
        pagination: { pagesFetched: 1, hasMore: false, truncated: false },
      };
    },
  };
}

function withFlag(value: string | undefined, operation: () => Promise<void>) {
  const previous = process.env.AUTO_PROGRESS_ENABLED;
  const previousAuthorization = process.env.GOOGLE_SKILLS_PROFILE_FETCH_AUTHORIZED;
  if (value === undefined) delete process.env.AUTO_PROGRESS_ENABLED;
  else process.env.AUTO_PROGRESS_ENABLED = value;
  process.env.GOOGLE_SKILLS_PROFILE_FETCH_AUTHORIZED = "true";
  return operation().finally(() => {
    if (previous === undefined) delete process.env.AUTO_PROGRESS_ENABLED;
    else process.env.AUTO_PROGRESS_ENABLED = previous;
    if (previousAuthorization === undefined) delete process.env.GOOGLE_SKILLS_PROFILE_FETCH_AUTHORIZED;
    else process.env.GOOGLE_SKILLS_PROFILE_FETCH_AUTHORIZED = previousAuthorization;
  });
}

function writer() {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const rpc: RpcWriter = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === "claim_participant_auto_fetch") return {
        data: [{ claim_status: "claimed", claim_token: "db-claim-token", profile_url: url, profile_revision: 4, lease_expires_at: "2026-10-31T12:02:00Z" }], error: null,
      };
      return { data: [{ result_status: "ok" }], error: null };
    },
  };
  return { calls, rpc };
}

test("mandatory environment flag prevents claims and network fetches", async () => withFlag(undefined, async () => {
  const stub = writer();
  let fetchCalls = 0;
  const result = await refreshParticipantAutoProgress(stub.rpc, "id", { fetchImpl: async () => { fetchCalls += 1; return new Response(complete); } });
  assert.deepEqual(result, { status: "disabled" });
  assert.equal(stub.calls.length, 0);
  assert.equal(fetchCalls, 0);
}));

test("default unavailable provider returns before claiming or fetching", async () => withFlag("true", async () => {
  const stub = writer();
  let fetchCalls = 0;
  const result = await refreshParticipantAutoProgress(stub.rpc, "id", {
    fetchImpl: async () => { fetchCalls += 1; return new Response(complete); },
  });
  assert.deepEqual(result, { status: "provider_unavailable" });
  assert.equal(stub.calls.length, 0);
  assert.equal(fetchCalls, 0);
}));

test("database cooldown claim returns a bounded retry delay without acquiring a token", async () => withFlag("true", async () => {
  const retryAt = new Date(Date.now() + 25_000).toISOString();
  const rpc: RpcWriter = { rpc: async () => ({ data: [{ claim_status: "cooldown", lease_expires_at: retryAt }], error: null }) };
  const result = await claimProfileFetch(rpc, "trusted-participant");
  assert.equal(result.status, "cooldown");
  if (result.status === "cooldown") assert.ok(result.retryAfterSeconds >= 1 && result.retryAfterSeconds <= 25);
}));

test("acquires a database claim before fetching, then finalizes with its token", async () => withFlag("true", async () => {
  const stub = writer();
  const order: string[] = [];
  const originalRpc = stub.rpc.rpc;
  const rpc: RpcWriter = {
    rpc: async (name, args) => { order.push(name); return originalRpc(name, args); },
  };
  const result = await refreshParticipantAutoProgress(rpc, "participant-id", {
    provider: fixtureProvider(),
    fetchImpl: async (_input, init) => { order.push("fetch"); assert.ok(init?.signal); return new Response(complete, { headers: { "content-type": "text/html" } }); },
  });
  assert.equal(result.status, "recorded");
  assert.deepEqual(order, ["claim_participant_auto_fetch", "fetch", "record_participant_auto_fetch"]);
  assert.equal(stub.calls[1].args.p_claim_token, "db-claim-token");
  assert.equal(stub.calls[1].args.p_profile_url, url);
  assert.equal("p_attempted_at" in stub.calls[1].args, false);
  assert.equal("verified_badge_count" in stub.calls[1].args, false);
  assert.equal("last_verified_at" in stub.calls[1].args, false);
}));

test("records incomplete parsing as a failure without a count or snapshot", async () => withFlag("true", async () => {
  const stub = writer();
  await refreshParticipantAutoProgress(stub.rpc, "id", { provider: fixtureProvider(), fetchImpl: async () => new Response("<main><p>partial</p></main>", { headers: { "content-type": "text/html" } }) });
  assert.equal(stub.calls[1].args.p_fetch_status, "incomplete");
  assert.equal(stub.calls[1].args.p_badges, null);
  assert.equal(stub.calls[1].args.p_snapshot_id, null);
}));

test("persists an explicit complete zero as an empty validated snapshot", async () => withFlag("true", async () => {
  const stub = writer();
  const provider = {
    availability: "available" as const,
    fetchProfile: async () => ({
      status: "complete" as const,
      normalizedProfileUrl: url,
      retrievedAt: new Date().toISOString(),
      source: "fixture",
      badges: [],
      pagination: { pagesFetched: 1, hasMore: false, truncated: false },
    }),
  };
  await refreshParticipantAutoProgress(stub.rpc, "id", { provider });
  assert.equal(stub.calls[1].args.p_fetch_status, "ok");
  assert.deepEqual(stub.calls[1].args.p_badges, []);
  assert.equal(stub.calls[1].args.p_snapshot_id, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
}));

test("malformed provider snapshots cannot reach persistence as zero counts", async () => withFlag("true", async () => {
  const stub = writer();
  const provider = {
    availability: "available" as const,
    fetchProfile: async () => ({
      status: "complete",
      normalizedProfileUrl: url,
      retrievedAt: new Date().toISOString(),
      source: "fixture",
      pagination: { pagesFetched: 1, hasMore: false, truncated: false },
    }),
  } as unknown as AutoProgressProvider;
  await refreshParticipantAutoProgress(stub.rpc, "id", { provider });
  assert.equal(stub.calls[1].args.p_fetch_status, "incomplete");
  assert.equal(stub.calls[1].args.p_badges, null);
  assert.equal(stub.calls[1].args.p_snapshot_id, null);
}));

test("a provider exception finalizes as a failure without inventing a snapshot", async () => withFlag("true", async () => {
  const stub = writer();
  const provider = { availability: "available" as const, fetchProfile: async () => { throw new Error("private provider error"); } };
  const result = await refreshParticipantAutoProgress(stub.rpc, "id", { provider });
  assert.equal(result.status, "recorded");
  assert.equal(stub.calls[1].args.p_fetch_status, "upstream_error");
  assert.equal(stub.calls[1].args.p_badges, null);
  assert.equal(stub.calls[1].args.p_snapshot_id, null);
}));

test("a provider that resolves after abort cannot persist its late successful snapshot", async () => withFlag("true", async () => {
  const stub = writer();
  const controller = new AbortController();
  const provider = {
    availability: "available" as const,
    // Deliberately ignores AbortSignal to exercise the service-side fence.
    fetchProfile: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return {
        status: "complete" as const,
        normalizedProfileUrl: url,
        retrievedAt: new Date().toISOString(),
        source: "fixture",
        badges: [{ id: "badge-a", title: "Badge A", category: "skill", eligible: true }],
        pagination: { pagesFetched: 1, hasMore: false, truncated: false },
      };
    },
  };
  const abortTimer = setTimeout(() => controller.abort(), 2);
  try {
    const result = await refreshParticipantAutoProgress(stub.rpc, "id", { provider, signal: controller.signal });
    assert.equal(result.status, "recorded");
    assert.equal(stub.calls[1].args.p_fetch_status, "timeout");
    assert.equal(stub.calls[1].args.p_badges, null);
    assert.equal(stub.calls[1].args.p_snapshot_id, null);
  } finally {
    clearTimeout(abortTimer);
  }
}));

test("a database busy or duplicate claim does not start a network request", async () => withFlag("true", async () => {
  for (const claimStatus of ["busy", "duplicate_profile"] as const) {
    let fetchCalls = 0;
    const rpc: RpcWriter = { rpc: async () => ({ data: [{ claim_status: claimStatus, lease_expires_at: new Date(Date.now() + 20_000).toISOString() }], error: null }) };
    const result = await refreshParticipantAutoProgress(rpc, "id", { provider: fixtureProvider(), fetchImpl: async () => { fetchCalls += 1; return new Response(complete); } });
    assert.equal(result.status, claimStatus);
    assert.equal(fetchCalls, 0);
  }
}));

import assert from "node:assert/strict";
import test from "node:test";
import { handleRefreshRequest } from "./refresh-handler.ts";

const common = {
  origin: "https://community.example",
  requestOrigin: "https://community.example",
  configured: true,
  getAuthStatus: async () => "authenticated" as const,
  resolveIdentity: async () => ({ status: "linked" as const, participantId: "trusted-id" }),
  enabled: true,
  providerAvailable: true,
  execute: async (participantId: string) => {
    assert.equal(participantId, "trusted-id");
    return { status: "recorded" as const, result: [{ result_status: "ok" }], fetched: true, validated: true };
  },
};

test("unauthenticated attempts are rejected before resolving or refreshing a participant", async () => {
  let resolved = false;
  let executed = false;
  const result = await handleRefreshRequest({
    ...common,
    getAuthStatus: async () => "signed_out",
    resolveIdentity: async () => { resolved = true; return { status: "linked", participantId: "x" }; },
    execute: async () => { executed = true; return { status: "write_failed", fetched: false, validated: false }; },
  });
  assert.equal(result.status, 401);
  assert.equal(resolved, false);
  assert.equal(executed, false);
});

test("requests from another origin are rejected before authentication", async () => {
  let authCalls = 0;
  const result = await handleRefreshRequest({ ...common, origin: "https://attacker.example", getAuthStatus: async () => { authCalls += 1; return "authenticated"; } });
  assert.equal(result.status, 403);
  assert.equal(authCalls, 0);
});

test("disabled flag and unavailable provider never execute the refresh service", async () => {
  let executions = 0;
  const execute = async () => { executions += 1; return { status: "write_failed" as const, fetched: false, validated: false }; };
  const disabled = await handleRefreshRequest({ ...common, enabled: false, execute });
  const unavailable = await handleRefreshRequest({ ...common, providerAvailable: false, execute });
  assert.equal(disabled.body.status, "disabled");
  assert.equal(unavailable.body.status, "provider_unavailable");
  assert.equal(executions, 0);
});

test("identity resolution uses the trusted linked participant and does not accept browser IDs or URLs", async () => {
  let executionId: string | null = null;
  const result = await handleRefreshRequest({
    ...common,
    execute: async (participantId) => { executionId = participantId; return { status: "recorded", result: [{ result_status: "ok" }], fetched: true, validated: true }; },
  });
  assert.equal(result.status, 200);
  assert.equal(executionId, "trusted-id");
});

test("unlinked accounts cannot invoke refresh", async () => {
  let executions = 0;
  const result = await handleRefreshRequest({
    ...common,
    resolveIdentity: async () => ({ status: "not_linked" }),
    execute: async () => { executions += 1; return { status: "write_failed", fetched: false, validated: false }; },
  });
  assert.equal(result.status, 404);
  assert.equal(executions, 0);
});

test("database cooldown is returned as retryable rate limiting", async () => {
  const result = await handleRefreshRequest({
    ...common,
    execute: async () => ({ status: "cooldown", retryAfterSeconds: 12 }),
  });
  assert.equal(result.status, 429);
  assert.equal(result.body.retryAfterSeconds, 12);
});

test("Refresh All rejects signed-out and non-admin callers before starting any job", async () => {
  const { handleRefreshAllRequest } = await import("./refresh-all-handler.ts");
  let executions = 0;
  const base = {
    origin: "https://community.example",
    requestOrigin: "https://community.example",
    authorize: async () => "admin" as const,
    enabled: true,
    providerAvailable: true,
    execute: async () => { executions += 1; return { status: "completed" as const, total: 0, fetched: 0, updated: 0, refreshed: 0, failed: 0, skipped: 0, results: [] }; },
  };
  const signedOut = await handleRefreshAllRequest({ ...base, authorize: async () => "signed_out" });
  const notAdmin = await handleRefreshAllRequest({ ...base, authorize: async () => "not_admin" });
  assert.equal(signedOut.status, 401);
  assert.equal(notAdmin.status, 403);
  assert.equal(executions, 0);
});

test("Refresh All rejects invalid origin and unavailable live provider without querying participants", async () => {
  const { handleRefreshAllRequest } = await import("./refresh-all-handler.ts");
  let executions = 0;
  const base = {
    origin: "https://community.example",
    requestOrigin: "https://community.example",
    authorize: async () => "admin" as const,
    enabled: true,
    providerAvailable: true,
    execute: async () => { executions += 1; return { status: "completed" as const, total: 0, fetched: 0, updated: 0, refreshed: 0, failed: 0, skipped: 0, results: [] }; },
  };
  const invalidOrigin = await handleRefreshAllRequest({ ...base, origin: "https://attacker.invalid" });
  const unavailable = await handleRefreshAllRequest({ ...base, providerAvailable: false });
  assert.equal(invalidOrigin.status, 403);
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.body.status, "provider_unavailable");
  assert.equal(executions, 0);
});

test("Refresh All response never says completed when no snapshots were saved", async () => {
  const { handleRefreshAllRequest } = await import("./refresh-all-handler.ts");
  const base = {
    origin: "https://community.example",
    requestOrigin: "https://community.example",
    authorize: async () => "admin" as const,
    enabled: true,
    providerAvailable: true,
    execute: async () => ({ status: "completed" as const, total: 2, fetched: 0, updated: 0, refreshed: 0, failed: 2, skipped: 0, results: [] }),
  };
  const noUpdates = await handleRefreshAllRequest(base);
  assert.equal(noUpdates.status, 207);
  assert.equal(noUpdates.body.status, "no_updates");
  const empty = await handleRefreshAllRequest({ ...base, execute: async () => ({ status: "completed" as const, total: 0, fetched: 0, updated: 0, refreshed: 0, failed: 0, skipped: 0, results: [] }) });
  assert.equal(empty.status, 200);
  assert.equal(empty.body.status, "empty_roster");
  const partial = await handleRefreshAllRequest({ ...base, execute: async () => ({ status: "partial" as const, total: 2, fetched: 1, updated: 1, refreshed: 1, failed: 1, skipped: 0, results: [] }) });
  assert.equal(partial.status, 207);
  assert.equal(partial.body.status, "partial");
});

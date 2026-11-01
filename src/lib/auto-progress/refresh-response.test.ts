import assert from "node:assert/strict";
import test from "node:test";
import { toRefreshHttpResult } from "./refresh-response.ts";

test("provider and feature failures return explicit non-success responses", () => {
  assert.equal(toRefreshHttpResult({ status: "disabled" }).body.status, "disabled");
  const unavailable = toRefreshHttpResult({ status: "provider_unavailable" });
  assert.equal(unavailable.status, 503);
  assert.match(unavailable.body.message, /remains unchanged/);
});

test("only a committed successful RPC result is reported as refreshed", () => {
  assert.equal(toRefreshHttpResult({ status: "recorded", result: [{ result_status: "ok" }], fetched: true, validated: true }).status, 200);
  assert.equal(toRefreshHttpResult({ status: "recorded", result: [{ result_status: "stale_claim" }], fetched: true, validated: true }).status, 409);
  assert.equal(toRefreshHttpResult({ status: "write_failed", fetched: false, validated: false }).status, 503);
});

test("active claims prevent duplicate concurrent refresh work", () => {
  const busy = toRefreshHttpResult({ status: "busy", retryAfterSeconds: 30 });
  assert.equal(busy.status, 409);
  assert.equal(busy.body.status, "busy");
  assert.equal(busy.body.retryAfterSeconds, 30);
});

test("cooldown responses include a retry delay and HTTP 429 semantics", () => {
  const retry = toRefreshHttpResult({ status: "cooldown", retryAfterSeconds: 42 });
  assert.equal(retry.status, 429);
  assert.equal(retry.body.retryAfterSeconds, 42);
  assert.match(retry.body.message, /42 seconds/);
});

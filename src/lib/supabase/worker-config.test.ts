import assert from "node:assert/strict";
import test from "node:test";
import { isRefreshAllAvailable, isWorkerKeyConfigured } from "./worker-config.ts";

test("worker configuration check reports only whether a nonblank key is present", () => {
  assert.equal(isWorkerKeyConfigured(undefined), false);
  assert.equal(isWorkerKeyConfigured(""), false);
  assert.equal(isWorkerKeyConfigured("  \t "), false);
  assert.equal(isWorkerKeyConfigured("configured"), true);
});

test("Refresh All requires both explicit feature enablement and a configured server worker key", () => {
  assert.equal(isRefreshAllAvailable(false, "configured"), false);
  assert.equal(isRefreshAllAvailable(true, undefined), false);
  assert.equal(isRefreshAllAvailable(true, "  "), false);
  assert.equal(isRefreshAllAvailable(true, "configured"), true);
});

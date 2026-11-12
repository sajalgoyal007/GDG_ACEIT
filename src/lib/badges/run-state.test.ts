import assert from "node:assert/strict";
import test from "node:test";
import {
  BadgeSyncTransitionError,
  applyDisposition,
  assertTransition,
  canTransition,
  isTerminalStatus,
} from "./run-state.ts";

test("the documented lifecycle transitions are allowed", () => {
  const path = ["draft", "staged", "previewed", "approved", "applying", "applied", "rolled_back"] as const;
  for (let index = 0; index < path.length - 1; index += 1) {
    assert.equal(canTransition(path[index]!, path[index + 1]!), true, `${path[index]} -> ${path[index + 1]}`);
  }
});

test("invalid lifecycle jumps are rejected", () => {
  assert.equal(canTransition("draft", "applied"), false);
  assert.equal(canTransition("staged", "approved"), false);
  assert.equal(canTransition("previewed", "applying"), false);
  assert.equal(canTransition("applied", "applied"), false);
  assert.equal(canTransition("rolled_back", "applied"), false);
  assert.throws(() => assertTransition("draft", "applied"), BadgeSyncTransitionError);
});

test("terminal states never transition further", () => {
  assert.equal(isTerminalStatus("rolled_back"), true);
  assert.equal(isTerminalStatus("failed"), true);
  assert.equal(isTerminalStatus("cancelled"), true);
  assert.equal(isTerminalStatus("applied"), false);
  assert.equal(isTerminalStatus("approved"), false);
});

test("apply disposition replays an applied run and rejects unsafe states", () => {
  assert.deepEqual(applyDisposition("approved"), { action: "apply" });
  assert.deepEqual(applyDisposition("applied"), { action: "replay", reason: "already-applied" });
  assert.equal(applyDisposition("applying").action, "reject");
  assert.equal(applyDisposition("rolled_back").action, "reject");
  assert.equal(applyDisposition("previewed").action, "reject");
});

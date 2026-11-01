import assert from "node:assert/strict";
import test from "node:test";
import { loadRegisteredParticipantIds } from "./registered-participants.ts";

test("registered roster pagination uses the last UUID as a keyset cursor and includes every page", async () => {
  const source = Array.from({ length: 1_205 }, (_, index) => `id-${String(index).padStart(4, "0")}`);
  const cursors: (string | null)[] = [];
  const result = await loadRegisteredParticipantIds(async (afterId, limit) => {
    cursors.push(afterId);
    const start = afterId === null ? 0 : source.findIndex((id) => id === afterId) + 1;
    return { ids: source.slice(start, start + limit), error: false };
  }, 500);
  assert.deepEqual(cursors, [null, "id-0499", "id-0999"]);
  assert.deepEqual(result, source);
});

test("empty roster stops after one page and query failures are not treated as an empty roster", async () => {
  let calls = 0;
  const empty = await loadRegisteredParticipantIds(async () => { calls += 1; return { ids: [], error: false }; });
  assert.deepEqual(empty, []);
  assert.equal(calls, 1);
  await assert.rejects(loadRegisteredParticipantIds(async () => ({ ids: [], error: true })), /registered_participants_unavailable/);
});

test("pagination stops safely if a full page cannot advance its keyset cursor", async () => {
  await assert.rejects(loadRegisteredParticipantIds(async () => ({ ids: ["same", "same"], error: false }), 2), /pagination_stalled/);
});

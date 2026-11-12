import assert from "node:assert/strict";
import test from "node:test";
import type { BadgeSyncFetchItem, BadgeSyncRpcWriter } from "./fetch-queue.ts";
import { executeBadgeSyncFetchBatch, readBadgeSyncFetchPacingMs } from "./fetch-batch.ts";
import type { ProfileFetchResult } from "../auto-progress/safe-fetch.ts";

const participantA = "00000000-0000-4000-8000-000000000201";
const participantB = "00000000-0000-4000-8000-000000000202";
const participantC = "00000000-0000-4000-8000-000000000203";
const runId = "00000000-0000-4000-8000-0000000002ff";
const profileUrl = "https://www.skills.google/public_profiles/abc";

function item(id: string, participantId: string, profile: string | null): BadgeSyncFetchItem {
  return {
    id,
    participantId,
    participantKey: `key-${participantId.slice(-3)}`,
    displayName: `Participant ${participantId.slice(-3)}`,
    profileUrl: profile,
    claimToken: `00000000-0000-4000-8000-00000000${id.slice(-4)}`,
    attemptCount: 1,
  };
}

const structuralHtml = `<!doctype html><html><head><link rel="canonical" href="${profileUrl}"></head><body>
<div class="profile-badges">
<div class="profile-badge"><a class="badge-image" href="${profileUrl}/badges/29297988"></a><span class="ql-title-medium">Explore Generative AI</span><span class="ql-body-medium">Earned Oct 31, 2026 EDT</span><ql-button modal="m0"></ql-button></div>
<div class="profile-badge"><a class="badge-image" href="${profileUrl}/badges/29272127"></a><span class="ql-title-medium">Arcade Adventure</span><span class="ql-body-medium">Earned Oct 30, 2026 EDT</span><ql-button modal="m1"></ql-button></div>
</div>
<ql-dialog id="m0"><ql-button href="/course_templates/959"></ql-button></ql-dialog>
<ql-dialog id="m2"><ql-button href="/games/102804"></ql-button></ql-dialog>
<ql-dialog id="m1"><ql-button href="/games/102804"></ql-button></ql-dialog>
</body></html>`;

interface HarnessOptions {
  items: BadgeSyncFetchItem[];
  stageError?: { message: string } | null;
}

function harness(options: HarnessOptions) {
  const finishes = new Map<string, { status: string; category: string | null }>();
  const pauseCalls: { paused: boolean; reason: string | null }[] = [];
  const stagePayloads: Record<string, unknown>[] = [];
  const sleeps: number[] = [];
  const claimCalls: { batchSize: unknown; leaseSeconds: unknown }[] = [];
  let paused = false;
  let pauseReason: string | null = null;

  function progressRow() {
    const statuses = options.items.map((entry) => finishes.get(entry.id)?.status ?? "pending");
    const count = (wanted: string) => statuses.filter((status) => status === wanted).length;
    const staged = count("staged");
    const failed = count("failed");
    const skipped = count("skipped");
    const processed = staged + failed + skipped;
    const remaining = options.items.length - processed;
    return {
      run_id: runId,
      run_status: "staged",
      total: options.items.length,
      processed,
      remaining,
      pending_count: count("pending"),
      claimed_count: 0,
      staged_count: staged,
      failed_count: failed,
      skipped_count: skipped,
      complete: options.items.length > 0 && remaining === 0,
      paused,
      pause_reason: pauseReason,
    };
  }

  const writer: BadgeSyncRpcWriter = {
    async rpc(name, args) {
      if (name === "admin_claim_badge_sync_fetch_batch") {
        claimCalls.push({ batchSize: args.p_batch_size, leaseSeconds: args.p_lease_seconds });
        return {
          error: null,
          data: options.items.map((entry) => ({
            item_id: entry.id,
            participant_id: entry.participantId,
            participant_key: entry.participantKey,
            display_name: entry.displayName,
            profile_url: entry.profileUrl,
            item_claim_token: entry.claimToken,
            attempt_count: entry.attemptCount,
          })),
        };
      }
      if (name === "admin_finish_badge_sync_fetch_item") {
        finishes.set(String(args.p_item_id), {
          status: String(args.p_item_status),
          category: (args.p_error_category as string | null) ?? null,
        });
        return { error: null, data: [{ item_status: args.p_item_status }] };
      }
      if (name === "admin_set_badge_sync_fetch_pause") {
        paused = args.p_paused === true;
        pauseReason = paused ? String(args.p_reason) : null;
        pauseCalls.push({ paused, reason: pauseReason });
        return { error: null, data: [{ paused, pause_reason: pauseReason }] };
      }
      if (name === "admin_stage_badge_sync_observations") {
        if (options.stageError) return { error: options.stageError, data: null };
        stagePayloads.push(...(args.p_participants as Record<string, unknown>[]));
        return { error: null, data: null };
      }
      if (name === "admin_badge_sync_progress") {
        return { error: null, data: [progressRow()] };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
  };

  return { writer, finishes, pauseCalls, stagePayloads, sleeps, claimCalls };
}

test("stages complete evidence and preserves NULL for a missing profile URL", async () => {
  const items = [
    item("0001", participantA, profileUrl),
    item("0002", participantB, null),
  ];
  const h = harness({ items });

  const result = await executeBadgeSyncFetchBatch({
    writer: h.writer,
    runId,
    concurrency: 1,
    pacingMs: 0,
    sleep: async () => {},
    fetchHtml: async () => ({ status: "ok", html: structuralHtml, normalizedProfileUrl: profileUrl, httpStatus: 200 }),
  });

  assert.equal(h.finishes.get(items[0].id)?.status, "staged");
  assert.equal(h.finishes.get(items[0].id)?.category, null);
  assert.equal(h.finishes.get(items[1].id)?.status, "staged");
  assert.equal(h.finishes.get(items[1].id)?.category, "no_profile_url");

  const first = h.stagePayloads[0] as { observation_status: string; badges: { badge_key: string }[] };
  assert.equal(first.observation_status, "complete");
  assert.deepEqual(first.badges.map((badge) => badge.badge_key), ["course_template:959", "game:102804"]);

  const second = h.stagePayloads[1] as { observation_status: string; badges: unknown[] };
  assert.equal(second.observation_status, "failed");
  assert.deepEqual(second.badges, []);

  assert.equal(result.progress.complete, true);
  assert.equal(result.progress.total, 2);
  assert.equal(result.halted, null);
});

test("a timeout stages a failed observation with NULL counts", async () => {
  const items = [item("0003", participantA, profileUrl)];
  const h = harness({ items });

  const result = await executeBadgeSyncFetchBatch({
    writer: h.writer,
    runId,
    concurrency: 1,
    pacingMs: 0,
    sleep: async () => {},
    fetchHtml: async () => ({ status: "timeout" }),
  });

  assert.equal(h.finishes.get(items[0].id)?.status, "staged");
  assert.equal(h.finishes.get(items[0].id)?.category, "timeout");
  const staged = h.stagePayloads[0] as { observation_status: string; badges: unknown[] };
  assert.equal(staged.observation_status, "failed");
  assert.deepEqual(staged.badges, []);
  assert.equal(result.failed, 0);
});

test("HTTP 429 releases the current and remaining items to pending and pauses the run", async () => {
  const items = [
    item("0004", participantA, profileUrl),
    item("0005", participantB, profileUrl),
    item("0006", participantC, profileUrl),
  ];
  const h = harness({ items });

  const result = await executeBadgeSyncFetchBatch({
    writer: h.writer,
    runId,
    concurrency: 1,
    pacingMs: 0,
    sleep: async () => {},
    fetchHtml: async () => ({ status: "rate_limited", retryAfter: "120" }),
  });

  assert.equal(result.halted, "rate_limited");
  assert.equal(h.pauseCalls.length, 1);
  assert.equal(h.pauseCalls[0].paused, true);
  assert.match(h.pauseCalls[0].reason ?? "", /429/);
  assert.equal(h.stagePayloads.length, 0);
  for (const entry of items) assert.equal(h.finishes.get(entry.id)?.status, "pending");
  assert.equal(h.finishes.get(items[0].id)?.category, "rate_limited");
  assert.equal(result.progress.paused, true);
});

test("HTTP 403 also halts instead of exhausting the roster", async () => {
  const items = [item("0007", participantA, profileUrl), item("0008", participantB, profileUrl)];
  const h = harness({ items });

  const result = await executeBadgeSyncFetchBatch({
    writer: h.writer,
    runId,
    concurrency: 1,
    pacingMs: 0,
    sleep: async () => {},
    fetchHtml: async () => ({ status: "blocked" }),
  });

  assert.equal(result.halted, "blocked");
  assert.equal(h.pauseCalls[0].paused, true);
  for (const entry of items) assert.equal(h.finishes.get(entry.id)?.status, "pending");
});

test("a staging failure keeps the item pending so completeness is never faked", async () => {
  const items = [item("0009", participantA, profileUrl)];
  const h = harness({ items, stageError: { message: "database unavailable" } });

  const result = await executeBadgeSyncFetchBatch({
    writer: h.writer,
    runId,
    concurrency: 1,
    pacingMs: 0,
    sleep: async () => {},
    fetchHtml: async () => ({ status: "ok", html: structuralHtml, normalizedProfileUrl: profileUrl, httpStatus: 200 }),
  });

  assert.equal(h.finishes.get(items[0].id)?.status, "pending");
  assert.equal(h.finishes.get(items[0].id)?.category, "staging_error");
  assert.equal(result.retrying, 1);
  assert.deepEqual(result.errors, [{ participantId: participantA, category: "staging_error" }]);
});

test("fetch starts are spaced by the configured pacing even with concurrency", async () => {
  const items = [item("0010", participantA, profileUrl), item("0011", participantB, profileUrl)];
  const h = harness({ items });

  await executeBadgeSyncFetchBatch({
    writer: h.writer,
    runId,
    concurrency: 2,
    pacingMs: 1_500,
    now: () => 0,
    sleep: async (ms) => { h.sleeps.push(ms); },
    fetchHtml: async (): Promise<ProfileFetchResult> => ({ status: "upstream_error" }),
  });

  assert.deepEqual(h.sleeps, [1_500]);
});

test("pacing defaults to 400 ms and is bounded", () => {
  assert.equal(readBadgeSyncFetchPacingMs({}), 400);
  assert.equal(readBadgeSyncFetchPacingMs({ BADGE_SYNC_FETCH_PACING_MS: "2500" }), 2_500);
  assert.equal(readBadgeSyncFetchPacingMs({ BADGE_SYNC_FETCH_PACING_MS: "-4" }), 400);
  assert.equal(readBadgeSyncFetchPacingMs({ BADGE_SYNC_FETCH_PACING_MS: "999999" }), 10_000);
});

function manyItems(count: number): BadgeSyncFetchItem[] {
  return Array.from({ length: count }, (_, index) => item(
    String(index + 1).padStart(4, "0"),
    `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    profileUrl,
  ));
}

test("defaults claim 20 items and run 6 fetches concurrently", async () => {
  const items = manyItems(20);
  const h = harness({ items });
  let inFlight = 0;
  let maxInFlight = 0;

  await executeBadgeSyncFetchBatch({
    writer: h.writer,
    runId,
    pacingMs: 0,
    sleep: async () => {},
    fetchHtml: async (): Promise<ProfileFetchResult> => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 0));
      inFlight -= 1;
      return { status: "upstream_error" };
    },
  });

  assert.equal(h.claimCalls[0]?.batchSize, 20);
  assert.equal(maxInFlight, 6);
});

test("an oversized batch request is clamped to the queue RPC's 32-item cap", async () => {
  const h = harness({ items: manyItems(1) });

  await executeBadgeSyncFetchBatch({
    writer: h.writer,
    runId,
    batchSize: 999,
    concurrency: 999,
    pacingMs: 0,
    sleep: async () => {},
    fetchHtml: async (): Promise<ProfileFetchResult> => ({ status: "upstream_error" }),
  });

  assert.equal(h.claimCalls[0]?.batchSize, 32);
});

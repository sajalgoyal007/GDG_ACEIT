import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { resolveDisposableSupabaseTarget } from "./auto-progress-disposable-target.mjs";

const target = await resolveDisposableSupabaseTarget();
const { apiUrl, serviceKey, anonKey } = target;

const client = createClient(apiUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const publicClient = createClient(apiUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const suffix = randomUUID().replaceAll("-", "");
const participants = Array.from({ length: 14 }, (_, index) => ({
  participant_key: `auto-rank-test-${suffix}-${index + 1}`,
  display_name: `Local concurrency fixture ${index + 1}`,
  profile_url: `https://skills.google/public_profiles/auto-rank-${suffix}-${index + 1}`,
  registration_status: "registered",
}));
let inserted = [];

const badgeSet = (count) => Array.from({ length: count }, (_, index) => ({ key: `fixture-badge-${index + 1}` }));
const claim = async (id, lease = 120) => {
  const { data, error } = await client.rpc("claim_participant_auto_fetch", {
    p_participant_id: id,
    p_lease_seconds: lease,
  });
  if (error || !data?.[0]) throw new Error("Local database claim failed.");
  return data[0];
};
const claimAfterCooldown = async (id, lease = 120) => {
  let result = await claim(id, lease);
  if (result.claim_status === "cooldown") {
    const retryAt = Date.parse(result.lease_expires_at);
    if (!Number.isFinite(retryAt)) throw new Error("Local database returned an invalid cooldown timestamp.");
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, retryAt - Date.now()) + 50));
    result = await claim(id, lease);
  }
  return result;
};
const finalize = async (participant, claimResult, badges) => client.rpc("record_participant_auto_fetch", {
  p_participant_id: participant.id,
  p_profile_url: participant.profile_url,
  p_claim_token: claimResult.claim_token,
  p_profile_revision: claimResult.profile_revision,
  p_fetch_status: "ok",
  p_badges: badges,
  p_snapshot_id: `snapshot-${badges.length}`,
  p_parser_version: "local-concurrency-test",
  p_error_category: null,
});

try {
  const { data, error } = await client
    .from("participants")
    .insert(participants)
    .select("id,profile_url");
  if (error || !data || data.length !== participants.length) {
    throw new Error("Could not create disposable concurrency fixtures.");
  }
  inserted = data;

  const claims = await Promise.all(inserted.map((participant) => claim(participant.id)));
  assert.ok(claims.every((result) => result.claim_status === "claimed"));
  const initialResults = await Promise.all(inserted.map((participant, index) => finalize(participant, claims[index], badgeSet(10))));
  assert.ok(initialResults.every((result) => !result.error));
  const initialRanks = initialResults.map((result) => result.data?.[0]?.finish_rank).filter((rank) => rank !== null).sort((a, b) => a - b);
  assert.deepEqual(initialRanks, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(
    initialResults.filter((result) => result.data?.[0]?.finish_rank === null).length,
    participants.length - 10,
    "every qualifier beyond the first ten must remain unranked",
  );

  const rankedIndex = initialResults.findIndex((result) => result.data?.[0]?.finish_rank !== null);
  assert.notEqual(rankedIndex, -1, "at least one concurrent qualifier must receive a rank");
  const rankedParticipant = inserted[rankedIndex];
  const sequentialRetry = await claim(rankedParticipant.id);
  assert.equal(sequentialRetry.claim_status, "cooldown", "a sequential refresh is rate limited");
  const concurrentRetries = await Promise.all([claim(rankedParticipant.id), claim(rankedParticipant.id)]);
  assert.ok(concurrentRetries.every((result) => result.claim_status === "cooldown"), "concurrent retries cannot race past the durable cooldown");
  const repeatClaim = await claimAfterCooldown(rankedParticipant.id);
  assert.equal(repeatClaim.claim_status, "claimed");
  const repeated = await finalize(rankedParticipant, repeatClaim, badgeSet(10));
  assert.equal(repeated.data?.[0]?.finish_rank, initialResults[rankedIndex].data?.[0]?.finish_rank, "repeat processing must preserve rank");

  const decreaseClaim = await claimAfterCooldown(rankedParticipant.id);
  assert.equal(decreaseClaim.claim_status, "claimed");
  const decreased = await finalize(rankedParticipant, decreaseClaim, badgeSet(9));
  assert.equal(decreased.data?.[0]?.eligible_badge_count, 9);
  assert.equal(decreased.data?.[0]?.finish_rank, initialResults[rankedIndex].data?.[0]?.finish_rank, "count decreases must not alter a locked rank");

  const unrankedIndex = initialResults.findIndex((result) => result.data?.[0]?.finish_rank === null);
  assert.notEqual(unrankedIndex, -1, "participants beyond the Top 10 must remain unranked");
  const staleParticipant = inserted[unrankedIndex];
  const expiredClaim = await claimAfterCooldown(staleParticipant.id, 5);
  assert.equal(expiredClaim.claim_status, "claimed");
  await new Promise((resolve) => setTimeout(resolve, 5_100));
  const newerClaim = await claimAfterCooldown(staleParticipant.id, 120);
  assert.equal(newerClaim.claim_status, "claimed");
  const [staleResult, currentResult] = await Promise.all([
    finalize(staleParticipant, expiredClaim, badgeSet(10)),
    finalize(staleParticipant, newerClaim, badgeSet(11)),
  ]);
  assert.ok(!staleResult.error && !currentResult.error);
  assert.equal(staleResult.data?.[0]?.result_status, "stale_claim");
  assert.equal(currentResult.data?.[0]?.eligible_badge_count, 11);
  assert.equal(currentResult.data?.[0]?.finish_rank, null);

  const { data: beforeInvalid } = await publicClient
    .from("public_auto_progress_leaderboard")
    .select("status,eligible_badge_count,last_successful_check_at,last_progress_change_at")
    .eq("participant_id", staleParticipant.id)
    .single();
  const invalidResult = await finalize(staleParticipant, { ...newerClaim, claim_token: randomUUID() }, badgeSet(5));
  assert.equal(invalidResult.data?.[0]?.result_status, "stale_claim");
  const { data: afterStale } = await publicClient
    .from("public_auto_progress_leaderboard")
    .select("status,eligible_badge_count,last_successful_check_at,last_progress_change_at")
    .eq("participant_id", staleParticipant.id)
    .single();
  assert.deepEqual(afterStale, beforeInvalid, "stale or invalid claims cannot overwrite progress or its timestamps");

  const changedParticipant = inserted[12];
  const profileClaim = await claimAfterCooldown(changedParticipant.id);
  assert.equal(profileClaim.claim_status, "claimed");
  const changedUrl = `https://skills.google/public_profiles/changed-${suffix}`;
  const { error: profileUpdateError } = await client
    .from("participants").update({ profile_url: changedUrl }).eq("id", changedParticipant.id);
  if (profileUpdateError) throw new Error("Could not update local profile fixture.");
  const staleProfileResult = await client.rpc("record_participant_auto_fetch", {
    p_participant_id: changedParticipant.id,
    p_profile_url: changedParticipant.profile_url,
    p_claim_token: profileClaim.claim_token,
    p_profile_revision: profileClaim.profile_revision,
    p_fetch_status: "ok",
    p_badges: badgeSet(10),
    p_snapshot_id: "stale-profile-snapshot",
    p_parser_version: "local-concurrency-test",
    p_error_category: null,
  });
  assert.equal(staleProfileResult.data?.[0]?.result_status, "stale_claim");
  const { data: invalidated } = await publicClient
    .from("public_auto_progress_leaderboard")
    .select("status,eligible_badge_count")
    .eq("participant_id", changedParticipant.id)
    .single();
  assert.equal(invalidated?.status, "unavailable");
  assert.equal(invalidated?.eligible_badge_count, null);

  const reassignedA = inserted[12];
  const reassignedB = inserted[13];
  const { error: assignDuplicateError } = await client
    .from("participants").update({ profile_url: reassignedB.profile_url }).eq("id", reassignedA.id);
  if (assignDuplicateError) throw new Error("Could not create duplicate URL fixture.");
  const { error: reassignError } = await client
    .from("participants").update({ profile_url: reassignedA.profile_url }).eq("id", reassignedB.id);
  if (reassignError) throw new Error("Could not reassign the released URL fixture.");
  const reassignedClaim = await claimAfterCooldown(reassignedB.id);
  assert.equal(reassignedClaim.claim_status, "claimed", "released normalized URL should be claimable by its new participant");

  const { data: ranks, error: ranksError } = await publicClient
    .from("public_auto_progress_leaderboard")
    .select("ten_badge_finish_rank")
    .not("ten_badge_finish_rank", "is", null);
  if (ranksError) throw new Error("Could not inspect local finish ranks.");
  const allRanks = ranks.map((row) => row.ten_badge_finish_rank).sort((a, b) => a - b);
  assert.deepEqual(allRanks, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  process.stdout.write("Local concurrency passed: contiguous ranks 1-10, no rank 11, repeat/decrease locking, expired and invalid claims, stale concurrent finalization, profile invalidation, and URL reassignment.\n");
} finally {
  await client.from("participants").delete().in("participant_key", participants.map((participant) => participant.participant_key));
}

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveDisposableSupabaseTarget } from "./auto-progress-disposable-target.mjs";

const execFileAsync = promisify(execFile);
const target = await resolveDisposableSupabaseTarget();
const container = target.databaseContainer;

const runId = crypto.randomUUID().replaceAll("-", "");
const prefix = `durable-race-${runId}`;
const dedupeA = `${prefix}-trigger-a`;
const dedupeB = `${prefix}-trigger-b`;
let lockToken = null;
let fixtureCount = 0;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function psql(sql) {
  try {
    const { stdout } = await execFileAsync("docker", [
      "exec", container, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1",
      "-U", "postgres", "-d", "postgres", "-c", sql,
    ], { maxBuffer: 1024 * 1024 });
    return stdout.trim();
  } catch {
    throw new Error("isolated_postgres_command_failed");
  }
}

function workerSql(sql) {
  return psql(`begin; set local request.jwt.claim.role = 'service_role'; ${sql}; commit;`);
}

function rows(value) {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function one(value, label) {
  const values = rows(value);
  assert.equal(values.length, 1, `${label}: expected one result`);
  return values[0];
}

function parseClaim(value) {
  const [participantId, itemId, claimToken, attempt] = value.split("|");
  assert.ok(participantId && itemId && claimToken && attempt, "claim result is malformed");
  return { participantId, itemId, claimToken, attempt: Number(attempt) };
}

async function claimBatch(jobId, token, batchSize = 1) {
  const sql = `begin; set local request.jwt.claim.role = 'service_role'; select pg_sleep(0.2); `
    + `select participant_id::text || '|' || item_id::text || '|' || item_claim_token::text || '|' || attempt_count::text `
    + `from public.claim_participant_auto_refresh_job_batch('${jobId}'::uuid, '${token}'::uuid, ${batchSize}, 5); commit;`;
  return rows(await psql(sql)).map(parseClaim);
}

try {
  await psql(`insert into public.participants (id, participant_key, display_name, profile_url, registration_status) `
    + `select gen_random_uuid(), '${prefix}-' || n::text, 'Disposable Worker ' || n::text, `
    + `'https://skills.google/public_profiles/${prefix}-' || n::text, 'registered' from generate_series(1, 2) n`);
  fixtureCount = 2;
  const fixtures = rows(await psql(`select id::text || '|' || profile_url from public.participants `
    + `where participant_key like '${prefix}-%' order by id`)).map((row) => {
    const [id, profileUrl] = row.split("|");
    return { id, profileUrl };
  });
  assert.equal(fixtures.length, 2, "job manifest fixture setup failed");
  lockToken = one(await workerSql("select lock_token::text from public.claim_participant_auto_refresh_job(300)"), "global lease");

  const start = async (key) => one(await psql(`begin; set local request.jwt.claim.role = 'service_role'; select pg_sleep(0.25); `
    + `select job_id::text from public.start_or_resume_participant_auto_refresh_job('${lockToken}'::uuid, 'admin', '${key}'); commit;`), "concurrent job trigger");
  const [jobA, jobB] = await Promise.all([start(dedupeA), start(dedupeB)]);
  assert.equal(jobA, jobB, "concurrent triggers did not converge on one active job");
  const jobId = jobA;
  assert.equal(await psql("select count(*)::text from public.participant_auto_refresh_jobs where status in ('queued', 'running')"), "1");
  assert.equal(await psql(`select count(*)::text from public.participant_auto_refresh_job_items where job_id = '${jobId}'::uuid`), "2");
  console.log("PASS: simultaneous job triggers created one active job with the full manifest");

  const [workerA, workerB] = await Promise.all([claimBatch(jobId, lockToken), claimBatch(jobId, lockToken)]);
  assert.equal(workerA.length, 1);
  assert.equal(workerB.length, 1);
  assert.notEqual(workerA[0].participantId, workerB[0].participantId, "a participant item was claimed by both workers");
  const oldClaims = [...workerA, ...workerB].sort((a, b) => a.participantId.localeCompare(b.participantId));
  assert.equal(new Set(oldClaims.map((claim) => claim.participantId)).size, 2);
  console.log("PASS: two independent PostgreSQL sessions claimed disjoint participant items");

  const staleClaim = oldClaims[0];
  const oldLockToken = lockToken;
  await delay(5_500);
  await psql(`update public.participant_auto_refresh_job_lock set lease_expires_at = clock_timestamp() - interval '1 second' `
    + `where singleton and lock_token = '${oldLockToken}'::uuid`);
  lockToken = one(await workerSql("select lock_token::text from public.claim_participant_auto_refresh_job(300)"), "recovered global lease");
  assert.equal(one(await workerSql(`select job_id::text from public.start_or_resume_participant_auto_refresh_job('${lockToken}'::uuid, 'admin', '${dedupeA}')`), "resumed job"), jobId);
  assert.equal(await psql(`select count(*)::text from public.participant_auto_refresh_job_items where job_id = '${jobId}'::uuid `
    + "and status = 'pending' and claim_token is null"), "2", "expired items were not returned to the queue");
  const replacement = parseClaim(one(await workerSql(`select participant_id::text || '|' || item_id::text || '|' || item_claim_token::text || '|' || attempt_count::text `
    + `from public.claim_participant_auto_refresh_job_batch('${jobId}'::uuid, '${lockToken}'::uuid, 1, 5)`), "recovered item"));
  assert.equal(replacement.participantId, staleClaim.participantId);
  console.log("PASS: worker exit plus expired leases resumed the job and reclaimed the abandoned item");

  const fixture = fixtures.find((candidate) => candidate.id === replacement.participantId);
  assert.ok(fixture);
  const [claimStatus, fetchToken, profileRevision, claimedUrl] = one(await workerSql(`select claim_status || '|' || claim_token::text || '|' || profile_revision::text || '|' || profile_url `
    + `from public.claim_participant_auto_fetch('${fixture.id}'::uuid)`), "profile claim").split("|");
  assert.equal(claimStatus, "claimed");
  assert.equal(claimedUrl, fixture.profileUrl);
  assert.equal(one(await workerSql(`select result_status || '|' || item_status from public.record_participant_auto_refresh_job_result(`
    + `'${jobId}'::uuid, '${lockToken}'::uuid, '${replacement.itemId}'::uuid, '${replacement.claimToken}'::uuid, `
    + `'${fixture.id}'::uuid, '${fixture.profileUrl}', '${fetchToken}'::uuid, ${profileRevision}, 'ok', '[]'::jsonb, `
    + `'newer-worker-snapshot', 'race-test', null, true, true, null)`), "new result"), "ok|saved");
  assert.equal(one(await workerSql(`select result_status from public.record_participant_auto_refresh_job_result(`
    + `'${jobId}'::uuid, '${oldLockToken}'::uuid, '${staleClaim.itemId}'::uuid, '${staleClaim.claimToken}'::uuid, `
    + `'${fixture.id}'::uuid, '${fixture.profileUrl}', gen_random_uuid(), 1, 'ok', '[]'::jsonb, 'stale-worker-snapshot', `
    + `'race-test', null, true, true, null)`), "stale worker result"), "stale_job");
  assert.equal(await psql(`select snapshot_id from public.participant_auto_progress where participant_id = '${fixture.id}'::uuid`), "newer-worker-snapshot");
  assert.equal(await psql(`select status from public.participant_auto_refresh_job_items where id = '${replacement.itemId}'::uuid`), "saved");
  console.log("PASS: stale worker completion could not overwrite the newer snapshot or item result");

  const retry = parseClaim(one(await workerSql(`select participant_id::text || '|' || item_id::text || '|' || item_claim_token::text || '|' || attempt_count::text `
    + `from public.claim_participant_auto_refresh_job_batch('${jobId}'::uuid, '${lockToken}'::uuid, 1, 5)`), "retry item"));
  assert.notEqual(retry.participantId, replacement.participantId);
  assert.equal(one(await workerSql(`select item_status from public.finish_participant_auto_refresh_job_item('${jobId}'::uuid, '${lockToken}'::uuid, `
    + `'${retry.itemId}'::uuid, '${retry.claimToken}'::uuid, 'pending', 'timeout', 3)`), "scheduled retry"), "pending");
  assert.equal(rows(await workerSql(`select participant_id::text from public.claim_participant_auto_refresh_job_batch('${jobId}'::uuid, '${lockToken}'::uuid, 1, 5)`)).length, 0);
  await delay(3_200);
  const retryAgain = parseClaim(one(await workerSql(`select participant_id::text || '|' || item_id::text || '|' || item_claim_token::text || '|' || attempt_count::text `
    + `from public.claim_participant_auto_refresh_job_batch('${jobId}'::uuid, '${lockToken}'::uuid, 1, 5)`), "due retry"));
  assert.equal(retryAgain.participantId, retry.participantId);
  assert.ok(retryAgain.attempt > retry.attempt);
  assert.equal(one(await workerSql(`select item_status || '|' || job_status from public.finish_participant_auto_refresh_job_item('${jobId}'::uuid, '${lockToken}'::uuid, `
    + `'${retryAgain.itemId}'::uuid, '${retryAgain.claimToken}'::uuid, 'failed', 'test_worker_failure', null)`), "terminal failure"), "failed|partial");
  console.log("PASS: delayed retry was unavailable before due time; terminal failure made the job partial");
} finally {
  try {
    if (lockToken) await workerSql(`select public.release_participant_auto_refresh_job('${lockToken}'::uuid)`);
    await psql(`delete from public.participant_auto_refresh_jobs where dedupe_key like '${prefix}-%'`);
    await psql(`delete from public.participant_auto_progress where participant_id in `
      + `(select id from public.participants where participant_key like '${prefix}-%')`);
    await psql(`delete from public.participants where participant_key like '${prefix}-%'`);
    if (fixtureCount) assert.equal(await psql(`select count(*)::text from public.participants where participant_key like '${prefix}-%'`), "0");
    console.log("PASS: test participants and jobs were cleaned up");
  } catch {
    console.error("FAIL: isolated fixture cleanup did not complete");
    process.exitCode = 1;
  }
}

#!/usr/bin/env node
/**
 * Real multi-session concurrency checks for the badge-sync apply/rollback path.
 *
 * What it proves, with genuinely independent PostgreSQL sessions:
 *   1. Two concurrent applies of the same run with different request ids: the
 *      second waits on the run row, then replays the stored result. The
 *      participant is written exactly once (one audit event, one ledger row).
 *   2. Two concurrent applies of the same run with the same request id: both
 *      observe the same stored result; no duplicate audit or ledger row.
 *   3. Two independent runs touching the same participant: exactly one applies;
 *      the stale run is rejected with SQLSTATE 40001 and leaves no write.
 *   4. Same-total but different Skill/Arcade split race: exactly one applies;
 *      the other is rejected with SQLSTATE 40001 and leaves no write.
 *   5. Concurrent apply and rollback, in both directions: the later operation
 *      waits on the participant row lock and is rejected atomically.
 *   6. Two simultaneous rollback requests for one run: the second replays the
 *      first stored result; rollback audit and ledger rows are not duplicated.
 *   7. Duplicate apply request id across two independent runs/sessions: one
 *      applies, the other is rejected with SQLSTATE 22023 before any write.
 *   8. Duplicate rollback request id across two independent runs/sessions: one
 *      rolls back, the other is rejected with SQLSTATE 22023 and its partial
 *      write is rolled back.
 *
 * Safety:
 *   - Never connects to a remote host. The database is reached only through
 *     `docker exec` into a local Supabase container named `supabase_db_<id>`.
 *   - The container name is derived from supabase/config.toml, or supplied via
 *     BADGE_SYNC_TEST_DB_CONTAINER, and must match `supabase_db_<local-id>`.
 *   - Fixtures use random UUIDs and are deleted afterwards.
 *   - Refuses to run unless `docker info` succeeds and the container exists.
 *
 * Usage:
 *   npx supabase start
 *   node scripts/test-badge-sync-concurrency.mjs
 *
 * Optional:
 *   BADGE_SYNC_TEST_DB_CONTAINER=supabase_db_<project-id> \
 *     node scripts/test-badge-sync-concurrency.mjs
 *
 * The script does not apply migrations and does not touch a linked/production
 * project. It expects the current migrations to already be applied locally.
 */
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const CONTAINER_PATTERN = /^supabase_db_[a-z0-9-]+$/;
const SESSION_PREFIX = "badge-sync-concurrency";

function parseProjectId(configText) {
  const matches = [...configText.matchAll(/^\s*project_id\s*=\s*["']([^"']+)["']\s*$/gm)];
  if (matches.length !== 1) throw new Error("supabase/config.toml must define exactly one project_id.");
  return matches[0][1];
}

function containerName() {
  const override = process.env.BADGE_SYNC_TEST_DB_CONTAINER;
  if (override) {
    if (!CONTAINER_PATTERN.test(override)) {
      throw new Error("BADGE_SYNC_TEST_DB_CONTAINER must look like supabase_db_<local-project>.");
    }
    return override;
  }
  const configText = readFileSync(resolve(projectRoot, "supabase", "config.toml"), "utf8");
  return `supabase_db_${parseProjectId(configText)}`;
}

const container = containerName();
const psqlArgs = [
  "exec", "-i", container,
  "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1",
  "-U", "postgres", "-d", "postgres",
];

async function preflight() {
  try {
    await execFileAsync("docker", ["info"], { encoding: "utf8" });
  } catch {
    throw new Error("Docker is not available. Start Docker Desktop and `npx supabase start` first.");
  }
  try {
    await execFileAsync("docker", ["inspect", container], { encoding: "utf8" });
  } catch {
    throw new Error(`Local database container ${container} was not found. Run \`npx supabase start\` first.`);
  }
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function collect(child) {
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const doneRaw = new Promise((resolvePromise) => {
    child.on("error", (error) => {
      resolvePromise({ code: -1, stdout, stderr: `${stderr}\n${String(error)}`.trim() });
    });
    child.on("close", (code) => {
      resolvePromise({ code, stdout, stderr });
    });
  });
  return {
    doneRaw,
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

function startPsql(sql) {
  const child = spawn("docker", psqlArgs, { stdio: ["pipe", "pipe", "pipe"] });
  const output = collect(child);
  child.stdin.end(sql);
  return output;
}

async function runPsql(sql, label = "psql") {
  const result = await startPsql(sql).doneRaw;
  if (result.code !== 0) {
    throw new Error(`${label}: ${result.stderr.trim() || `psql exited with code ${result.code}`}`);
  }
  return result.stdout.trim();
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlState(stderr) {
  const match = stderr.match(/ERROR:\s+([0-9A-Z]{5}):/);
  return match ? match[1] : null;
}

function assertEqual(actual, expected, label) {
  if (String(actual) !== String(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
  }
}

function firstPayloadLine(output) {
  return output.split(/\r?\n/).map((line) => line.trim()).find((line) => line.startsWith("{")) ?? "";
}

function assertPayload(label, output, expectedRequestId, expectedStatus) {
  const line = firstPayloadLine(output);
  if (!line) throw new Error(`${label}: no JSON result was returned. Output: ${output}`);
  let payload;
  try {
    payload = JSON.parse(line);
  } catch {
    throw new Error(`${label}: result was not valid JSON: ${line}`);
  }
  assertEqual(payload.status, expectedStatus, `${label} status`);
  if (expectedRequestId) assertEqual(payload.request_id, expectedRequestId, `${label} request_id`);
  return payload;
}

async function waitForLock(applicationName, label) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const waiting = Number(await runPsql(`
select count(*) from pg_stat_activity
where application_name = ${sqlLiteral(applicationName)}
  and wait_event_type = 'Lock';
`));
    if (waiting > 0) return;
    await delay(100);
  }
  const diagnostic = await runPsql(`
select coalesce(string_agg(
  application_name || ':' || state || ':' ||
  coalesce(wait_event_type, '-') || ':' || coalesce(wait_event, '-'),
  ', ' order by application_name
), 'none')
from pg_stat_activity
where application_name like ${sqlLiteral(`${SESSION_PREFIX}%`)};
`);
  throw new Error(`${label}: session ${applicationName} never waited on a lock. Activity: ${diagnostic}`);
}

const ADMIN_ID = randomUUID();
const participants = Array.from({ length: 12 }, (_, index) => ({
  id: randomUUID(),
  key: `badge-concurrency-${index}-${randomUUID().replaceAll("-", "")}`,
  displayName: `Concurrency Participant ${index + 1}`,
}));
const createdRunIds = new Set();

function participant(index) {
  return participants[index];
}

async function seedFixtures() {
  const participantValues = participants
    .map((item) => `  (${sqlLiteral(item.id)}, ${sqlLiteral(item.key)}, ${sqlLiteral(item.displayName)}, 'registered', 0, null, null)`)
    .join(",\n");
  await runPsql(`
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  ${sqlLiteral(ADMIN_ID)}, 'authenticated', 'authenticated',
  ${sqlLiteral(`badge-concurrency-${ADMIN_ID}@example.test`)}, '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
);
insert into public.admin_users (user_id) values (${sqlLiteral(ADMIN_ID)});
insert into public.participants (
  id, participant_key, display_name, registration_status,
  verified_badge_count, skill_badge_count, arcade_game_badge_count
) values
${participantValues};
`);
}

async function cleanup() {
  if (createdRunIds.size < 1) return;
  const runIds = [...createdRunIds].map(sqlLiteral).join(", ");
  const participantIds = participants.map((item) => sqlLiteral(item.id)).join(", ");
  await runPsql(`
delete from public.badge_sync_operation_ledger where run_id in (${runIds});
delete from public.badge_sync_participant_staging where run_id in (${runIds});
delete from public.badge_sync_runs where id in (${runIds});
delete from public.participant_audit_events where participant_id in (${participantIds});
delete from public.participants where id in (${participantIds});
delete from public.admin_users where user_id = ${sqlLiteral(ADMIN_ID)};
delete from auth.users where id = ${sqlLiteral(ADMIN_ID)};
`);
}

async function getParticipantState(participantId) {
  const output = await runPsql(`
select verified_badge_count::text
  || '|' || coalesce(to_char(last_verified_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), '')
  || '|' || coalesce(verification_source, '')
from public.participants
where id = ${sqlLiteral(participantId)}::uuid;
`);
  const [total, lastVerifiedAt, source] = output.split("|");
  return {
    total: Number(total),
    lastVerifiedAt: lastVerifiedAt || null,
    source: source || null,
  };
}

async function getParticipantSplit(participantId) {
  const output = await runPsql(`
select coalesce(skill_badge_count::text, 'null') || '|' || coalesce(arcade_game_badge_count::text, 'null')
from public.participants
where id = ${sqlLiteral(participantId)}::uuid;
`);
  return output;
}

async function getRunState(runId) {
  const output = await runPsql(`
select status
  || '|' || coalesce(apply_request_id::text, '')
  || '|' || coalesce(rollback_request_id::text, '')
from public.badge_sync_runs
where id = ${sqlLiteral(runId)}::uuid;
`);
  const [status, applyRequestId, rollbackRequestId] = output.split("|");
  return { status, applyRequestId, rollbackRequestId };
}

async function auditEvents(participantId) {
  const output = await runPsql(`
select coalesce(jsonb_agg(jsonb_build_object(
  'event_type', event_type,
  'previous', previous_badge_count,
  'new', new_badge_count
) order by created_at, id), '[]'::jsonb)
from public.participant_audit_events
where participant_id = ${sqlLiteral(participantId)}::uuid;
`);
  return JSON.parse(output);
}

async function ledgerCount(runId, operationType) {
  return Number(await runPsql(`
select count(*) from public.badge_sync_operation_ledger
where run_id = ${sqlLiteral(runId)}::uuid
  and operation_type = ${sqlLiteral(operationType)};
`));
}

async function createApprovedRun(targetParticipant, target, label) {
  assertEqual(target.skill + target.arcade, target.total, `${label} fixture split`);
  const expected = await getParticipantState(targetParticipant.id);
  const payload = JSON.stringify([
    {
      row_number: 2,
      participant_id: targetParticipant.id,
      skill_count: target.skill,
      arcade_count: target.arcade,
      total_count: target.total,
      review_note: label,
      expected_total_count: expected.total,
      expected_last_verified_at: expected.lastVerifiedAt,
      expected_verification_source: expected.source,
    },
  ]);
  const created = await runPsql(`
begin;
set local role authenticated;
set local request.jwt.claim.sub = ${sqlLiteral(ADMIN_ID)};
select (snap #>> '{run,id}') || '|' || (snap #>> '{run,preview_fingerprint}')
from (
  select public.admin_create_classified_badge_sync_run(
    ${sqlLiteral(payload)}::jsonb,
    ${sqlLiteral(`${targetParticipant.key}.csv`)},
    null
  ) as snap
) as created;
commit;
`, `${label} create`);
  const [runId, fingerprint] = created.split("|");
  if (!runId || !fingerprint) throw new Error(`${label}: could not create a run (${created}).`);
  createdRunIds.add(runId);
  await runPsql(`
begin;
set local role authenticated;
set local request.jwt.claim.sub = ${sqlLiteral(ADMIN_ID)};
select public.admin_approve_badge_sync_run(${sqlLiteral(runId)}::uuid, ${sqlLiteral(fingerprint)});
commit;
`, `${label} approve`);
  return { runId, fingerprint, target };
}

function applySql(run, requestId, { sleepMs = 0, applicationName = "apply" } = {}) {
  return `\\set VERBOSITY verbose
begin;
set local role authenticated;
set local request.jwt.claim.sub = ${sqlLiteral(ADMIN_ID)};
set local application_name = ${sqlLiteral(`${SESSION_PREFIX}-${applicationName}`)};
select public.admin_apply_badge_sync_run(
  ${sqlLiteral(run.runId)}::uuid,
  ${sqlLiteral(run.fingerprint)},
  ${sqlLiteral(requestId)}::uuid
)::text;
${sleepMs > 0 ? `select pg_sleep(${(sleepMs / 1000).toFixed(3)});` : ""}
commit;
`;
}

function rollbackSql(run, requestId, { sleepMs = 0, applicationName = "rollback" } = {}) {
  return `\\set VERBOSITY verbose
begin;
set local role authenticated;
set local request.jwt.claim.sub = ${sqlLiteral(ADMIN_ID)};
set local application_name = ${sqlLiteral(`${SESSION_PREFIX}-${applicationName}`)};
select public.admin_rollback_badge_sync_run(
  ${sqlLiteral(run.runId)}::uuid,
  ${sqlLiteral(requestId)}::uuid
)::text;
${sleepMs > 0 ? `select pg_sleep(${(sleepMs / 1000).toFixed(3)});` : ""}
commit;
`;
}

function startApply(run, requestId, options) {
  return startPsql(applySql(run, requestId, options));
}

function startRollback(run, requestId, options) {
  return startPsql(rollbackSql(run, requestId, options));
}

function applicationName(options) {
  return `${SESSION_PREFIX}-${options.applicationName}`;
}

async function applyAndCommit(run, label) {
  const requestId = randomUUID();
  const output = await runPsql(applySql(run, requestId), `${label} apply`);
  assertPayload(`${label} apply`, output, requestId, "applied");
  return requestId;
}

async function verifyParticipantState(targetParticipant, expected, label) {
  const state = await getParticipantState(targetParticipant.id);
  assertEqual(state.total, expected.total, `${label} total`);
  if (Object.prototype.hasOwnProperty.call(expected, "lastVerifiedAt")) {
    assertEqual(state.lastVerifiedAt ?? "", expected.lastVerifiedAt ?? "", `${label} last_verified_at`);
  }
  if (Object.prototype.hasOwnProperty.call(expected, "source")) {
    assertEqual(state.source ?? "", expected.source ?? "", `${label} source`);
  }
  assertEqual(
    await getParticipantSplit(targetParticipant.id),
    `${expected.skill ?? "null"}|${expected.arcade ?? "null"}`,
    `${label} split`,
  );
}

async function verifySingleWrite(label, runId, participantId, requestId) {
  const state = await getRunState(runId);
  assertEqual(state.status, "applied", `${label} run status`);
  assertEqual(state.applyRequestId, requestId, `${label} stored request id`);
  assertEqual(await ledgerCount(runId, "apply"), 1, `${label} apply ledger rows`);
  const events = await auditEvents(participantId);
  assertEqual(events.length, 1, `${label} audit event count`);
  assertEqual(events[0].new, 3, `${label} audit new total`);
}

async function concurrentAppliesDifferentRequestIds() {
  const targetParticipant = participant(0);
  const run = await createApprovedRun(targetParticipant, { skill: 2, arcade: 1, total: 3 }, "Concurrency different request ids");
  const requestA = randomUUID();
  const requestB = randomUUID();
  const optionsA = { sleepMs: 4000, applicationName: "diff-request-a" };
  const optionsB = { applicationName: "diff-request-b" };
  const sessionA = startApply(run, requestA, optionsA);
  await delay(1500);
  const sessionB = startApply(run, requestB, optionsB);
  await waitForLock(applicationName(optionsB), "different request ids");
  const [resultA, resultB] = await Promise.all([sessionA.doneRaw, sessionB.doneRaw]);
  if (resultA.code !== 0) throw new Error(`different request ids session A failed: ${resultA.stderr}`);
  if (resultB.code !== 0) throw new Error(`different request ids session B failed: ${resultB.stderr}`);
  const payloadA = assertPayload("different request ids session A", resultA.stdout, requestA, "applied");
  const payloadB = assertPayload("different request ids session B", resultB.stdout, requestA, "applied");
  assertEqual(JSON.stringify(payloadB), JSON.stringify(payloadA), "different request ids replay payload");
  await verifySingleWrite("different request ids", run.runId, targetParticipant.id, requestA);
  process.stdout.write("PASS: concurrent applies with different request ids wrote once and replayed the stored result.\n");
}

async function concurrentAppliesSameRequestId() {
  const targetParticipant = participant(1);
  const run = await createApprovedRun(targetParticipant, { skill: 2, arcade: 1, total: 3 }, "Concurrency same request id");
  const request = randomUUID();
  const optionsA = { sleepMs: 4000, applicationName: "same-request-a" };
  const optionsB = { applicationName: "same-request-b" };
  const sessionA = startApply(run, request, optionsA);
  await delay(1500);
  const sessionB = startApply(run, request, optionsB);
  await waitForLock(applicationName(optionsB), "same request id");
  const [resultA, resultB] = await Promise.all([sessionA.doneRaw, sessionB.doneRaw]);
  if (resultA.code !== 0) throw new Error(`same request id session A failed: ${resultA.stderr}`);
  if (resultB.code !== 0) throw new Error(`same request id session B failed: ${resultB.stderr}`);
  const payloadA = assertPayload("same request id session A", resultA.stdout, request, "applied");
  const payloadB = assertPayload("same request id session B", resultB.stdout, request, "applied");
  assertEqual(JSON.stringify(payloadB), JSON.stringify(payloadA), "same request id replay payload");
  await verifySingleWrite("same request id", run.runId, targetParticipant.id, request);
  process.stdout.write("PASS: concurrent applies with the same request id wrote once and did not duplicate audit or ledger rows.\n");
}

async function independentRunsSameParticipant() {
  const targetParticipant = participant(2);
  const runA = await createApprovedRun(targetParticipant, { skill: 2, arcade: 1, total: 3 }, "Same participant run A");
  const runB = await createApprovedRun(targetParticipant, { skill: 3, arcade: 1, total: 4 }, "Same participant run B");
  const requestA = randomUUID();
  const requestB = randomUUID();
  const optionsA = { sleepMs: 4000, applicationName: "same-participant-a" };
  const optionsB = { applicationName: "same-participant-b" };
  const sessionA = startApply(runA, requestA, optionsA);
  await delay(1500);
  const sessionB = startApply(runB, requestB, optionsB);
  await waitForLock(applicationName(optionsB), "same participant");
  const [resultA, resultB] = await Promise.all([sessionA.doneRaw, sessionB.doneRaw]);
  if (resultA.code !== 0) throw new Error(`same participant run A failed: ${resultA.stderr}`);
  assertPayload("same participant run A", resultA.stdout, requestA, "applied");
  assertEqual(sqlState(resultB.stderr), "40001", "same participant stale run SQLSTATE");
  await verifyParticipantState(targetParticipant, { total: 3, skill: 2, arcade: 1 }, "same participant");
  const stateA = await getRunState(runA.runId);
  const stateB = await getRunState(runB.runId);
  assertEqual(stateA.status, "applied", "same participant run A status");
  assertEqual(stateB.status, "approved", "same participant run B status");
  assertEqual(stateB.applyRequestId, "", "same participant run B request id");
  assertEqual(await ledgerCount(runA.runId, "apply"), 1, "same participant run A ledger");
  assertEqual(await ledgerCount(runB.runId, "apply"), 0, "same participant run B ledger");
  assertEqual((await auditEvents(targetParticipant.id)).length, 1, "same participant audit count");
  process.stdout.write("PASS: two independent runs on one participant serialized; the stale run failed with 40001 and wrote nothing.\n");
}

async function sameTotalSplitRace() {
  const targetParticipant = participant(3);
  const runA = await createApprovedRun(targetParticipant, { skill: 2, arcade: 1, total: 3 }, "Same-total split run A");
  const runB = await createApprovedRun(targetParticipant, { skill: 1, arcade: 2, total: 3 }, "Same-total split run B");
  const requestA = randomUUID();
  const requestB = randomUUID();
  const optionsA = { sleepMs: 4000, applicationName: "split-race-a" };
  const optionsB = { applicationName: "split-race-b" };
  const sessionA = startApply(runA, requestA, optionsA);
  await delay(1500);
  const sessionB = startApply(runB, requestB, optionsB);
  await waitForLock(applicationName(optionsB), "same-total split race");
  const [resultA, resultB] = await Promise.all([sessionA.doneRaw, sessionB.doneRaw]);
  if (resultA.code !== 0) throw new Error(`same-total split run A failed: ${resultA.stderr}`);
  assertPayload("same-total split run A", resultA.stdout, requestA, "applied");
  assertEqual(sqlState(resultB.stderr), "40001", "same-total split SQLSTATE");
  await verifyParticipantState(targetParticipant, { total: 3, skill: 2, arcade: 1 }, "same-total split");
  const stateB = await getRunState(runB.runId);
  assertEqual(stateB.status, "approved", "same-total split run B status");
  assertEqual(stateB.applyRequestId, "", "same-total split run B request id");
  assertEqual(await ledgerCount(runA.runId, "apply"), 1, "same-total split run A ledger");
  assertEqual(await ledgerCount(runB.runId, "apply"), 0, "same-total split run B ledger");
  assertEqual((await auditEvents(targetParticipant.id)).length, 1, "same-total split audit count");
  process.stdout.write("PASS: same-total Skill/Arcade split race rejected with 40001; only the winning split was written.\n");
}

async function applyWaitsForRollback() {
  const targetParticipant = participant(4);
  const runA = await createApprovedRun(targetParticipant, { skill: 2, arcade: 1, total: 3 }, "Apply waits for rollback run A");
  const requestA = await applyAndCommit(runA, "Apply waits for rollback");
  const runB = await createApprovedRun(targetParticipant, { skill: 3, arcade: 1, total: 4 }, "Apply waits for rollback run B");
  const rollbackRequest = randomUUID();
  const applyRequest = randomUUID();
  const optionsRollback = { sleepMs: 4000, applicationName: "apply-wait-rollback" };
  const optionsApply = { applicationName: "apply-wait-apply" };
  const sessionRollback = startRollback(runA, rollbackRequest, optionsRollback);
  await delay(1500);
  const sessionApply = startApply(runB, applyRequest, optionsApply);
  await waitForLock(applicationName(optionsApply), "apply waits for rollback");
  const [rollbackResult, applyResult] = await Promise.all([sessionRollback.doneRaw, sessionApply.doneRaw]);
  if (rollbackResult.code !== 0) throw new Error(`apply-waits rollback failed: ${rollbackResult.stderr}`);
  assertPayload("apply-waits rollback", rollbackResult.stdout, rollbackRequest, "rolled_back");
  assertEqual(sqlState(applyResult.stderr), "40001", "apply-waits-for-rollback SQLSTATE");
  await verifyParticipantState(targetParticipant, { total: 0, skill: null, arcade: null, lastVerifiedAt: null, source: null }, "apply waits for rollback");
  const stateA = await getRunState(runA.runId);
  const stateB = await getRunState(runB.runId);
  assertEqual(stateA.status, "rolled_back", "apply waits run A status");
  assertEqual(stateA.applyRequestId, requestA, "apply waits run A apply request id");
  assertEqual(stateA.rollbackRequestId, rollbackRequest, "apply waits run A rollback request id");
  assertEqual(stateB.status, "approved", "apply waits run B status");
  assertEqual(stateB.applyRequestId, "", "apply waits run B request id");
  const events = await auditEvents(targetParticipant.id);
  assertEqual(events.length, 2, "apply waits audit count");
  assertEqual(events.filter((event) => event.new === 3).length, 1, "apply waits apply audit");
  assertEqual(events.filter((event) => event.new === 0).length, 1, "apply waits rollback audit");
  assertEqual(await ledgerCount(runA.runId, "apply"), 1, "apply waits run A apply ledger");
  assertEqual(await ledgerCount(runA.runId, "rollback"), 1, "apply waits run A rollback ledger");
  assertEqual(await ledgerCount(runB.runId, "apply"), 0, "apply waits run B ledger");
  process.stdout.write("PASS: apply waiting on a rollback lock was rejected with 40001; rollback restored the snapshot once.\n");
}

async function rollbackWaitsForApply() {
  const targetParticipant = participant(5);
  const runA = await createApprovedRun(targetParticipant, { skill: 2, arcade: 1, total: 3 }, "Rollback waits for apply run A");
  await applyAndCommit(runA, "Rollback waits for apply");
  const runB = await createApprovedRun(targetParticipant, { skill: 3, arcade: 1, total: 4 }, "Rollback waits for apply run B");
  const applyRequest = randomUUID();
  const rollbackRequest = randomUUID();
  const optionsApply = { sleepMs: 4000, applicationName: "rollback-wait-apply" };
  const optionsRollback = { applicationName: "rollback-wait-rollback" };
  const sessionApply = startApply(runB, applyRequest, optionsApply);
  await delay(1500);
  const sessionRollback = startRollback(runA, rollbackRequest, optionsRollback);
  await waitForLock(applicationName(optionsRollback), "rollback waits for apply");
  const [applyResult, rollbackResult] = await Promise.all([sessionApply.doneRaw, sessionRollback.doneRaw]);
  if (applyResult.code !== 0) throw new Error(`rollback-waits apply failed: ${applyResult.stderr}`);
  assertPayload("rollback-waits apply", applyResult.stdout, applyRequest, "applied");
  assertEqual(sqlState(rollbackResult.stderr), "40001", "rollback-waits-for-apply SQLSTATE");
  await verifyParticipantState(targetParticipant, { total: 4, skill: 3, arcade: 1 }, "rollback waits for apply");
  const stateA = await getRunState(runA.runId);
  const stateB = await getRunState(runB.runId);
  assertEqual(stateA.status, "applied", "rollback waits run A status");
  assertEqual(stateA.rollbackRequestId, "", "rollback waits run A rollback request id");
  assertEqual(stateB.status, "applied", "rollback waits run B status");
  assertEqual(stateB.applyRequestId, applyRequest, "rollback waits run B request id");
  const events = await auditEvents(targetParticipant.id);
  assertEqual(events.length, 2, "rollback waits audit count");
  assertEqual(events.filter((event) => event.new === 3).length, 1, "rollback waits first apply audit");
  assertEqual(events.filter((event) => event.new === 4).length, 1, "rollback waits second apply audit");
  assertEqual(await ledgerCount(runA.runId, "apply"), 1, "rollback waits run A apply ledger");
  assertEqual(await ledgerCount(runA.runId, "rollback"), 0, "rollback waits run A rollback ledger");
  assertEqual(await ledgerCount(runB.runId, "apply"), 1, "rollback waits run B apply ledger");
  process.stdout.write("PASS: rollback waiting on an apply lock was rejected with 40001 and did not overwrite the later run.\n");
}

async function simultaneousRollbacks() {
  const targetParticipant = participant(6);
  const run = await createApprovedRun(targetParticipant, { skill: 2, arcade: 1, total: 3 }, "Two rollbacks");
  await applyAndCommit(run, "Two rollbacks");
  const requestFirst = randomUUID();
  const requestSecond = randomUUID();
  const optionsFirst = { sleepMs: 4000, applicationName: "two-rollbacks-first" };
  const optionsSecond = { applicationName: "two-rollbacks-second" };
  const sessionFirst = startRollback(run, requestFirst, optionsFirst);
  await delay(1500);
  const sessionSecond = startRollback(run, requestSecond, optionsSecond);
  await waitForLock(applicationName(optionsSecond), "two simultaneous rollbacks");
  const [resultFirst, resultSecond] = await Promise.all([sessionFirst.doneRaw, sessionSecond.doneRaw]);
  if (resultFirst.code !== 0) throw new Error(`two rollbacks first failed: ${resultFirst.stderr}`);
  if (resultSecond.code !== 0) throw new Error(`two rollbacks second failed: ${resultSecond.stderr}`);
  const payloadFirst = assertPayload("two rollbacks first", resultFirst.stdout, requestFirst, "rolled_back");
  const payloadSecond = assertPayload("two rollbacks second", resultSecond.stdout, requestFirst, "rolled_back");
  assertEqual(JSON.stringify(payloadSecond), JSON.stringify(payloadFirst), "two rollbacks replay payload");
  await verifyParticipantState(targetParticipant, { total: 0, skill: null, arcade: null, lastVerifiedAt: null, source: null }, "two rollbacks");
  const state = await getRunState(run.runId);
  assertEqual(state.status, "rolled_back", "two rollbacks run status");
  assertEqual(state.rollbackRequestId, requestFirst, "two rollbacks stored request id");
  const events = await auditEvents(targetParticipant.id);
  assertEqual(events.length, 2, "two rollbacks audit count");
  assertEqual(events.filter((event) => event.new === 3).length, 1, "two rollbacks apply audit");
  assertEqual(events.filter((event) => event.new === 0).length, 1, "two rollbacks rollback audit");
  assertEqual(await ledgerCount(run.runId, "apply"), 1, "two rollbacks apply ledger");
  assertEqual(await ledgerCount(run.runId, "rollback"), 1, "two rollbacks rollback ledger");
  process.stdout.write("PASS: two simultaneous rollbacks replayed one stored result; audit and ledger rows were not duplicated.\n");
}

async function duplicateApplyRequestIdAcrossRuns() {
  const firstParticipant = participant(7);
  const secondParticipant = participant(8);
  const runA = await createApprovedRun(firstParticipant, { skill: 2, arcade: 1, total: 3 }, "Duplicate apply request A");
  const runB = await createApprovedRun(secondParticipant, { skill: 2, arcade: 1, total: 3 }, "Duplicate apply request B");
  const request = randomUUID();
  const optionsA = { sleepMs: 4000, applicationName: "duplicate-apply-a" };
  const optionsB = { applicationName: "duplicate-apply-b" };
  const sessionA = startApply(runA, request, optionsA);
  await delay(1500);
  const sessionB = startApply(runB, request, optionsB);
  await waitForLock(applicationName(optionsB), "duplicate apply request id");
  const [resultA, resultB] = await Promise.all([sessionA.doneRaw, sessionB.doneRaw]);
  if (resultA.code !== 0) throw new Error(`duplicate apply request A failed: ${resultA.stderr}`);
  assertPayload("duplicate apply request A", resultA.stdout, request, "applied");
  assertEqual(sqlState(resultB.stderr), "22023", "duplicate apply request SQLSTATE");
  await verifyParticipantState(firstParticipant, { total: 3, skill: 2, arcade: 1 }, "duplicate apply request first");
  await verifyParticipantState(secondParticipant, { total: 0, skill: null, arcade: null, lastVerifiedAt: null, source: null }, "duplicate apply request second");
  const stateA = await getRunState(runA.runId);
  const stateB = await getRunState(runB.runId);
  assertEqual(stateA.status, "applied", "duplicate apply request run A status");
  assertEqual(stateA.applyRequestId, request, "duplicate apply request run A request id");
  assertEqual(stateB.status, "approved", "duplicate apply request run B status");
  assertEqual(stateB.applyRequestId, "", "duplicate apply request run B request id");
  assertEqual((await auditEvents(firstParticipant.id)).length, 1, "duplicate apply request first audit");
  assertEqual((await auditEvents(secondParticipant.id)).length, 0, "duplicate apply request second audit");
  assertEqual(await ledgerCount(runA.runId, "apply"), 1, "duplicate apply request run A ledger");
  assertEqual(await ledgerCount(runB.runId, "apply"), 0, "duplicate apply request run B ledger");
  process.stdout.write("PASS: duplicate apply request id across independent sessions was rejected with 22023 before any write.\n");
}

async function duplicateRollbackRequestIdAcrossRuns() {
  const firstParticipant = participant(9);
  const secondParticipant = participant(10);
  const runA = await createApprovedRun(firstParticipant, { skill: 2, arcade: 1, total: 3 }, "Duplicate rollback request A");
  const runB = await createApprovedRun(secondParticipant, { skill: 2, arcade: 1, total: 3 }, "Duplicate rollback request B");
  await applyAndCommit(runA, "Duplicate rollback request");
  await applyAndCommit(runB, "Duplicate rollback request");
  const request = randomUUID();
  const optionsA = { sleepMs: 4000, applicationName: "duplicate-rollback-a" };
  const optionsB = { applicationName: "duplicate-rollback-b" };
  const sessionA = startRollback(runA, request, optionsA);
  await delay(1500);
  const sessionB = startRollback(runB, request, optionsB);
  await waitForLock(applicationName(optionsB), "duplicate rollback request id");
  const [resultA, resultB] = await Promise.all([sessionA.doneRaw, sessionB.doneRaw]);
  if (resultA.code !== 0) throw new Error(`duplicate rollback request A failed: ${resultA.stderr}`);
  assertPayload("duplicate rollback request A", resultA.stdout, request, "rolled_back");
  assertEqual(sqlState(resultB.stderr), "22023", "duplicate rollback request SQLSTATE");
  await verifyParticipantState(firstParticipant, { total: 0, skill: null, arcade: null, lastVerifiedAt: null, source: null }, "duplicate rollback request first");
  await verifyParticipantState(secondParticipant, { total: 3, skill: 2, arcade: 1 }, "duplicate rollback request second");
  const stateA = await getRunState(runA.runId);
  const stateB = await getRunState(runB.runId);
  assertEqual(stateA.status, "rolled_back", "duplicate rollback request run A status");
  assertEqual(stateA.rollbackRequestId, request, "duplicate rollback request run A request id");
  assertEqual(stateB.status, "applied", "duplicate rollback request run B status");
  assertEqual(stateB.rollbackRequestId, "", "duplicate rollback request run B request id");
  const eventsFirst = await auditEvents(firstParticipant.id);
  assertEqual(eventsFirst.length, 2, "duplicate rollback request first audit count");
  assertEqual(eventsFirst.filter((event) => event.new === 3).length, 1, "duplicate rollback request first apply audit");
  assertEqual(eventsFirst.filter((event) => event.new === 0).length, 1, "duplicate rollback request first rollback audit");
  assertEqual((await auditEvents(secondParticipant.id)).length, 1, "duplicate rollback request second audit count");
  assertEqual(await ledgerCount(runA.runId, "apply"), 1, "duplicate rollback request run A apply ledger");
  assertEqual(await ledgerCount(runA.runId, "rollback"), 1, "duplicate rollback request run A rollback ledger");
  assertEqual(await ledgerCount(runB.runId, "apply"), 1, "duplicate rollback request run B apply ledger");
  assertEqual(await ledgerCount(runB.runId, "rollback"), 0, "duplicate rollback request run B rollback ledger");
  process.stdout.write("PASS: duplicate rollback request id was rejected with 22023 and its partial rollback was rolled back atomically.\n");
}

await preflight();
await seedFixtures();
try {
  await concurrentAppliesDifferentRequestIds();
  await concurrentAppliesSameRequestId();
  await independentRunsSameParticipant();
  await sameTotalSplitRace();
  await applyWaitsForRollback();
  await rollbackWaitsForApply();
  await simultaneousRollbacks();
  await duplicateApplyRequestIdAcrossRuns();
  await duplicateRollbackRequestIdAcrossRuns();
  process.stdout.write("Badge sync concurrency suite passed.\n");
} finally {
  await cleanup().catch((error) => {
    process.stderr.write(`Cleanup warning: ${error.message}\n`);
  });
}

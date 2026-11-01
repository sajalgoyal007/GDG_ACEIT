begin;
select plan(22);

-- Keep this test's roster deterministic even if run on a non-empty disposable database.
update public.participants set registration_status = 'pending' where registration_status = 'registered';
set local request.jwt.claim.role = 'service_role';
select set_config('test.empty_lock',
  (select lock_token::text from public.claim_participant_auto_refresh_job(300)), true);
select set_config('test.empty_job',
  (select job_id::text from public.start_or_resume_participant_auto_refresh_job(
    current_setting('test.empty_lock')::uuid, 'admin', 'test:durable-empty-roster'
  )), true);
select is(
  (select job_status from public.start_or_resume_participant_auto_refresh_job(
    current_setting('test.empty_lock')::uuid, 'admin', 'test:durable-empty-roster'
  )),
  'completed',
  'an empty roster is explicitly completed without participant work'
);
select is(
  (select total_count from public.participant_auto_refresh_jobs where id = current_setting('test.empty_job')::uuid),
  0,
  'an empty roster records zero required participants'
);
select ok(
  (select is_complete
   from public.start_or_resume_participant_auto_refresh_job(
     current_setting('test.empty_lock')::uuid, 'admin', 'test:durable-empty-roster'
   ))
  and (select completed_at is not null from public.participant_auto_refresh_jobs where id = current_setting('test.empty_job')::uuid)
  and not exists (select 1 from public.participant_auto_refresh_job_items where job_id = current_setting('test.empty_job')::uuid),
  'an empty roster has a terminal timestamp and no phantom items'
);
select is(
  (select job_status from public.release_participant_auto_refresh_job(current_setting('test.empty_lock')::uuid)),
  'released',
  'empty roster execution releases its worker lock'
);

insert into public.participants (id, participant_key, display_name, profile_url, registration_status)
values
  ('00000000-0000-0000-0000-0000000000a1', 'durable-job-a', 'Durable Job A', 'https://skills.google/public_profiles/durable-a', 'registered'),
  ('00000000-0000-0000-0000-0000000000b1', 'durable-job-b', 'Durable Job B', 'https://skills.google/public_profiles/durable-b', 'registered'),
  ('00000000-0000-0000-0000-0000000000c1', 'durable-job-c', 'Durable Job C', 'https://skills.google/public_profiles/durable-c', 'registered');

select ok(
  not has_table_privilege('anon', 'public.participant_auto_refresh_jobs', 'select')
  and not has_table_privilege('authenticated', 'public.participant_auto_refresh_job_items', 'select'),
  'job state and participant work items are not directly readable by clients'
);
select ok(
  not has_table_privilege('anon', 'public.participant_auto_refresh_jobs', 'insert')
  and not has_table_privilege('authenticated', 'public.participant_auto_refresh_job_items', 'update'),
  'clients cannot write or mutate durable job state'
);
select ok(
  not has_function_privilege('anon', 'public.start_or_resume_participant_auto_refresh_job(uuid,text,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.claim_participant_auto_refresh_job_batch(uuid,uuid,integer,integer)', 'execute')
  and has_function_privilege('service_role', 'public.start_or_resume_participant_auto_refresh_job(uuid,text,text)', 'execute'),
  'only the service worker can start and claim durable work'
);

set local request.jwt.claim.role = 'service_role';
select set_config('test.durable_lock_old',
  (select lock_token::text from public.claim_participant_auto_refresh_job(300)), true);
select set_config('test.durable_job',
  (select job_id::text from public.start_or_resume_participant_auto_refresh_job(
    current_setting('test.durable_lock_old')::uuid, 'admin', 'test:durable-job-1'
  )), true);
select is(
  (select job_status from public.start_or_resume_participant_auto_refresh_job(
    current_setting('test.durable_lock_old')::uuid, 'admin', 'test:durable-job-1'
  )),
  'running',
  'a durable job is atomically created with a resumable pending roster'
);
select is(
  (select job_id::text from public.start_or_resume_participant_auto_refresh_job(
    current_setting('test.durable_lock_old')::uuid, 'admin', 'test:durable-job-1'
  )),
  current_setting('test.durable_job'),
  'duplicate triggers with the same idempotency key resume the same job'
);
select is(
  (select total_count from public.participant_auto_refresh_jobs where id = current_setting('test.durable_job')::uuid),
  3,
  'job creation snapshots the complete registered roster'
);

create temporary table durable_claims on commit drop as
select * from public.claim_participant_auto_refresh_job_batch(
  current_setting('test.durable_job')::uuid,
  current_setting('test.durable_lock_old')::uuid,
  2,
  120
);
select is((select count(*)::integer from durable_claims), 2, 'worker claims a bounded first batch');
create temporary table durable_claims_next on commit drop as
select * from public.claim_participant_auto_refresh_job_batch(
  current_setting('test.durable_job')::uuid,
  current_setting('test.durable_lock_old')::uuid,
  2,
  120
);
select is((select count(*)::integer from durable_claims_next), 1, 'next batch resumes remaining participants without duplicate claims');
select is(
  (select count(*)::integer from public.claim_participant_auto_refresh_job_batch(
    current_setting('test.durable_job')::uuid, current_setting('test.durable_lock_old')::uuid, 2, 120
  )),
  0,
  'active unexpired item leases prevent workers from claiming the same rows again'
);

select set_config('test.a_id', (select id::text from public.participants where participant_key = 'durable-job-a'), true);
select set_config('test.a_item', (select item_id::text from durable_claims where participant_id = current_setting('test.a_id')::uuid), true);
select set_config('test.a_item_token', (select item_claim_token::text from durable_claims where item_id = current_setting('test.a_item')::uuid), true);
select set_config('test.a_fetch_token', (select claim_token::text from public.claim_participant_auto_fetch(current_setting('test.a_id')::uuid)), true);
select is(
  (select item_status from public.record_participant_auto_refresh_job_result(
    current_setting('test.durable_job')::uuid, current_setting('test.durable_lock_old')::uuid,
    current_setting('test.a_item')::uuid, current_setting('test.a_item_token')::uuid,
    current_setting('test.a_id')::uuid, 'https://skills.google/public_profiles/durable-a',
    current_setting('test.a_fetch_token')::uuid, 1, 'ok', '[]'::jsonb,
    'durable-empty-snapshot', 'fixture-1', null, true, true, null
  )),
  'saved',
  'complete snapshots and job-item success are persisted atomically'
);

select set_config('test.b_id', (select id::text from public.participants where participant_key = 'durable-job-b'), true);
select set_config('test.b_item', (select item_id::text from durable_claims where participant_id = current_setting('test.b_id')::uuid), true);
select set_config('test.b_item_token', (select item_claim_token::text from durable_claims where item_id = current_setting('test.b_item')::uuid), true);
select set_config('test.b_fetch_token', (select claim_token::text from public.claim_participant_auto_fetch(current_setting('test.b_id')::uuid)), true);
select is(
  (select item_status from public.record_participant_auto_refresh_job_result(
    current_setting('test.durable_job')::uuid, current_setting('test.durable_lock_old')::uuid,
    current_setting('test.b_item')::uuid, current_setting('test.b_item_token')::uuid,
    current_setting('test.b_id')::uuid, 'https://skills.google/public_profiles/durable-b',
    current_setting('test.b_fetch_token')::uuid, 1, 'timeout', null, null, null, 'timeout', false, false, null
  )),
  'pending',
  'transient failures preserve prior snapshots and are resumable for a bounded retry'
);
select ok(
  (select saved_count = 1 and failed_count = 0 and status = 'running'
   from public.participant_auto_refresh_jobs where id = current_setting('test.durable_job')::uuid),
  'job counters distinguish saved work from retryable failures'
);

select set_config('test.c_id', (select id::text from public.participants where participant_key = 'durable-job-c'), true);
select set_config('test.c_item', (select item_id::text from durable_claims_next where participant_id = current_setting('test.c_id')::uuid), true);
select set_config('test.c_old_item_token', (select item_claim_token::text from durable_claims_next where item_id = current_setting('test.c_item')::uuid), true);
select is((select job_status from public.release_participant_auto_refresh_job(current_setting('test.durable_lock_old')::uuid)), 'released', 'worker releases its lease after a batch');
select set_config('test.durable_lock_new',
  (select lock_token::text from public.claim_participant_auto_refresh_job(300)), true);
select is(
  (select job_id::text from public.start_or_resume_participant_auto_refresh_job(
    current_setting('test.durable_lock_new')::uuid, 'admin', 'test:durable-job-1'
  )),
  current_setting('test.durable_job'),
  'a new worker resumes the existing incomplete job after lease recovery'
);
update public.participant_auto_refresh_job_items
set claim_expires_at = clock_timestamp() - interval '1 second'
where id = current_setting('test.c_item')::uuid;
update public.participant_auto_refresh_job_items
set next_attempt_at = clock_timestamp() - interval '1 second'
where id = current_setting('test.b_item')::uuid;
create temporary table durable_reclaimed on commit drop as
select * from public.claim_participant_auto_refresh_job_batch(
  current_setting('test.durable_job')::uuid, current_setting('test.durable_lock_new')::uuid, 8, 120
);
select is((select count(*)::integer from durable_reclaimed where participant_id = current_setting('test.c_id')::uuid), 1,
  'expired item leases are reclaimed for recovery');
select is((select count(*)::integer from durable_reclaimed where participant_id = current_setting('test.b_id')::uuid), 1,
  'a transient failure is reclaimed after its retry delay expires');
select set_config('test.c_new_item_token', (select item_claim_token::text from durable_reclaimed where participant_id = current_setting('test.c_id')::uuid), true);

select is(
  (select result_status from public.record_participant_auto_refresh_job_result(
    current_setting('test.durable_job')::uuid, current_setting('test.durable_lock_old')::uuid,
    current_setting('test.c_item')::uuid, current_setting('test.c_old_item_token')::uuid,
    current_setting('test.c_id')::uuid, 'https://skills.google/public_profiles/durable-c',
    gen_random_uuid(), 1, 'ok', '[]'::jsonb, 'stale-worker-snapshot', 'fixture-1', null, true, true, null
  )),
  'stale_job',
  'a stale worker token cannot persist a result after another worker recovers the job'
);
select is(
  (select count(*)::integer from public.participant_auto_progress where participant_id = current_setting('test.c_id')::uuid),
  0,
  'stale worker rejection leaves the participant snapshot untouched'
);

select * from finish();
rollback;

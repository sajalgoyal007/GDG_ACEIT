begin;
select plan(8);

select ok(
  not has_table_privilege('anon', 'public.participant_auto_refresh_job_lock', 'select')
  and not has_table_privilege('authenticated', 'public.participant_auto_refresh_job_lock', 'select'),
  'clients cannot read the Refresh All lock row'
);
select ok(
  not has_function_privilege('anon', 'public.claim_participant_auto_refresh_job(integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.claim_participant_auto_refresh_job(integer)', 'execute')
  and has_function_privilege('service_role', 'public.claim_participant_auto_refresh_job(integer)', 'execute'),
  'only the service worker can claim a Refresh All lock'
);
select ok(
  not has_function_privilege('anon', 'public.renew_participant_auto_refresh_job(uuid,integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.renew_participant_auto_refresh_job(uuid,integer)', 'execute')
  and has_function_privilege('service_role', 'public.renew_participant_auto_refresh_job(uuid,integer)', 'execute'),
  'only the service worker can renew a Refresh All lock'
);
select ok(
  not has_function_privilege('anon', 'public.release_participant_auto_refresh_job(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.release_participant_auto_refresh_job(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.release_participant_auto_refresh_job(uuid)', 'execute'),
  'only the service worker can release a Refresh All lock'
);

set local role service_role;
set local request.jwt.claim.role = 'service_role';
select set_config(
  'test.refresh_job_token',
  (select lock_token::text from public.claim_participant_auto_refresh_job(300)),
  true
);
select is(
  (select job_status from public.claim_participant_auto_refresh_job(300)),
  'busy',
  'an overlapping job receives busy while the durable lease is active'
);
select is(
  (select job_status from public.renew_participant_auto_refresh_job(current_setting('test.refresh_job_token')::uuid, 300)),
  'renewed',
  'only the current job token renews the lock lease'
);
select is(
  (select job_status from public.renew_participant_auto_refresh_job(gen_random_uuid(), 300)),
  'stale',
  'a stale job token cannot renew a newer lease'
);
select is(
  (select job_status from public.release_participant_auto_refresh_job(current_setting('test.refresh_job_token')::uuid)),
  'released',
  'the current job token releases the lock on completion'
);
select * from finish();
rollback;

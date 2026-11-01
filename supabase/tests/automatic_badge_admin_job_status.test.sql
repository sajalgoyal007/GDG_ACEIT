begin;
select plan(4);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-4000-8000-000000000241', 'authenticated', 'authenticated', 'job-status-admin@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-4000-8000-000000000242', 'authenticated', 'authenticated', 'job-status-user@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());
insert into public.admin_users (user_id) values ('00000000-0000-4000-8000-000000000241');
insert into public.participant_auto_refresh_jobs (
  id, dedupe_key, trigger_source, status, total_count, fetched_count, validated_count,
  saved_count, unchanged_count, failed_count, skipped_count, error_category
) values (
  '00000000-0000-4000-8000-000000000243', 'test:admin-job-status', 'scheduled', 'partial',
  5, 4, 3, 2, 0, 1, 0, 'timeout'
);

select ok(
  has_function_privilege('authenticated', 'public.admin_get_latest_auto_progress_job()', 'execute')
  and not has_function_privilege('anon', 'public.admin_get_latest_auto_progress_job()', 'execute'),
  'only authenticated callers may invoke the admin job summary RPC'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000242';
select throws_ok(
  $$select * from public.admin_get_latest_auto_progress_job()$$,
  '42501', 'Admin access required',
  'authenticated non-admin users cannot read job status'
);

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000241';
select is(
  (select job_status from public.admin_get_latest_auto_progress_job()),
  'partial',
  'an administrator can read the latest durable job status'
);
select is(
  (select (total_count, fetched_count, validated_count, saved_count, failed_count, error_category)::text
   from public.admin_get_latest_auto_progress_job()),
  '(5,4,3,2,1,timeout)',
  'the operational summary exposes counts and a bounded error category without item identities'
);

select * from finish();
rollback;

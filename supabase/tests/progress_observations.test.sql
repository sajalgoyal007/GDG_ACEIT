begin;
select plan(19);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-4000-8000-000000000311', 'authenticated', 'authenticated', 'observation-admin@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-4000-8000-000000000312', 'authenticated', 'authenticated', 'observation-user@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());
insert into public.admin_users (user_id) values ('00000000-0000-4000-8000-000000000311');
insert into public.participants (participant_key, display_name, profile_url, registration_status, verified_badge_count, last_verified_at)
values ('observation-test', 'Observation Test', 'https://skills.google/public_profiles/observation-test', 'registered', 7, '2026-01-02 03:04:05+00');
select set_config('test.observation_participant', (select id::text from public.participants where participant_key = 'observation-test'), true);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000311';
select set_config('test.observation_id', (
  select observation_id::text
  from public.admin_record_progress_observation(
    'observation-test', 'https://www.skills.google/public_profiles/observation-test',
    'arcadecalc_frontend', '2026-11-01 16:22:12.087+00', 200, 115, 115, null,
    'unverified', 'Response identity, badge IDs, and completeness were not established.'
  )
), true);
select is(
  (select reported_total from public.participant_progress_observations where id = current_setting('test.observation_id')::uuid),
  115,
  'admin RPC records the source-reported total as a diagnostic observation'
);
select is(
  (select identity_status from public.participant_progress_observations where id = current_setting('test.observation_id')::uuid),
  'not_independently_verified',
  'observation identity is never marked independently verified'
);
select is(
  (select actor_user_id from public.participant_progress_observations where id = current_setting('test.observation_id')::uuid),
  '00000000-0000-4000-8000-000000000311'::uuid,
  'record stores the authenticated admin actor'
);
select is((select verified_badge_count from public.participants where id = current_setting('test.observation_participant')::uuid), 7, 'observation leaves manually verified badge count unchanged');
select is((select last_verified_at from public.participants where id = current_setting('test.observation_participant')::uuid), '2026-01-02 03:04:05+00'::timestamptz, 'observation leaves manual verification time unchanged');
reset role;
select is((select count(*)::integer from public.participant_auto_progress where participant_id = current_setting('test.observation_participant')::uuid), 0, 'observation does not create an automatic snapshot');
select is((select count(*)::integer from public.participant_auto_badges where participant_id = current_setting('test.observation_participant')::uuid), 0, 'observation does not create automatic badge details');
select is((select count(*)::integer from public.participant_auto_milestones where participant_id = current_setting('test.observation_participant')::uuid), 0, 'observation does not allocate an automatic rank');
select is((select count(*)::integer from public.participant_audit_events where participant_id = current_setting('test.observation_participant')::uuid), 0, 'observation does not create manual verification audit events');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000311';
select lives_ok(
  $$select * from public.admin_record_progress_observation(
    'observation-test', 'https://skills.google/public_profiles/observation-test',
    'arcadecalc_frontend', now(), 503, null, null, null, 'failed', 'Temporary upstream failure.'
  )$$,
  'failed retrieval can be recorded without count values'
);
reset role;
select is((select latest_status from public.public_progress_observation_leaderboard where participant_id = current_setting('test.observation_participant')::uuid), 'failed', 'projection reports the latest failed attempt');
select is((select reported_total from public.public_progress_observation_leaderboard where participant_id = current_setting('test.observation_participant')::uuid), 115, 'failed attempt preserves the last source-reported data');
select is((select report_source_name from public.public_progress_observation_leaderboard where participant_id = current_setting('test.observation_participant')::uuid), 'arcadecalc_frontend', 'preserved report retains its original source');

set local role anon;
select is((select reported_total from public.public_progress_observation_leaderboard where participant_id = current_setting('test.observation_participant')::uuid), 115, 'public projection labels and exposes only the source report');
select throws_ok(
  $$insert into public.participant_progress_observations (participant_id, profile_id, normalized_profile_url, profile_revision, source_name, retrieved_at, http_status, reported_total, detail_count, completeness_status, actor_user_id) values (current_setting('test.observation_participant')::uuid, 'observation-test', 'https://skills.google/public_profiles/observation-test', 1, 'arcadecalc_frontend', now(), 200, 10, 10, 'unverified', '00000000-0000-4000-8000-000000000311')$$,
  '42501', null, 'anonymous clients cannot insert observation rows directly'
);
select throws_ok(
  $$select * from public.admin_record_progress_observation('observation-test', 'https://skills.google/public_profiles/observation-test', 'arcadecalc_frontend', now(), 200, 0, 0, null, 'unverified', null)$$,
  '42501', null, 'anonymous clients cannot invoke the admin observation RPC'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000312';
select throws_ok(
  $$select * from public.admin_record_progress_observation('observation-test', 'https://skills.google/public_profiles/observation-test', 'arcadecalc_frontend', now(), 200, 0, 0, null, 'unverified', null)$$,
  '42501', 'Admin access required', 'authenticated non-admin cannot record observations'
);
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000311';
select throws_ok(
  $$select * from public.admin_record_progress_observation('observation-test', 'https://skills.google/public_profiles/someone-else', 'arcadecalc_frontend', now(), 200, 0, 0, null, 'unverified', null)$$,
  '22023', 'Registered profile identity is changed or ambiguous', 'an admin cannot attach an observation to a different profile URL'
);
reset role;
insert into public.participants (participant_key, display_name, profile_url, registration_status)
values ('observation-duplicate', 'Observation Duplicate', 'https://www.cloudskillsboost.google/public_profiles/observation-test/', 'registered');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000311';
select throws_ok(
  $$select * from public.admin_record_progress_observation('observation-test', 'https://skills.google/public_profiles/observation-test', 'arcadecalc_frontend', now(), 200, 0, 0, null, 'unverified', null)$$,
  '22023', 'Registered profile identity is changed or ambiguous', 'duplicate normalized registered profile URLs cannot accept an observation'
);
reset role;

select * from finish();
rollback;

begin;
select plan(21);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-4000-8000-000000000421','authenticated','authenticated','observation-worker@example.test','',now(),'{}','{}',now(),now());
insert into public.admin_users(user_id) values ('00000000-0000-4000-8000-000000000421');
insert into public.participants(id,participant_key,display_name,profile_url,registration_status,verified_badge_count,last_verified_at)
values
 ('00000000-0000-4000-8000-000000000431','observation-job-test','Observation Job Test','https://skills.google/public_profiles/observation-job-test','registered',6,'2026-02-03 04:05:06+00'),
 ('00000000-0000-4000-8000-000000000432','observation-job-previous','Observation Job Previous','https://skills.google/public_profiles/observation-job-previous','registered',2,'2026-02-01 01:02:03+00');
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000421';
select * from public.admin_record_progress_observation(
  'observation-job-previous','https://skills.google/public_profiles/observation-job-previous','google_skills_public_html',now(),200,4,4,null,'unverified','Prior diagnostic observation.'
);

select ok(
  not has_table_privilege('anon','public.participant_progress_observation_jobs','select')
  and not has_table_privilege('authenticated','public.participant_progress_observation_job_items','update')
  and not has_table_privilege('service_role','public.participant_progress_observation_cooldowns','select'),
  'job state and cooldowns are not directly exposed through table grants'
);
select ok(
  not has_function_privilege('authenticated','public.start_or_resume_progress_observation_job(uuid,uuid,text)','execute')
  and not has_function_privilege('anon','public.finish_progress_observation_item(uuid,uuid,uuid,uuid,uuid,text,text,integer,text,text,bigint,integer,timestamptz,integer,integer)','execute')
  and has_function_privilege('service_role','public.claim_progress_observation_batch(uuid,uuid,integer)','execute'),
  'durable job mutation RPCs are worker-only'
);
select ok(has_function_privilege('authenticated','public.claim_google_skills_observation_cooldown(text,text)','execute'),
  'the one-profile admin flow can claim the shared server-side cooldown');

set local request.jwt.claim.role = 'service_role';
select set_config('test.observation_job_lock', (select lock_token::text from public.claim_participant_auto_refresh_job(300)), true);
select throws_ok(
  $$select * from public.start_or_resume_progress_observation_job(
    current_setting('test.observation_job_lock')::uuid,
    '00000000-0000-4000-8000-000000000499',
    'admin:00000000-0000-4000-8000-000000000499:00000000-0000-4000-8000-000000000498'
  )$$,
  '42501','Administrator required','worker refuses job creation for a non-admin actor'
);
select set_config('test.observation_job_id', (select job_id::text from public.start_or_resume_progress_observation_job(
  current_setting('test.observation_job_lock')::uuid,
  '00000000-0000-4000-8000-000000000421',
  'admin:00000000-0000-4000-8000-000000000421:00000000-0000-4000-8000-000000000441'
)), true);
select is((select job_status from public.start_or_resume_progress_observation_job(
  current_setting('test.observation_job_lock')::uuid,
  '00000000-0000-4000-8000-000000000421',
  'admin:00000000-0000-4000-8000-000000000421:00000000-0000-4000-8000-000000000441'
)), 'running', 'first administrator trigger creates a resumable job');
select is((select total_count from public.participant_progress_observation_jobs where id=current_setting('test.observation_job_id')::uuid),2,
  'job manifest captures registered participants');
select is((select job_id::text from public.start_or_resume_progress_observation_job(
  current_setting('test.observation_job_lock')::uuid,
  '00000000-0000-4000-8000-000000000421',
  'admin:00000000-0000-4000-8000-000000000421:00000000-0000-4000-8000-000000000442'
)), current_setting('test.observation_job_id'), 'duplicate trigger by the same admin resumes the active job');

create temporary table observation_claim on commit drop as
select * from public.claim_progress_observation_batch(current_setting('test.observation_job_id')::uuid,current_setting('test.observation_job_lock')::uuid,1);
select is((select count(*)::integer from observation_claim),1,'one participant item is atomically claimed');
create temporary table observation_claim_next on commit drop as
select * from public.claim_progress_observation_batch(current_setting('test.observation_job_id')::uuid,current_setting('test.observation_job_lock')::uuid,1);
select is((select count(*)::integer from observation_claim_next n join observation_claim c using (participant_id)),0,
  'a later concurrent batch claims a different participant instead of duplicating the active item');
update public.participant_progress_observation_job_items i
set claim_expires_at = clock_timestamp() - interval '1 second'
from observation_claim c where i.id = c.item_id;
update public.participant_progress_observation_cooldowns c
set next_allowed_at = clock_timestamp() - interval '1 second'
where c.participant_id = (select participant_id from observation_claim);
create temporary table observation_claim_recovered on commit drop as
select * from public.claim_progress_observation_batch(current_setting('test.observation_job_id')::uuid,current_setting('test.observation_job_lock')::uuid,1);
select is((select item_id::text from observation_claim_recovered),(select item_id::text from observation_claim),
  'an expired claim returns the same work item to the queue');
select is((select item_status from public.finish_progress_observation_item(
  current_setting('test.observation_job_id')::uuid,current_setting('test.observation_job_lock')::uuid,
  (select item_id from observation_claim),(select item_claim_token from observation_claim),
  '00000000-0000-4000-8000-000000000421','observed',null,null,
  'observation-job-test','https://skills.google/public_profiles/observation-job-test',1,200,now(),3,3
)), 'stale', 'the expired worker claim token is fenced after recovery');
select is((select item_status from public.finish_progress_observation_item(
  current_setting('test.observation_job_id')::uuid,gen_random_uuid(),
  (select item_id from observation_claim),(select item_claim_token from observation_claim),
  '00000000-0000-4000-8000-000000000421','observed',null,null,
  'observation-job-test','https://skills.google/public_profiles/observation-job-test',1,200,now(),3,3
)), 'stale', 'stale worker lock cannot persist an observation');
select is((select count(*)::integer from public.participant_progress_observations where participant_id='00000000-0000-4000-8000-000000000431'),0,'stale worker produced no observation');
select is((select item_status from public.finish_progress_observation_item(
  current_setting('test.observation_job_id')::uuid,current_setting('test.observation_job_lock')::uuid,
  (select item_id from observation_claim_recovered),(select item_claim_token from observation_claim_recovered),
  '00000000-0000-4000-8000-000000000421','observed',null,null,
  'observation-job-test','https://skills.google/public_profiles/observation-job-test',1,200,now(),3,3
)), 'observed', 'current claim records an explicitly unverified count');
select is((select observed_count from public.participant_progress_observation_jobs where id=current_setting('test.observation_job_id')::uuid),1,
  'job summary counts the stored observation once');
select is((select completeness_status from public.participant_progress_observations where participant_id='00000000-0000-4000-8000-000000000431'),
  'unverified','stored profile count remains unverified');
select ok(
  (select verified_badge_count=6 and last_verified_at='2026-02-03 04:05:06+00'::timestamptz from public.participants where id='00000000-0000-4000-8000-000000000431')
  and not exists(select 1 from public.participant_audit_events where participant_id='00000000-0000-4000-8000-000000000431'),
  'observation leaves verified count, verification time, and audit history unchanged'
);

select is((select item_status from public.finish_progress_observation_item(
  current_setting('test.observation_job_id')::uuid,current_setting('test.observation_job_lock')::uuid,
  (select item_id from observation_claim_next),(select item_claim_token from observation_claim_next),
  '00000000-0000-4000-8000-000000000421','failed','upstream_error',null,
  null,null,null,null,null,null,null
)), 'failed', 'failed retrieval is recorded separately with no inferred count');
select is((select count(*)::integer from public.participant_progress_observations where participant_id='00000000-0000-4000-8000-000000000432'),1,
  'failed job work does not overwrite or append over the previous successful observation');
select is((select reported_total from public.participant_progress_observations where participant_id='00000000-0000-4000-8000-000000000432'),4,
  'the last known source-reported value remains intact after a failed refresh');

set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000421';
select is((select claim_status from public.claim_google_skills_observation_cooldown('observation-job-test','https://skills.google/public_profiles/observation-job-test')),
  'cooldown','the per-profile cooldown is shared with the one-profile diagnostic');

select * from finish();
rollback;

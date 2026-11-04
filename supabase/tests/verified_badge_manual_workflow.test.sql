begin;
select plan(13);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-4000-8000-000000000511', 'authenticated', 'authenticated',
  'verified-workflow-admin@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
);
insert into public.admin_users (user_id) values ('00000000-0000-4000-8000-000000000511');
insert into public.participants (
  participant_key, display_name, profile_url, registration_status,
  verified_badge_count, last_verified_at
) values (
  'verified-workflow-test', 'Verified Workflow Test',
  'https://skills.google/public_profiles/verified-workflow-test', 'registered',
  4, '2026-01-02 03:04:05+00'
);
select set_config('test.verified_participant', (
  select id::text from public.participants where participant_key = 'verified-workflow-test'
), true);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000511';
select set_config('test.verified_at', (
  select verified_at::text
  from public.admin_set_verified_badge_count(
    current_setting('test.verified_participant')::uuid, 0, 'Reviewed official credential evidence.'
  )
), true);
select is(
  (select verified_badge_count from public.participants where id = current_setting('test.verified_participant')::uuid),
  0,
  'authorized manual review can record a verified zero distinctly from an unreviewed default'
);
select is(
  (select last_verified_at = current_setting('test.verified_at')::timestamptz
   from public.participants where id = current_setting('test.verified_participant')::uuid),
  true,
  'manual verification stores the verification timestamp'
);
select is(
  (select count(*)::integer from public.participant_audit_events
   where participant_id = current_setting('test.verified_participant')::uuid
     and event_type = 'badge_count_updated' and source = 'admin_manual'
     and previous_badge_count = 4 and new_badge_count = 0
     and note = 'Reviewed official credential evidence.'
     and actor_user_id = '00000000-0000-4000-8000-000000000511'::uuid
     and verified_at = current_setting('test.verified_at')::timestamptz),
  1,
  'verification is auditable with prior value, new value, actor, and timestamp'
);
select is(
  (select verified_at from public.admin_set_verified_badge_count(
    current_setting('test.verified_participant')::uuid, 0, 'Reviewed official credential evidence.'
  )),
  current_setting('test.verified_at')::timestamptz,
  'retrying the exact same zero verification returns the original verification timestamp'
);
select is(
  (select count(*)::integer from public.participant_audit_events
   where participant_id = current_setting('test.verified_participant')::uuid),
  1,
  'retrying the exact same zero verification does not append a duplicate audit event'
);
select set_config('test.verified_positive_at', (
  select verified_at::text
  from public.admin_set_verified_badge_count(
    current_setting('test.verified_participant')::uuid, 6, 'Reviewed updated official credential evidence.'
  )
), true);
select is(
  (select verified_badge_count from public.participants where id = current_setting('test.verified_participant')::uuid),
  6,
  'authorized manual review can record a positive verified count'
);
select is(
  (select last_verified_at = current_setting('test.verified_positive_at')::timestamptz
   from public.participants where id = current_setting('test.verified_participant')::uuid),
  true,
  'positive verification stores its verification timestamp'
);
select is(
  (select count(*)::integer from public.participant_audit_events
   where participant_id = current_setting('test.verified_participant')::uuid
     and event_type = 'badge_count_updated' and source = 'admin_manual'
     and previous_badge_count = 0 and new_badge_count = 6
     and note = 'Reviewed updated official credential evidence.'
     and actor_user_id = '00000000-0000-4000-8000-000000000511'::uuid
     and verified_at = current_setting('test.verified_positive_at')::timestamptz),
  1,
  'positive corrections retain the review note and append a complete audit event'
);
select is(
  (select count(*)::integer from public.participant_audit_events
   where participant_id = current_setting('test.verified_participant')::uuid),
  2,
  'prior verification history remains present after a correction'
);
select throws_ok(
  $$select * from public.admin_set_verified_badge_count(current_setting('test.verified_participant')::uuid, -1, 'Invalid count')$$,
  '22023', 'Badge count must be an integer from 0 to 10000',
  'invalid verification attempts fail before changing data'
);
select is(
  (select verified_badge_count from public.participants where id = current_setting('test.verified_participant')::uuid),
  6,
  'failed verification preserves the previous verified count'
);
select is(
  (select last_verified_at = current_setting('test.verified_positive_at')::timestamptz
   from public.participants where id = current_setting('test.verified_participant')::uuid),
  true,
  'failed verification preserves the previous verification timestamp'
);
select is(
  (select count(*)::integer from public.participant_audit_events
   where participant_id = current_setting('test.verified_participant')::uuid),
  2,
  'failed verification creates no extra audit event'
);

select * from finish();
rollback;

begin;
select plan(5);

insert into auth.users (
  id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-4000-8000-000000000111', 'authenticated', 'authenticated',
  'sync-test-admin@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
);
insert into public.admin_users (user_id)
values ('00000000-0000-4000-8000-000000000111');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000111';
select is(
  (select result from public.admin_sync_google_form_participants(
    jsonb_build_array(jsonb_build_object(
      'rowNumber', 2,
      'participantKey', 'form:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'displayName', 'Sync Test Learner',
      'profileUrl', 'https://www.cloudskillsboost.google/public_profiles/sync-test'
    ))
  )),
  'imported',
  'first response sync creates a participant'
);
select is(
  (select verified_badge_count from public.participants where participant_key = 'form:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
  0,
  'new participant starts with zero verified badges'
);

reset role;
update public.participants
set verified_badge_count = 7, last_verified_at = now(), verification_source = 'admin_manual'
where participant_key = 'form:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000111';
select is(
  (select result from public.admin_sync_google_form_participants(
    jsonb_build_array(jsonb_build_object(
      'rowNumber', 2,
      'participantKey', 'form:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'displayName', 'Sync Test Learner Updated',
      'profileUrl', 'https://www.cloudskillsboost.google/public_profiles/sync-test'
    ))
  )),
  'updated',
  'changed form fields update an existing participant'
);
select is(
  (select verified_badge_count from public.participants where participant_key = 'form:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
  7,
  'registration sync preserves existing verified badge progress'
);
select is(
  (select result from public.admin_sync_google_form_participants(
    jsonb_build_array(jsonb_build_object(
      'rowNumber', 2,
      'participantKey', 'form:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'displayName', 'Sync Test Learner Updated',
      'profileUrl', 'https://www.cloudskillsboost.google/public_profiles/sync-test'
    ))
  )),
  'unchanged',
  'repeating the same sync is idempotent'
);

select * from finish();
rollback;

begin;
select plan(10);

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
  (select result from public.admin_sync_google_form_participants(
    jsonb_build_array(jsonb_build_object(
      'rowNumber', 3,
      'participantKey', 'form:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'displayName', 'Skills Google Learner',
      'profileUrl', 'https://www.skills.google/public_profiles/skills-test'
    ))
  )),
  'imported',
  'response sync accepts canonical skills.google profile URL'
);
select is(
  (select result from public.admin_sync_google_form_participants(
    jsonb_build_array(jsonb_build_object(
      'rowNumber', 4,
      'participantKey', 'form:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'displayName', 'Skills Google Learner Updated',
      'profileUrl', 'https://www.skills.google/public_profiles/skills-test'
    ))
  )),
  'updated',
  'registration fields update for an existing zero-count participant'
);
select is(
  (select verified_badge_count = 0 and last_verified_at is null
   from public.participants where participant_key = 'form:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
  true,
  'registration sync preserves an existing zero count and null verification timestamp'
);
select is(
  (select verified_badge_count from public.participants where participant_key = 'form:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
  0,
  'new participant starts with zero verified badges'
);

reset role;
update public.participants
set verified_badge_count = 7, last_verified_at = '2025-01-02 03:04:05+00', verification_source = 'admin_manual'
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
  (select last_verified_at from public.participants where participant_key = 'form:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
  '2025-01-02 03:04:05+00'::timestamptz,
  'registration sync preserves existing verification timestamp'
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

select is(
  (select count(*)::integer from public.participant_audit_events
   where event_type = 'participant_imported'
     and (new_badge_count is distinct from 0 or verified_at is not null)),
  0,
  'all participant_imported audit events retain zero count and null verification timestamp'
);

select * from finish();
rollback;

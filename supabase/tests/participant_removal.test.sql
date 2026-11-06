begin;
select plan(23);

-- Admin identity for the audited removal workflow.
insert into auth.users (
  id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-4000-8000-000000000211', 'authenticated', 'authenticated',
  'removal-test-admin@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
);
insert into public.admin_users (user_id)
values ('00000000-0000-4000-8000-000000000211');

insert into public.participants (
  id, participant_key, display_name, profile_url,
  registration_status, verified_badge_count, skill_badge_count, arcade_game_badge_count
) values
  (
    '00000000-0000-4000-8000-0000000002a1', 'removal-test-authoritative', 'Authoritative Learner',
    'https://www.skills.google/public_profiles/removal-test-authoritative',
    'registered', 12, 10, 2
  ),
  (
    '00000000-0000-4000-8000-0000000002a2', 'removal-test-production-only', 'Production Only Learner',
    'https://www.skills.google/public_profiles/removal-test-production-only',
    'registered', 3, 3, 0
  );

select set_config(
  'test.removal_registered_before',
  (select count(*)::text from public.participants where registration_status = 'registered'),
  true
);

-- Authorization.
set local role anon;
select throws_ok(
  $$select * from public.admin_remove_participants(
      array['00000000-0000-4000-8000-0000000002a2'::uuid], 'Production-only roster cleanup', 
      array['https://www.skills.google/public_profiles/removal-test-authoritative']
    )$$,
  '42501', null,
  'anonymous callers cannot remove participants'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000099';
select throws_ok(
  $$select * from public.admin_remove_participants(
      array['00000000-0000-4000-8000-0000000002a2'::uuid], 'Production-only roster cleanup',
      array['https://www.skills.google/public_profiles/removal-test-authoritative']
    )$$,
  '42501', null,
  'authenticated non-admin callers cannot remove participants'
);

-- Admin validation and protections.
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000211';
select throws_ok(
  $$select * from public.admin_remove_participants(
      array['00000000-0000-4000-8000-0000000002a2'::uuid], 'short',
      array['https://www.skills.google/public_profiles/removal-test-authoritative']
    )$$,
  '22023', null,
  'removal requires a meaningful reason'
);
select throws_ok(
  $$select * from public.admin_remove_participants(
      array['00000000-0000-4000-8000-0000000002a2'::uuid], 'Production-only roster cleanup',
      array[]::text[]
    )$$,
  '22023', null,
  'removal requires an authoritative roster snapshot'
);
select throws_ok(
  $$select * from public.admin_remove_participants(
      array['00000000-0000-4000-8000-0000000002a1'::uuid], 'Attempt authoritative removal',
      array['https://www.skills.google/public_profiles/removal-test-authoritative']
    )$$,
  '22023', null,
  'removal refuses an authoritative participant'
);

-- Successful removal.
select is(
  (select result from public.admin_remove_participants(
    array['00000000-0000-4000-8000-0000000002a2'::uuid],
    'Production-only roster cleanup',
    array['https://www.skills.google/public_profiles/removal-test-authoritative']
  )),
  'removed',
  'an authoritative-absent participant is soft removed'
);
select is(
  (select registration_status from public.participants where participant_key = 'removal-test-production-only'),
  'removed',
  'the registration status transitions to removed'
);
select ok(
  (select removed_at is not null and removed_by = '00000000-0000-4000-8000-000000000211'
      and removal_reason = 'Production-only roster cleanup'
   from public.participants where participant_key = 'removal-test-production-only'),
  'removal metadata preserves actor, time and reason'
);
select is(
  (select verified_badge_count from public.participants where participant_key = 'removal-test-production-only'),
  3,
  'removal preserves the participant badge count'
);
select is(
  (select count(*)::integer from public.participant_audit_events
   where participant_id = '00000000-0000-4000-8000-0000000002a2'
     and event_type = 'participant_removed'
     and source = 'admin_manual'
     and previous_badge_count = 3
     and new_badge_count = 3
     and verified_at is null
     and actor_user_id = '00000000-0000-4000-8000-000000000211'),
  1,
  'removal appends one audited event with actor and preserved count'
);
select is(
  (select result from public.admin_remove_participants(
    array['00000000-0000-4000-8000-0000000002a2'::uuid],
    'Production-only roster cleanup',
    array['https://www.skills.google/public_profiles/removal-test-authoritative']
  )),
  'already_removed',
  'repeated removal is idempotent'
);
select is(
  (select count(*)::integer from public.participant_audit_events
   where participant_id = '00000000-0000-4000-8000-0000000002a2'
     and event_type = 'participant_removed'),
  1,
  'repeated removal does not duplicate audit events'
);

-- Public projections exclude removed participants.
reset role;
set local role anon;
select is(
  (select count(*)::integer from public.participants
   where participant_key = 'removal-test-production-only'),
  0,
  'anonymous readers cannot see removed participants'
);
select is(
  public.get_public_summary() ->> 'registered_count',
  (current_setting('test.removal_registered_before')::integer - 1)::text,
  'public summary excludes removed participants'
);
select is(
  (select count(*)::integer from public.participants
   where participant_key = 'removal-test-authoritative'),
  1,
  'authoritative participants remain publicly registered'
);
reset role;

-- Re-entry is blocked for both supported registration paths.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000211';
select is(
  (select result from public.admin_import_participants(
    jsonb_build_array(jsonb_build_object(
      'participantKey', 'removal-test-production-only',
      'displayName', 'Production Only Learner',
      'profileUrl', 'https://www.skills.google/public_profiles/removal-test-production-only'
    ))
  )),
  'removed',
  'roster import cannot revive a removed participant with the same key'
);
select is(
  (select registration_status from public.participants where participant_key = 'removal-test-production-only'),
  'removed',
  'roster import leaves the removed row terminal'
);
select is(
  (select result from public.admin_import_participants(
    jsonb_build_array(jsonb_build_object(
      'participantKey', 'removal-test-new-key',
      'displayName', 'Duplicate Profile Learner',
      'profileUrl', 'https://www.skills.google/public_profiles/removal-test-production-only'
    ))
  )),
  'duplicate_profile',
  'roster import cannot add a removed profile URL under a new key'
);
select is(
  (select count(*)::integer from public.participants where participant_key = 'removal-test-new-key'),
  0,
  'no duplicate profile row is created by roster import'
);
select is(
  (select result from public.admin_sync_google_form_participants(
    jsonb_build_array(jsonb_build_object(
      'rowNumber', 2,
      'participantKey', 'removal-test-production-only',
      'displayName', 'Production Only Learner Updated',
      'profileUrl', 'https://www.skills.google/public_profiles/removal-test-production-only'
    ))
  )),
  'removed',
  'Google Form sync cannot revive a removed participant with the same key'
);
select throws_ok(
  $$select * from public.admin_sync_google_form_participants(
      jsonb_build_array(jsonb_build_object(
        'rowNumber', 3,
        'participantKey', 'form:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        'displayName', 'Removed Profile Learner',
        'profileUrl', 'https://www.skills.google/public_profiles/removal-test-production-only'
      ))
    )$$,
  '22023', null,
  'Google Form sync cannot add a removed profile URL under a new key'
);
select is(
  (select count(*)::integer from public.participants where participant_key = 'form:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'),
  0,
  'removed profiles cannot re-enter through form sync'
);
select is(
  (select count(*)::integer from public.participant_audit_events
   where participant_id = '00000000-0000-4000-8000-0000000002a2'
     and event_type in ('participant_imported', 'participant_synced')),
  0,
  'rejected re-entry attempts create no registration audit events'
);

select * from finish();
rollback;

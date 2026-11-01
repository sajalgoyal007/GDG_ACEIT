begin;
select plan(15);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-4000-8000-000000000211', 'authenticated', 'authenticated',
  'progress-import-admin@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
);
insert into public.admin_users (user_id) values ('00000000-0000-4000-8000-000000000211');
insert into public.participants (
  participant_key, display_name, profile_url, registration_status,
  verified_badge_count, last_verified_at
) values (
  'progress-import-test', 'Progress Import Test',
  'https://skills.google/public_profiles/progress-import-test', 'registered',
  7, '2026-01-02 03:04:05+00'
);
select set_config('test.progress_participant', (
  select id::text from public.participants where participant_key = 'progress-import-test'
), true);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000211';
select set_config('test.progress_import_id', (
  select import_id::text
  from public.admin_import_unverified_progress(jsonb_build_array(jsonb_build_object(
    'participant_id', current_setting('test.progress_participant'),
    'participant_key', 'progress-import-test',
    'profile_url', 'https://www.cloudskillsboost.google/public_profiles/progress-import-test/',
    'badge_count', 0
  )))
), true);
select is(
  (select item_count from public.participant_progress_imports where id = current_setting('test.progress_import_id')::uuid),
  1,
  'one import operation records its affected row count'
);
select is(
  (select count(*)::integer from public.participant_progress_import_items where import_id = current_setting('test.progress_import_id')::uuid and reported_badge_count = 0),
  1,
  'zero badge count is retained as unverified imported progress'
);
select is(
  (select actor_user_id from public.participant_progress_imports where id = current_setting('test.progress_import_id')::uuid),
  '00000000-0000-4000-8000-000000000211'::uuid,
  'audit operation records the authenticated admin actor'
);
select throws_ok(
  $$select * from public.admin_import_unverified_progress(jsonb_build_array(
    jsonb_build_object(
      'participant_id', current_setting('test.progress_participant'),
      'participant_key', 'progress-import-test',
      'profile_url', 'https://skills.google/public_profiles/progress-import-test',
      'badge_count', 9
    ),
    jsonb_build_object(
      'participant_id', '00000000-0000-4000-8000-000000000212',
      'participant_key', 'invalid-participant',
      'profile_url', 'https://skills.google/public_profiles/invalid-participant',
      'badge_count', -1
    )
  ))$$,
  '22023', 'Import row contains invalid identity or badge count',
  'one invalid row rejects the entire import transaction'
);
select is(
  (select count(*)::integer from public.participant_progress_imports where id <> current_setting('test.progress_import_id')::uuid),
  0,
  'rejected batch creates no partial audit operation'
);
select is(
  (select verified_badge_count from public.participants where id = current_setting('test.progress_participant')::uuid),
  7,
  'CSV import leaves manually verified badge count unchanged'
);
select is(
  (select last_verified_at from public.participants where id = current_setting('test.progress_participant')::uuid),
  '2026-01-02 03:04:05+00'::timestamptz,
  'CSV import leaves manual verification timestamp unchanged'
);
reset role;
select is(
  (select count(*)::integer from public.participant_auto_progress where participant_id = current_setting('test.progress_participant')::uuid),
  0,
  'CSV import does not write the automatic snapshot table'
);
select is(
  (select count(*)::integer from public.participant_auto_milestones where participant_id = current_setting('test.progress_participant')::uuid),
  0,
  'CSV import does not allocate an automatic finish rank'
);

reset role;
set local role anon;
select is(
  (select unverified_badge_count from public.public_auto_progress_leaderboard where participant_id = current_setting('test.progress_participant')::uuid),
  0,
  'public progress projection exposes the organizer value as a separate unverified field'
);
select throws_ok(
  $$insert into public.participant_progress_import_items (import_id, participant_id, normalized_profile_url, profile_revision, reported_badge_count, imported_at) values (gen_random_uuid(), current_setting('test.progress_participant')::uuid, 'x', 1, 4, now())$$,
  '42501', null,
  'anonymous clients cannot write imported progress rows'
);
select throws_ok(
  $$select * from public.admin_import_unverified_progress('[]'::jsonb)$$,
  '42501', null,
  'anonymous clients cannot invoke the progress import RPC'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000212';
select throws_ok(
  $$select * from public.admin_import_unverified_progress('[]'::jsonb)$$,
  '42501', 'Admin access required',
  'authenticated non-admin users cannot invoke the progress import RPC'
);
reset role;

update public.participants
set profile_url = 'https://skills.google/public_profiles/changed-profile'
where id = current_setting('test.progress_participant')::uuid;
set local role anon;
select is(
  (select unverified_badge_count from public.public_auto_progress_leaderboard where participant_id = current_setting('test.progress_participant')::uuid),
  null::integer,
  'profile URL changes hide older imported progress from the current projection'
);
reset role;
select is(
  (select count(*)::integer from public.participant_progress_import_items where import_id = current_setting('test.progress_import_id')::uuid),
  1,
  'historical import audit row remains available after profile identity changes'
);

select * from finish();
rollback;

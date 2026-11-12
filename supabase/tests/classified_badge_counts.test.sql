begin;
select plan(34);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-4000-8000-000000000701', 'authenticated', 'authenticated',
  'classified-verification-admin@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
);
insert into public.admin_users (user_id) values ('00000000-0000-4000-8000-000000000701');

insert into public.participants (
  participant_key, display_name, registration_status, verified_badge_count
) values
  ('classified-test-1', 'Classified Test Participant 1', 'registered', 0),
  ('classified-test-2', 'Classified Test Participant 2', 'registered', 0);

select set_config('test.classified_p1_id', (select id::text from public.participants where participant_key = 'classified-test-1'), true);
select set_config('test.classified_p2_id', (select id::text from public.participants where participant_key = 'classified-test-2'), true);

select ok(not has_function_privilege('anon', 'public.admin_bulk_set_classified_badge_counts(jsonb)', 'EXECUTE'), 'anonymous clients cannot execute the classified bulk verification RPC');
select ok(has_function_privilege('authenticated', 'public.admin_bulk_set_classified_badge_counts(jsonb)', 'EXECUTE'), 'authenticated clients receive the granted RPC entry point');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000701';

-- Test 1: Sum invariant rejection (skill + arcade != total)
select throws_ok($$select * from public.admin_bulk_set_classified_badge_counts(jsonb_build_array(
  jsonb_build_object(
    'row_number', 2,
    'participant_id', current_setting('test.classified_p1_id'),
    'skill_count', 5,
    'arcade_count', 2,
    'total_count', 8,
    'review_note', 'Sum mismatch test',
    'expected_total_count', 0,
    'expected_last_verified_at', null,
    'expected_verification_source', null
  )
))$$, '22023', 'skill_count + arcade_count must equal total_count for every row', 'sum mismatch is rejected before any writes');

-- Test 2: Duplicate participant UUID rejection
select throws_ok($$select * from public.admin_bulk_set_classified_badge_counts(jsonb_build_array(
  jsonb_build_object(
    'row_number', 2,
    'participant_id', current_setting('test.classified_p1_id'),
    'skill_count', 3,
    'arcade_count', 1,
    'total_count', 4,
    'review_note', 'Duplicate 1',
    'expected_total_count', 0,
    'expected_last_verified_at', null,
    'expected_verification_source', null
  ),
  jsonb_build_object(
    'row_number', 3,
    'participant_id', current_setting('test.classified_p1_id'),
    'skill_count', 3,
    'arcade_count', 1,
    'total_count', 4,
    'review_note', 'Duplicate 2',
    'expected_total_count', 0,
    'expected_last_verified_at', null,
    'expected_verification_source', null
  )
))$$, '22023', 'Classified bulk import contains duplicate participants', 'duplicate participant UUIDs are rejected');

-- Test 3: Successful write path
select is((
  select count(*)::integer from public.admin_bulk_set_classified_badge_counts(jsonb_build_array(
    jsonb_build_object(
      'row_number', 2,
      'participant_id', current_setting('test.classified_p1_id'),
      'skill_count', 5,
      'arcade_count', 2,
      'total_count', 7,
      'review_note', 'Phase 6C: 5 Skill, 2 Arcade',
      'expected_total_count', 0,
      'expected_last_verified_at', null,
      'expected_verification_source', null
    ),
    jsonb_build_object(
      'row_number', 3,
      'participant_id', current_setting('test.classified_p2_id'),
      'skill_count', 0,
      'arcade_count', 0,
      'total_count', 0,
      'review_note', 'Phase 6C: confirmed zero',
      'expected_total_count', 0,
      'expected_last_verified_at', null,
      'expected_verification_source', null
    )
  ))
), 2, 'classified bulk write succeeds for valid batch');

select is((select verified_badge_count from public.participants where id = current_setting('test.classified_p1_id')::uuid), 7, 'p1 total badge count is updated to 7');
select is((select skill_badge_count from public.participants where id = current_setting('test.classified_p1_id')::uuid), 5, 'p1 skill badge count is updated to 5');
select is((select arcade_game_badge_count from public.participants where id = current_setting('test.classified_p1_id')::uuid), 2, 'p1 arcade game badge count is updated to 2');

select is((select verified_badge_count from public.participants where id = current_setting('test.classified_p2_id')::uuid), 0, 'p2 total badge count is verified 0');
select is((select skill_badge_count from public.participants where id = current_setting('test.classified_p2_id')::uuid), 0, 'p2 skill badge count is verified 0');
select is((select arcade_game_badge_count from public.participants where id = current_setting('test.classified_p2_id')::uuid), 0, 'p2 arcade game badge count is verified 0');

-- Test 4: Preserves audit history with rollback metadata
select is((
  select count(*)::integer from public.participant_audit_events
  where participant_id = current_setting('test.classified_p1_id')::uuid
    and event_type = 'badge_count_updated'
    and new_badge_count = 7
    and source = 'admin_manual'
    and note like '%[rollback_state:%'
), 1, 'participant audit trail records classified update with embedded rollback metadata');

-- Test 5: Summary RPC incorporates classified badge totals
select is((public.get_public_summary() ->> 'total_skill_badges')::integer, 5, 'summary RPC calculates total_skill_badges');
select is((public.get_public_summary() ->> 'total_arcade_badges')::integer, 2, 'summary RPC calculates total_arcade_badges');
select is((public.get_public_summary() ->> 'ten_badge_count')::integer, 0, 'summary RPC counts only 10+ skill badge holders');
select is((public.get_public_summary() ->> 'frozen_rank_count')::integer, 0, 'no participant is frozen below 10 skill badges');

-- Test 6: Dedicated rollback RPC restores prior state completely
select is((
  select count(*)::integer from public.admin_bulk_rollback_classified_badge_counts(jsonb_build_array(
    jsonb_build_object(
      'participant_id', current_setting('test.classified_p1_id'),
      'target_total', 0,
      'target_skill', null,
      'target_arcade', null,
      'target_verified_at', null,
      'target_source', null,
      'rollback_note', 'Audited test rollback'
    )
  ))
), 1, 'rollback RPC executes successfully');

select is((select verified_badge_count from public.participants where id = current_setting('test.classified_p1_id')::uuid), 0, 'rollback restores verified_badge_count to 0');
select ok((select skill_badge_count is null from public.participants where id = current_setting('test.classified_p1_id')::uuid), 'rollback restores skill_badge_count to null');
select ok((select arcade_game_badge_count is null from public.participants where id = current_setting('test.classified_p1_id')::uuid), 'rollback restores arcade_game_badge_count to null');
select ok((select last_verified_at is null from public.participants where id = current_setting('test.classified_p1_id')::uuid), 'rollback restores last_verified_at to null');

reset role;
select is((select count(*)::integer from public.participant_auto_progress where participant_id in (current_setting('test.classified_p1_id')::uuid, current_setting('test.classified_p2_id')::uuid)), 0, 'classified CSV workflow does not write unverified automatic progress snapshots');

-- Test 7: A same-total but different Skill/Arcade split is stale and writes
-- nothing when the apply path supplies the expected split.
reset role;
update public.participants
set verified_badge_count = 7, skill_badge_count = 5, arcade_game_badge_count = 2
where id = current_setting('test.classified_p1_id')::uuid;
-- The total is still 7, but the live split no longer matches the approved one.
update public.participants
set skill_badge_count = 4, arcade_game_badge_count = 3
where id = current_setting('test.classified_p1_id')::uuid;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000701';

select throws_ok($$select * from public.admin_bulk_set_classified_badge_counts(jsonb_build_array(
  jsonb_build_object(
    'row_number', 2,
    'participant_id', current_setting('test.classified_p1_id'),
    'skill_count', 4,
    'arcade_count', 3,
    'total_count', 7,
    'review_note', 'Same-total split race',
    'expected_total_count', 7,
    'expected_last_verified_at', null,
    'expected_verification_source', null,
    'expected_skill_count', 5,
    'expected_arcade_count', 2
  )
))$$, '40001', 'Participant verification changed after preview; preview the CSV again', 'a same-total but different Skill/Arcade split is rejected as stale');

select is((select skill_badge_count from public.participants where id = current_setting('test.classified_p1_id')::uuid), 4, 'a stale split change writes no Skill count');
select is((select arcade_game_badge_count from public.participants where id = current_setting('test.classified_p1_id')::uuid), 3, 'a stale split change writes no Arcade count');
select is((select count(*)::integer from public.participant_audit_events where participant_id = current_setting('test.classified_p1_id')::uuid), 2, 'a stale split change appends no audit event');

-- Test 8: The legacy nine-key manual CSV payload (no expected split keys) is
-- still accepted and writes the classification.
select is((
  select count(*)::integer from public.admin_bulk_set_classified_badge_counts(jsonb_build_array(
    jsonb_build_object(
      'row_number', 2,
      'participant_id', current_setting('test.classified_p1_id'),
      'skill_count', 2,
      'arcade_count', 1,
      'total_count', 3,
      'review_note', 'Legacy manual payload',
      'expected_total_count', 7,
      'expected_last_verified_at', null,
      'expected_verification_source', null
    )
  ))
), 1, 'the legacy nine-key manual CSV payload still writes');
select is((select verified_badge_count from public.participants where id = current_setting('test.classified_p1_id')::uuid), 3, 'the legacy payload writes the new total');
select is((select skill_badge_count from public.participants where id = current_setting('test.classified_p1_id')::uuid), 2, 'the legacy payload writes the new Skill count');
select is((select arcade_game_badge_count from public.participants where id = current_setting('test.classified_p1_id')::uuid), 1, 'the legacy payload writes the new Arcade count');

-- Test 9: Repeating a legacy rollback is idempotent and never duplicates audit
-- history.
select is((
  select count(*)::integer from public.admin_bulk_rollback_classified_badge_counts(jsonb_build_array(
    jsonb_build_object(
      'participant_id', current_setting('test.classified_p1_id'),
      'target_total', 7,
      'target_skill', 4,
      'target_arcade', 3,
      'target_verified_at', null,
      'target_source', null,
      'rollback_note', 'Legacy first rollback'
    )
  ))
), 1, 'the legacy rollback restores the target row');
select is((select verified_badge_count from public.participants where id = current_setting('test.classified_p1_id')::uuid), 7, 'the legacy rollback restores the previous total');

select set_config('test.classified_audit_after_rollback', (
  select count(*)::text from public.participant_audit_events
  where participant_id = current_setting('test.classified_p1_id')::uuid
), true);

select is((
  select count(*)::integer from public.admin_bulk_rollback_classified_badge_counts(jsonb_build_array(
    jsonb_build_object(
      'participant_id', current_setting('test.classified_p1_id'),
      'target_total', 7,
      'target_skill', 4,
      'target_arcade', 3,
      'target_verified_at', null,
      'target_source', null,
      'rollback_note', 'Legacy repeated rollback'
    )
  ))
), 1, 'a repeated legacy rollback still returns the target row');
select is((
  select count(*)::integer from public.participant_audit_events
  where participant_id = current_setting('test.classified_p1_id')::uuid
), current_setting('test.classified_audit_after_rollback')::integer, 'a repeated legacy rollback appends no duplicate audit event');

select * from finish();
rollback;


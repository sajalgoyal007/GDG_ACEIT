begin;
select plan(14);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-4000-8000-000000000601', 'authenticated', 'authenticated',
  'bulk-verification-admin@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
);
insert into public.admin_users (user_id) values ('00000000-0000-4000-8000-000000000601');
insert into public.participants (
  participant_key, display_name, registration_status, verified_badge_count
) values
  ('bulk-verify-zero', 'Bulk Zero Test', 'registered', 7),
  ('bulk-verify-positive', 'Bulk Positive Test', 'registered', 4);
select set_config('test.bulk_zero_id', (select id::text from public.participants where participant_key = 'bulk-verify-zero'), true);
select set_config('test.bulk_positive_id', (select id::text from public.participants where participant_key = 'bulk-verify-positive'), true);

select ok(not has_function_privilege('anon', 'public.admin_bulk_set_verified_badge_counts(jsonb)', 'EXECUTE'), 'anonymous clients cannot execute the bulk verification RPC');
select ok(has_function_privilege('authenticated', 'public.admin_bulk_set_verified_badge_counts(jsonb)', 'EXECUTE'), 'authenticated clients receive only the granted RPC entry point');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000601';
select is((
  select count(*)::integer from public.admin_bulk_set_verified_badge_counts(jsonb_build_array(
    jsonb_build_object('row_number', 2, 'participant_id', current_setting('test.bulk_zero_id'), 'badge_count', 0,
      'review_note', 'Bulk CSV: manually reviewed zero-badge profile.', 'expected_badge_count', 7,
      'expected_last_verified_at', null, 'expected_verification_source', null),
    jsonb_build_object('row_number', 3, 'participant_id', current_setting('test.bulk_positive_id'), 'badge_count', 10,
      'review_note', 'Bulk CSV: manually reviewed credential evidence.', 'expected_badge_count', 4,
      'expected_last_verified_at', null, 'expected_verification_source', null)
  ))
), 2, 'one RPC verifies multiple participants in a single transaction');
select is((select verified_badge_count from public.participants where id = current_setting('test.bulk_zero_id')::uuid), 0, 'bulk workflow records a verified zero');
select is((select verified_badge_count from public.participants where id = current_setting('test.bulk_positive_id')::uuid), 10, 'bulk workflow records a positive verified count');
select is((
  select count(*)::integer from public.participant_audit_events
  where participant_id = current_setting('test.bulk_zero_id')::uuid and event_type = 'badge_count_updated'
    and previous_badge_count = 7 and new_badge_count = 0 and source = 'admin_manual'
    and note = 'Bulk CSV: manually reviewed zero-badge profile.'
    and actor_user_id = '00000000-0000-4000-8000-000000000601'::uuid and verified_at is not null
), 1, 'zero audit records previous value, source, note, actor, and timestamp');
select is((
  select count(*)::integer from public.participant_audit_events
  where participant_id = current_setting('test.bulk_positive_id')::uuid and event_type = 'badge_count_updated'
    and previous_badge_count = 4 and new_badge_count = 10 and source = 'admin_manual'
    and note = 'Bulk CSV: manually reviewed credential evidence.'
    and actor_user_id = '00000000-0000-4000-8000-000000000601'::uuid and verified_at is not null
), 1, 'positive audit records previous value, source, note, actor, and timestamp');

select lives_ok($$select * from public.admin_bulk_set_verified_badge_counts(jsonb_build_array(
  jsonb_build_object('row_number', 2, 'participant_id', current_setting('test.bulk_zero_id'), 'badge_count', 0,
    'review_note', 'Bulk CSV: manually reviewed zero-badge profile.', 'expected_badge_count', 7,
    'expected_last_verified_at', null, 'expected_verification_source', null),
  jsonb_build_object('row_number', 3, 'participant_id', current_setting('test.bulk_positive_id'), 'badge_count', 10,
    'review_note', 'Bulk CSV: manually reviewed credential evidence.', 'expected_badge_count', 4,
    'expected_last_verified_at', null, 'expected_verification_source', null)
))$$, 'exact batch retries safely pass through the existing idempotent verification RPC');
select is((select count(*)::integer from public.participant_audit_events where participant_id in (current_setting('test.bulk_zero_id')::uuid, current_setting('test.bulk_positive_id')::uuid) and event_type = 'badge_count_updated'), 2, 'retrying the exact batch adds no duplicate audit events');

select throws_ok($$select * from public.admin_bulk_set_verified_badge_counts(jsonb_build_array(
  jsonb_build_object('row_number', 2, 'participant_id', current_setting('test.bulk_zero_id'), 'badge_count', 2,
    'review_note', 'Stale batch update.', 'expected_badge_count', 0,
    'expected_last_verified_at', (select last_verified_at from public.participants where id = current_setting('test.bulk_zero_id')::uuid),
    'expected_verification_source', 'admin_manual'),
  jsonb_build_object('row_number', 3, 'participant_id', current_setting('test.bulk_positive_id'), 'badge_count', 12,
    'review_note', 'Stale second row.', 'expected_badge_count', 4,
    'expected_last_verified_at', null, 'expected_verification_source', null)
))$$, '40001', 'Participant verification changed after preview; preview the CSV again', 'a stale participant state rejects the entire batch');
select is((select verified_badge_count from public.participants where id = current_setting('test.bulk_zero_id')::uuid), 0, 'stale batch rollback preserves earlier verified counts');
select is((select count(*)::integer from public.participant_audit_events where participant_id in (current_setting('test.bulk_zero_id')::uuid, current_setting('test.bulk_positive_id')::uuid) and event_type = 'badge_count_updated'), 2, 'stale batch rollback preserves audit history');
select throws_ok($$select * from public.admin_bulk_set_verified_badge_counts(jsonb_build_array(
  jsonb_build_object('row_number', 2, 'participant_id', current_setting('test.bulk_zero_id'), 'badge_count', 0,
    'review_note', 'Duplicate one.', 'expected_badge_count', 0, 'expected_last_verified_at', null, 'expected_verification_source', 'admin_manual'),
  jsonb_build_object('row_number', 3, 'participant_id', current_setting('test.bulk_zero_id'), 'badge_count', 1,
    'review_note', 'Duplicate two.', 'expected_badge_count', 0, 'expected_last_verified_at', null, 'expected_verification_source', 'admin_manual')
))$$, '22023', 'Bulk verification contains duplicate participants', 'duplicate participant UUIDs are rejected before writes');
reset role;
select is((select count(*)::integer from public.participant_auto_progress where participant_id in (current_setting('test.bulk_zero_id')::uuid, current_setting('test.bulk_positive_id')::uuid)), 0, 'verified CSV workflow does not write automatic progress snapshots');

select * from finish();
rollback;

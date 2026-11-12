-- Badge catalog, identity staging, deterministic preview, idempotent apply,
-- audit deduplication, rollback, and frozen-rank preservation.
--
-- Run with: supabase test db  (pgTAP). This file never touches production.
begin;
select no_plan();

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-4000-8000-000000000801', 'authenticated', 'authenticated',
  'badge-sync-admin@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
);
insert into public.admin_users (user_id) values ('00000000-0000-4000-8000-000000000801');

-- Authenticated but deliberately NOT in admin_users. Used to prove every RPC
-- keeps its server-side admin check.
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-4000-8000-000000000802', 'authenticated', 'authenticated',
  'badge-sync-nonadmin@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.participants (
  id, participant_key, display_name, registration_status,
  verified_badge_count, skill_badge_count, arcade_game_badge_count,
  removed_at, removal_reason
) values
  ('00000000-0000-4000-8000-0000000008b1', 'badge-sync-1', 'Badge Sync One', 'registered', 0, null, null, null, null),
  ('00000000-0000-4000-8000-0000000008b2', 'badge-sync-2', 'Badge Sync Two', 'registered', 0, null, null, null, null),
  ('00000000-0000-4000-8000-0000000008b3', 'badge-sync-removed', 'Badge Sync Removed', 'removed', 0, null, null, now(), 'Removed for badge sync test'),
  ('00000000-0000-4000-8000-0000000008b4', 'badge-sync-frozen', 'Badge Sync Frozen', 'registered', 10, 10, 0, null, null),
  ('00000000-0000-4000-8000-0000000008b5', 'badge-sync-incomplete', 'Badge Sync Incomplete', 'registered', 0, null, null, null, null),
  ('00000000-0000-4000-8000-0000000008b6', 'badge-sync-classified', 'Badge Sync Classified', 'registered', 0, null, null, null, null),
  ('00000000-0000-4000-8000-0000000008c1', 'rollback-current', 'Rollback Current State', 'registered', 0, null, null, null, null),
  ('00000000-0000-4000-8000-0000000008c2', 'rollback-later', 'Rollback Later Run', 'registered', 0, null, null, null, null),
  ('00000000-0000-4000-8000-0000000008c3', 'rollback-removed', 'Rollback Removed', 'registered', 0, null, null, null, null),
  ('00000000-0000-4000-8000-0000000008c4', 'split-race', 'Split Race', 'registered', 4, 3, 1, null, null);

-- ------------------------------------------------------------------
-- Managed catalog constraints.
-- ------------------------------------------------------------------
select is((select count(*)::integer from public.badge_catalog), 64, 'the verified 2026-11-09 seed contains 64 identities');
select is((select count(*)::integer from public.badge_catalog where category = 'skill'), 47, '47 seed identities are Skill');
select is((select count(*)::integer from public.badge_catalog where category = 'arcade'), 17, '17 seed identities are Arcade');
select is((select count(*)::integer from public.badge_catalog where badge_key like '/badges/%'), 0, 'no award-scoped /badges/<id> key is ever stored');
select is((select count(*)::integer from public.badge_catalog where badge_key !~ '^(course_template|game):[1-9][0-9]{0,19}$'), 0, 'every catalog key is a structural identity');

select ok(not has_table_privilege('anon', 'public.badge_catalog', 'INSERT'), 'anonymous clients cannot insert catalog rows');
select ok(not has_table_privilege('authenticated', 'public.badge_catalog', 'INSERT'), 'authenticated clients cannot insert catalog rows directly');
select ok(not has_table_privilege('authenticated', 'public.badge_catalog', 'UPDATE'), 'authenticated clients cannot update catalog rows directly');
select ok(not has_table_privilege('authenticated', 'public.badge_catalog', 'DELETE'), 'authenticated clients cannot delete catalog rows directly');
select ok(not has_function_privilege('anon', 'public.admin_upsert_badge_catalog_entries(jsonb)', 'EXECUTE'), 'anonymous clients cannot execute the catalog upsert RPC');
select ok(has_function_privilege('authenticated', 'public.admin_upsert_badge_catalog_entries(jsonb)', 'EXECUTE'), 'authenticated clients receive the catalog upsert entry point');
select ok(not has_function_privilege('anon', 'public.admin_create_badge_sync_run(text, text, text, text)', 'EXECUTE'), 'anonymous clients cannot create badge sync runs');
select ok(not has_function_privilege('anon', 'public.admin_apply_badge_sync_run(uuid, text, uuid)', 'EXECUTE'), 'anonymous clients cannot apply badge sync runs');
select ok(not has_function_privilege('anon', 'public.admin_rollback_badge_sync_run(uuid, uuid)', 'EXECUTE'), 'anonymous clients cannot roll back badge sync runs');
select ok(not has_function_privilege('anon', 'public.admin_bulk_rollback_classified_badge_counts(jsonb)', 'EXECUTE'), 'anonymous clients cannot execute the classified rollback RPC');
select ok(not has_table_privilege('authenticated', 'public.badge_sync_operation_ledger', 'INSERT'), 'authenticated clients cannot write the operation ledger directly');
select ok(not has_table_privilege('authenticated', 'public.badge_sync_operation_ledger', 'UPDATE'), 'authenticated clients cannot update the operation ledger directly');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000801';

select is((
  select inserted from public.admin_upsert_badge_catalog_entries(jsonb_build_array(
    jsonb_build_object(
      'badge_key', 'course_template:999901',
      'display_name', 'Test Skill Identity',
      'category', 'skill',
      'source', 'test'
    )
  ))
), true, 'a new structural catalog identity can be inserted through the admin RPC');

select is((
  select count(*)::integer from public.badge_catalog_audit_events
  where badge_key = 'course_template:999901' and previous_category is null and new_category = 'skill'
), 1, 'creating a catalog identity writes exactly one audit record');

select is((
  select changed from public.admin_update_badge_catalog_category(
    'course_template:999901', 'ignored', 'Test Skill Identity', 'covered by an ignored family'
  )
), true, 'an admin category change is reported as changed');

select is((
  select count(*)::integer from public.badge_catalog_audit_events
  where badge_key = 'course_template:999901'
), 2, 'a category change appends exactly one audit record');

select throws_ok($$
  select * from public.admin_update_badge_catalog_category(
    'course_template:999901', 'arcade', 'Test Skill Identity', 'invalid structural flip'
  )
$$, '22023', 'Catalog category conflicts with the structural badge type', 'a course template can never become Arcade');

select throws_ok($$
  select * from public.admin_update_badge_catalog_category(
    'course_template:999901', 'skill', 'Test Skill Identity', '   '
  )
$$, '22023', 'Category change reason must be 1 to 1000 characters', 'a category change requires a reason');

select throws_ok($$
  select * from public.admin_update_badge_catalog_category(
    'course_template:999901', null, 'Test Skill Identity', 'invalid null category'
  )
$$, '22023', 'Catalog category is invalid', 'a NULL catalog category returns a clean invalid-input error');

reset role;
select throws_ok($$
  delete from public.badge_catalog where badge_key = 'course_template:999901'
$$, '23503', 'Referenced badge catalog entries cannot be deleted', 'referenced catalog identities cannot be deleted');

-- ------------------------------------------------------------------
-- Observation staging: known, unknown, removed, incomplete.
-- ------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000801';

select set_config('test.obs_run_id', public.admin_create_badge_sync_run(
  'badge_observations', 'evidence.csv', null, 'Observation staging test'
)::text, true);
select is((select status from public.badge_sync_runs where id = current_setting('test.obs_run_id')::uuid), 'draft', 'a new observation run starts in draft');

select public.admin_stage_badge_sync_observations(
  current_setting('test.obs_run_id')::uuid,
  jsonb_build_array(
    jsonb_build_object(
      'participant_id', '00000000-0000-4000-8000-0000000008b1',
      'observation_status', 'complete',
      'review_note', 'known skill and arcade badges',
      'badges', jsonb_build_array(
        jsonb_build_object('badge_key', 'course_template:1080', 'badge_title', 'MLOps Model Evaluation'),
        jsonb_build_object('badge_key', 'game:102804', 'badge_title', 'Arcade Adventure: Google Cloud ML APIs')
      )
    ),
    jsonb_build_object(
      'participant_id', '00000000-0000-4000-8000-0000000008b2',
      'observation_status', 'complete',
      'badges', jsonb_build_array(
        jsonb_build_object('badge_key', 'course_template:999902', 'badge_title', 'Unknown Skill Identity')
      )
    ),
    jsonb_build_object(
      'participant_id', '00000000-0000-4000-8000-0000000008b5',
      'observation_status', 'incomplete',
      'badges', jsonb_build_array()
    ),
    jsonb_build_object(
      'participant_id', '00000000-0000-4000-8000-0000000008b3',
      'observation_status', 'complete',
      'badges', jsonb_build_array()
    )
  )
);

select is((select status from public.badge_sync_runs where id = current_setting('test.obs_run_id')::uuid), 'staged', 'staging a batch moves the run to staged');
select is((select category from public.badge_catalog where badge_key = 'course_template:999902'), 'unclassified', 'an unknown structural identity defaults to unclassified');
select is((select count(*)::integer from public.badge_catalog_audit_events
  where badge_key = 'course_template:999902'
    and previous_category is null
    and new_category = 'unclassified'
    and reason like 'Auto-created from staged badge evidence%'), 1, 'staging auto-creates an unknown identity with exactly one audit record');
select is((select status from public.badge_sync_staged_badges where run_id = current_setting('test.obs_run_id')::uuid and badge_key = 'course_template:1080'), 'pending', 'a known Skill badge starts pending');
select ok((select is_removed from public.badge_sync_participant_staging where run_id = current_setting('test.obs_run_id')::uuid and participant_id = '00000000-0000-4000-8000-0000000008b3'), 'a removed participant is marked removed during staging');
select ok((select observation_status = 'failed' from public.badge_sync_participant_staging where run_id = current_setting('test.obs_run_id')::uuid and participant_id = '00000000-0000-4000-8000-0000000008b3'), 'a removed participant observation is failed');
select ok((select skill_count is null and arcade_count is null and total_count is null from public.badge_sync_participant_staging where run_id = current_setting('test.obs_run_id')::uuid and participant_id = '00000000-0000-4000-8000-0000000008b3'), 'a removed participant stores NULL counts, never zero');
select ok((select observation_status = 'incomplete' and skill_count is null and arcade_count is null and total_count is null from public.badge_sync_participant_staging where run_id = current_setting('test.obs_run_id')::uuid and participant_id = '00000000-0000-4000-8000-0000000008b5'), 'an incomplete observation stores NULL counts, never zero');

select throws_ok(format($$
  select public.admin_stage_badge_sync_observations(
    %L, jsonb_build_array(jsonb_build_object(
      'participant_id', '00000000-0000-4000-8000-0000000008b1',
      'observation_status', 'complete',
      'badges', jsonb_build_array(
        jsonb_build_object('badge_key', 'course_template:1080', 'badge_title', 'First'),
        jsonb_build_object('badge_key', 'course_template:1080', 'badge_title', 'Second')
      )
    ))
  )
$$, current_setting('test.obs_run_id')), '22023', 'Duplicate badge identity in the staged participant', 'the same badge identity cannot be staged twice for one participant');

select throws_ok(format($$
  select public.admin_stage_badge_sync_observations(
    %L, jsonb_build_array(jsonb_build_object(
      'participant_id', '00000000-0000-4000-8000-0000000008b3',
      'observation_status', 'complete',
      'badges', jsonb_build_array(
        jsonb_build_object('badge_key', 'course_template:1080', 'badge_title', 'Removed badge')
      )
    ))
  )
$$, current_setting('test.obs_run_id')), '22023', 'Removed participants cannot stage badge observations', 'removed participants cannot stage badge identities');

select throws_ok(format($$
  select public.admin_stage_badge_sync_observations(
    %L, jsonb_build_array(jsonb_build_object(
      'participant_id', '00000000-0000-4000-8000-0000000008b1',
      'observation_status', 'complete',
      'badges', jsonb_build_array(
        jsonb_build_object('badge_key', '/badges/29485277', 'badge_title', 'Award scoped')
      )
    ))
  )
$$, current_setting('test.obs_run_id')), '22023', 'Badge identity must be course_template:<id> or game:<id>; /badges/<id> is award-scoped and invalid', 'award-scoped /badges ids are rejected as identities');

select throws_ok(format($$
  select public.admin_stage_badge_sync_observations(
    %L, jsonb_build_array(jsonb_build_object(
      'participant_id', '00000000-0000-4000-8000-0000000008b1',
      'observation_status', 'complete',
      'review_note', E'contains\ttab',
      'badges', '[]'::jsonb
    ))
  )
$$, current_setting('test.obs_run_id')), '22023', 'Review note must be 1 to 1000 printable characters', 'control characters are rejected in staged review notes');

-- ------------------------------------------------------------------
-- Deterministic preview.
-- ------------------------------------------------------------------
select is(public.admin_bulk_set_staged_badge_status(current_setting('test.obs_run_id')::uuid, 'approved'), 2, 'bulk approval approves every pending Skill/Arcade badge');

select public.admin_preview_badge_sync_run(current_setting('test.obs_run_id')::uuid);
select set_config('test.obs_fingerprint', (select preview_fingerprint from public.badge_sync_runs where id = current_setting('test.obs_run_id')::uuid), true);

select is((select status from public.badge_sync_runs where id = current_setting('test.obs_run_id')::uuid), 'previewed', 'preview moves the run to previewed');
select ok((select preview_fingerprint ~ '^[0-9a-f]{32}$' from public.badge_sync_runs where id = current_setting('test.obs_run_id')::uuid), 'preview generates a stable 32-hex fingerprint');
select is((select skill_count from public.badge_sync_participant_staging where run_id = current_setting('test.obs_run_id')::uuid and participant_id = '00000000-0000-4000-8000-0000000008b1'), 1, 'preview counts one approved Skill badge');
select is((select arcade_count from public.badge_sync_participant_staging where run_id = current_setting('test.obs_run_id')::uuid and participant_id = '00000000-0000-4000-8000-0000000008b1'), 1, 'preview counts one approved Arcade badge');
select is((select total_count from public.badge_sync_participant_staging where run_id = current_setting('test.obs_run_id')::uuid and participant_id = '00000000-0000-4000-8000-0000000008b1'), 2, 'preview enforces Skill + Arcade = Total');
select is((select status from public.badge_sync_participant_staging where run_id = current_setting('test.obs_run_id')::uuid and participant_id = '00000000-0000-4000-8000-0000000008b1'), 'approved', 'a complete known-badge participant is approved');
select is((select status from public.badge_sync_participant_staging where run_id = current_setting('test.obs_run_id')::uuid and participant_id = '00000000-0000-4000-8000-0000000008b2'), 'unclassified', 'an unknown-badge participant is blocked as unclassified');
select is((select unclassified_badge_count from public.badge_sync_participant_staging where run_id = current_setting('test.obs_run_id')::uuid and participant_id = '00000000-0000-4000-8000-0000000008b2'), 1, 'the unclassified badge is counted');
select is((select status from public.badge_sync_participant_staging where run_id = current_setting('test.obs_run_id')::uuid and participant_id = '00000000-0000-4000-8000-0000000008b5'), 'rejected', 'an incomplete observation is rejected');
select is((select total_participants from public.badge_sync_runs where id = current_setting('test.obs_run_id')::uuid), 1, 'the participant total counts only eligible rows that Apply will write');
select is((select total_skill from public.badge_sync_runs where id = current_setting('test.obs_run_id')::uuid), 1, 'the run Skill total counts only eligible rows');
select is((select total_arcade from public.badge_sync_runs where id = current_setting('test.obs_run_id')::uuid), 1, 'the run Arcade total counts only eligible rows');
select is((select total_badges from public.badge_sync_runs where id = current_setting('test.obs_run_id')::uuid), 2, 'the run total equals Skill + Arcade');
select is((select blocked_participant_count from public.badge_sync_runs where id = current_setting('test.obs_run_id')::uuid), 3, 'unclassified, incomplete, and removed participants are all blocked');

select public.admin_preview_badge_sync_run(current_setting('test.obs_run_id')::uuid);
select is((select preview_fingerprint from public.badge_sync_runs where id = current_setting('test.obs_run_id')::uuid), current_setting('test.obs_fingerprint'), 're-previewing identical staging produces the same fingerprint');

-- ------------------------------------------------------------------
-- Approval and apply guards.
-- ------------------------------------------------------------------
select public.admin_approve_badge_sync_run(current_setting('test.obs_run_id')::uuid, current_setting('test.obs_fingerprint'));
select is((select status from public.badge_sync_runs where id = current_setting('test.obs_run_id')::uuid), 'approved', 'the run becomes approved with a matching fingerprint');

select throws_ok(format($$
  select public.admin_apply_badge_sync_run(%L, %L, gen_random_uuid())
$$, current_setting('test.obs_run_id'), '00000000000000000000000000000000'), '40001', 'The preview fingerprint is stale; preview and approve again', 'a mismatched fingerprint cannot apply');

-- Simulate a concurrent apply that already owns the run lock.
reset role;
update public.badge_sync_runs set status = 'applying' where id = current_setting('test.obs_run_id')::uuid;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000801';
select throws_ok(format($$
  select public.admin_apply_badge_sync_run(%L, %L, gen_random_uuid())
$$, current_setting('test.obs_run_id'), current_setting('test.obs_fingerprint')), '40001', 'This run is already being applied', 'a concurrent apply is rejected while another holds the run');
reset role;
update public.badge_sync_runs set status = 'approved' where id = current_setting('test.obs_run_id')::uuid;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000801';

-- ------------------------------------------------------------------
-- Stale preview rejection.
-- ------------------------------------------------------------------
reset role;
update public.participants set verified_badge_count = 5 where id = '00000000-0000-4000-8000-0000000008b1';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000801';
select throws_ok(format($$
  select public.admin_apply_badge_sync_run(%L, %L, gen_random_uuid())
$$, current_setting('test.obs_run_id'), current_setting('test.obs_fingerprint')), '40001', 'The badge sync preview changed; preview and approve again', 'a participant change after approval stales the whole preview');
reset role;
update public.participants set verified_badge_count = 0 where id = '00000000-0000-4000-8000-0000000008b1';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000801';

-- ------------------------------------------------------------------
-- Apply, audit deduplication, rollback.
-- ------------------------------------------------------------------
select set_config('test.obs_request_1', gen_random_uuid()::text, true);
select set_config('test.obs_result_1', public.admin_apply_badge_sync_run(
  current_setting('test.obs_run_id')::uuid,
  current_setting('test.obs_fingerprint'),
  current_setting('test.obs_request_1')::uuid
)::text, true);

select is((select status from public.badge_sync_runs where id = current_setting('test.obs_run_id')::uuid), 'applied', 'the run reaches applied');
select is((select (current_setting('test.obs_result_1')::jsonb ->> 'applied_count')::integer), 1, 'apply reports one applied participant');
select is((select (current_setting('test.obs_result_1')::jsonb ->> 'blocked_count')::integer), 3, 'apply reports three blocked participants');
select is((select verified_badge_count from public.participants where id = '00000000-0000-4000-8000-0000000008b1'), 2, 'apply writes the approved total');
select is((select skill_badge_count from public.participants where id = '00000000-0000-4000-8000-0000000008b1'), 1, 'apply writes the approved Skill count');
select is((select arcade_game_badge_count from public.participants where id = '00000000-0000-4000-8000-0000000008b1'), 1, 'apply writes the approved Arcade count');
select is((select count(*)::integer from public.participant_audit_events where participant_id = '00000000-0000-4000-8000-0000000008b1' and event_type = 'badge_count_updated' and new_badge_count = 2), 1, 'apply appends exactly one audit event');
select is((select total_participants from public.badge_sync_runs where id = current_setting('test.obs_run_id')::uuid), 1, 'preview total_participants matches the rows Apply actually writes');
select is(
  (select (current_setting('test.obs_result_1')::jsonb ->> 'applied_count')::integer),
  (select total_participants from public.badge_sync_runs where id = current_setting('test.obs_run_id')::uuid),
  'preview totals and apply totals are identical'
);
select is((select applied_total from public.badge_sync_participant_staging
  where run_id = current_setting('test.obs_run_id')::uuid
    and participant_id = '00000000-0000-4000-8000-0000000008b1'), 2, 'apply records the post-apply total snapshot');
select is((select applied_skill from public.badge_sync_participant_staging
  where run_id = current_setting('test.obs_run_id')::uuid
    and participant_id = '00000000-0000-4000-8000-0000000008b1'), 1, 'apply records the post-apply Skill snapshot');
select is((select applied_arcade from public.badge_sync_participant_staging
  where run_id = current_setting('test.obs_run_id')::uuid
    and participant_id = '00000000-0000-4000-8000-0000000008b1'), 1, 'apply records the post-apply Arcade snapshot');
select is((select count(*)::integer from public.badge_sync_operation_ledger
  where run_id = current_setting('test.obs_run_id')::uuid and operation_type = 'apply'), 1, 'apply writes exactly one durable ledger row per participant');
select is((
  select count(*)::integer
  from jsonb_array_elements(current_setting('test.obs_result_1')::jsonb -> 'blocked') as blocked
  join public.badge_sync_participant_staging as staging
    on staging.run_id = current_setting('test.obs_run_id')::uuid
    and staging.participant_id = (blocked ->> 'participant_id')::uuid
  where (blocked ->> 'row_number')::integer = staging.row_number
), 3, 'blocked apply results preserve the original staging row numbers');

select set_config('test.obs_request_2', gen_random_uuid()::text, true);
select set_config('test.obs_result_2', public.admin_apply_badge_sync_run(
  current_setting('test.obs_run_id')::uuid,
  current_setting('test.obs_fingerprint'),
  current_setting('test.obs_request_2')::uuid
)::text, true);
select is((select current_setting('test.obs_result_2')::jsonb ->> 'request_id'), current_setting('test.obs_request_1'), 'a repeated apply replays the stored result for the first request');
select is((select apply_request_id::text from public.badge_sync_runs where id = current_setting('test.obs_run_id')::uuid), current_setting('test.obs_request_1'), 'a repeated apply does not overwrite the stored request id');
select is((select count(*)::integer from public.participant_audit_events where participant_id = '00000000-0000-4000-8000-0000000008b1' and event_type = 'badge_count_updated' and new_badge_count = 2), 1, 'a repeated apply appends no duplicate audit event');

select set_config('test.rollback_request_1', gen_random_uuid()::text, true);
select set_config('test.rollback_result_1', public.admin_rollback_badge_sync_run(
  current_setting('test.obs_run_id')::uuid,
  current_setting('test.rollback_request_1')::uuid
)::text, true);
select is((select status from public.badge_sync_runs where id = current_setting('test.obs_run_id')::uuid), 'rolled_back', 'rollback reaches rolled_back');
select is((select (current_setting('test.rollback_result_1')::jsonb ->> 'restored_count')::integer), 1, 'rollback restores the applied participant');
select is((select verified_badge_count from public.participants where id = '00000000-0000-4000-8000-0000000008b1'), 0, 'rollback restores the previous total');
select is((select skill_badge_count from public.participants where id = '00000000-0000-4000-8000-0000000008b1'), null, 'rollback restores the previous NULL Skill count');
select is((select arcade_game_badge_count from public.participants where id = '00000000-0000-4000-8000-0000000008b1'), null, 'rollback restores the previous NULL Arcade count');
select is((select count(*)::integer from public.participant_audit_events where participant_id = '00000000-0000-4000-8000-0000000008b1' and event_type = 'badge_count_updated'), 2, 'rollback appends an audit event without deleting history');
select is((select count(*)::integer from public.participant_audit_events where participant_id = '00000000-0000-4000-8000-0000000008b1' and event_type = 'badge_count_updated' and new_badge_count = 2), 1, 'the original apply audit event is preserved');
select is((select count(*)::integer from public.badge_sync_operation_ledger
  where run_id = current_setting('test.obs_run_id')::uuid and operation_type = 'rollback'), 1, 'rollback writes exactly one durable ledger row per participant');
select is((select count(*)::integer from public.badge_sync_operation_ledger
  where run_id = current_setting('test.obs_run_id')::uuid), 2, 'apply and rollback are recorded as two distinct operations');

select set_config('test.rollback_request_2', gen_random_uuid()::text, true);
select is((select (public.admin_rollback_badge_sync_run(
  current_setting('test.obs_run_id')::uuid,
  current_setting('test.rollback_request_2')::uuid
) ->> 'request_id')), current_setting('test.rollback_request_1'), 'a repeated rollback replays the stored result');
select is((select count(*)::integer from public.participant_audit_events where participant_id = '00000000-0000-4000-8000-0000000008b1' and event_type = 'badge_count_updated'), 2, 'a repeated rollback appends no duplicate audit event');

-- ------------------------------------------------------------------
-- Frozen ranks are preserved by apply and rollback.
-- ------------------------------------------------------------------
select set_config('test.frozen_rank_before', (select frozen_rank::text from public.participants where id = '00000000-0000-4000-8000-0000000008b4'), true);
select set_config('test.frozen_at_before', (select rank_frozen_at::text from public.participants where id = '00000000-0000-4000-8000-0000000008b4'), true);

select set_config('test.frozen_run_id', public.admin_create_badge_sync_run(
  'badge_observations', 'frozen.csv', null, 'Frozen rank preservation'
)::text, true);
select public.admin_stage_badge_sync_observations(
  current_setting('test.frozen_run_id')::uuid,
  jsonb_build_array(jsonb_build_object(
    'participant_id', '00000000-0000-4000-8000-0000000008b4',
    'observation_status', 'complete',
    'badges', jsonb_build_array(
      jsonb_build_object('badge_key', 'course_template:1080', 'badge_title', 'Skill 1'),
      jsonb_build_object('badge_key', 'course_template:1171', 'badge_title', 'Skill 2'),
      jsonb_build_object('badge_key', 'course_template:1426', 'badge_title', 'Skill 3'),
      jsonb_build_object('badge_key', 'course_template:1449', 'badge_title', 'Skill 4'),
      jsonb_build_object('badge_key', 'course_template:1585', 'badge_title', 'Skill 5'),
      jsonb_build_object('badge_key', 'course_template:1586', 'badge_title', 'Skill 6'),
      jsonb_build_object('badge_key', 'course_template:388', 'badge_title', 'Skill 7'),
      jsonb_build_object('badge_key', 'course_template:536', 'badge_title', 'Skill 8'),
      jsonb_build_object('badge_key', 'course_template:539', 'badge_title', 'Skill 9'),
      jsonb_build_object('badge_key', 'course_template:554', 'badge_title', 'Skill 10'),
      jsonb_build_object('badge_key', 'game:102804', 'badge_title', 'Arcade 1')
    )
  ))
);
select public.admin_bulk_set_staged_badge_status(current_setting('test.frozen_run_id')::uuid, 'approved');
select public.admin_preview_badge_sync_run(current_setting('test.frozen_run_id')::uuid);
select set_config('test.frozen_fingerprint', (select preview_fingerprint from public.badge_sync_runs where id = current_setting('test.frozen_run_id')::uuid), true);
select public.admin_approve_badge_sync_run(current_setting('test.frozen_run_id')::uuid, current_setting('test.frozen_fingerprint'));
select public.admin_apply_badge_sync_run(
  current_setting('test.frozen_run_id')::uuid,
  current_setting('test.frozen_fingerprint'),
  gen_random_uuid()
);
select is((select verified_badge_count from public.participants where id = '00000000-0000-4000-8000-0000000008b4'), 11, 'apply can raise an already-frozen participant total');
select is((select frozen_rank::text from public.participants where id = '00000000-0000-4000-8000-0000000008b4'), current_setting('test.frozen_rank_before'), 'apply never changes frozen_rank');
select is((select rank_frozen_at::text from public.participants where id = '00000000-0000-4000-8000-0000000008b4'), current_setting('test.frozen_at_before'), 'apply never changes rank_frozen_at');

select public.admin_rollback_badge_sync_run(current_setting('test.frozen_run_id')::uuid, gen_random_uuid());
select is((select verified_badge_count from public.participants where id = '00000000-0000-4000-8000-0000000008b4'), 10, 'rollback restores the frozen participant total');
select is((select skill_badge_count from public.participants where id = '00000000-0000-4000-8000-0000000008b4'), 10, 'rollback restores the frozen participant Skill count');
select is((select frozen_rank::text from public.participants where id = '00000000-0000-4000-8000-0000000008b4'), current_setting('test.frozen_rank_before'), 'rollback never changes frozen_rank');
select is((select rank_frozen_at::text from public.participants where id = '00000000-0000-4000-8000-0000000008b4'), current_setting('test.frozen_at_before'), 'rollback never changes rank_frozen_at');

-- ------------------------------------------------------------------
-- Existing classified CSV compatibility through the run lifecycle.
-- ------------------------------------------------------------------
select set_config('test.classified_snapshot', public.admin_create_classified_badge_sync_run(
  jsonb_build_array(jsonb_build_object(
    'row_number', 2,
    'participant_id', '00000000-0000-4000-8000-0000000008b6',
    'skill_count', 2,
    'arcade_count', 1,
    'total_count', 3,
    'review_note', 'classified run compatibility',
    'expected_total_count', 0,
    'expected_last_verified_at', null,
    'expected_verification_source', null
  )),
  'classified.csv',
  null
)::text, true);
select set_config('test.classified_run_id', current_setting('test.classified_snapshot')::jsonb #>> '{run,id}', true);
select set_config('test.classified_fingerprint', current_setting('test.classified_snapshot')::jsonb #>> '{run,preview_fingerprint}', true);

select is((select status from public.badge_sync_runs where id = current_setting('test.classified_run_id')::uuid), 'previewed', 'the classified CSV path creates a previewed run');
select is((select status from public.badge_sync_participant_staging where run_id = current_setting('test.classified_run_id')::uuid and participant_id = '00000000-0000-4000-8000-0000000008b6'), 'approved', 'a non-regressing classified row is approved');
select public.admin_approve_badge_sync_run(current_setting('test.classified_run_id')::uuid, current_setting('test.classified_fingerprint'));
select set_config('test.classified_request_1', gen_random_uuid()::text, true);
select is((select (public.admin_apply_badge_sync_run(
  current_setting('test.classified_run_id')::uuid,
  current_setting('test.classified_fingerprint'),
  current_setting('test.classified_request_1')::uuid
) ->> 'applied_count')::integer), 1, 'the classified run applies through the same idempotent writer');
select is((select verified_badge_count from public.participants where id = '00000000-0000-4000-8000-0000000008b6'), 3, 'the classified run writes the requested total');
select is((select skill_badge_count from public.participants where id = '00000000-0000-4000-8000-0000000008b6'), 2, 'the classified run writes the requested Skill count');
select is((select arcade_game_badge_count from public.participants where id = '00000000-0000-4000-8000-0000000008b6'), 1, 'the classified run writes the requested Arcade count');
select is((select count(*)::integer from public.participant_audit_events where participant_id = '00000000-0000-4000-8000-0000000008b6' and event_type = 'badge_count_updated'), 1, 'the classified run writes one audit event');
select is((select (public.admin_apply_badge_sync_run(
  current_setting('test.classified_run_id')::uuid,
  current_setting('test.classified_fingerprint'),
  gen_random_uuid()
) ->> 'request_id')), current_setting('test.classified_request_1'), 'a repeated classified apply replays the stored result');
select is((select count(*)::integer from public.participant_audit_events where participant_id = '00000000-0000-4000-8000-0000000008b6' and event_type = 'badge_count_updated'), 1, 'a repeated classified apply appends no duplicate audit event');

-- ------------------------------------------------------------------
-- Current-state-aware rollback, later-run protection, removed participants.
-- ------------------------------------------------------------------
select set_config('test.rb_current_snapshot', public.admin_create_classified_badge_sync_run(
  jsonb_build_array(jsonb_build_object(
    'row_number', 2,
    'participant_id', '00000000-0000-4000-8000-0000000008c1',
    'skill_count', 2,
    'arcade_count', 1,
    'total_count', 3,
    'review_note', 'rollback current-state test',
    'expected_total_count', 0,
    'expected_last_verified_at', null,
    'expected_verification_source', null
  )),
  'rollback-current.csv',
  null
)::text, true);
select set_config('test.rb_current_run', current_setting('test.rb_current_snapshot')::jsonb #>> '{run,id}', true);
select set_config('test.rb_current_fp', current_setting('test.rb_current_snapshot')::jsonb #>> '{run,preview_fingerprint}', true);
select public.admin_approve_badge_sync_run(current_setting('test.rb_current_run')::uuid, current_setting('test.rb_current_fp'));
select public.admin_apply_badge_sync_run(
  current_setting('test.rb_current_run')::uuid,
  current_setting('test.rb_current_fp'),
  gen_random_uuid()
);

reset role;
update public.participants
set verified_badge_count = 4, skill_badge_count = 3, arcade_game_badge_count = 1
where id = '00000000-0000-4000-8000-0000000008c1';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000801';

select throws_ok(format($$
  select public.admin_rollback_badge_sync_run(%L, gen_random_uuid())
$$, current_setting('test.rb_current_run')), '40001', 'Participant changed after apply; rollback is blocked', 'a participant changed after apply cannot be rolled back');

reset role;
update public.participants
set verified_badge_count = 3, skill_badge_count = 2, arcade_game_badge_count = 1
where id = '00000000-0000-4000-8000-0000000008c1';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000801';

select is((public.admin_rollback_badge_sync_run(
  current_setting('test.rb_current_run')::uuid,
  gen_random_uuid()
) ->> 'restored_count')::integer, 1, 'rollback succeeds once live state again matches the post-apply snapshot');
select is((select verified_badge_count from public.participants where id = '00000000-0000-4000-8000-0000000008c1'), 0, 'the restored total is the pre-apply value');

-- A later applied run on the same participant blocks an older rollback.
select set_config('test.rb_later_a_snapshot', public.admin_create_classified_badge_sync_run(
  jsonb_build_array(jsonb_build_object(
    'row_number', 2,
    'participant_id', '00000000-0000-4000-8000-0000000008c2',
    'skill_count', 2,
    'arcade_count', 1,
    'total_count', 3,
    'review_note', 'older run',
    'expected_total_count', 0,
    'expected_last_verified_at', null,
    'expected_verification_source', null
  )),
  'rollback-older.csv',
  null
)::text, true);
select set_config('test.rb_later_a_run', current_setting('test.rb_later_a_snapshot')::jsonb #>> '{run,id}', true);
select set_config('test.rb_later_a_fp', current_setting('test.rb_later_a_snapshot')::jsonb #>> '{run,preview_fingerprint}', true);
select public.admin_approve_badge_sync_run(current_setting('test.rb_later_a_run')::uuid, current_setting('test.rb_later_a_fp'));
select public.admin_apply_badge_sync_run(
  current_setting('test.rb_later_a_run')::uuid,
  current_setting('test.rb_later_a_fp'),
  gen_random_uuid()
);

select set_config('test.rb_later_verified_at', (select to_char(last_verified_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  from public.participants where id = '00000000-0000-4000-8000-0000000008c2'), true);
select set_config('test.rb_later_source', (select verification_source
  from public.participants where id = '00000000-0000-4000-8000-0000000008c2'), true);

select set_config('test.rb_later_b_snapshot', public.admin_create_classified_badge_sync_run(
  jsonb_build_array(jsonb_build_object(
    'row_number', 2,
    'participant_id', '00000000-0000-4000-8000-0000000008c2',
    'skill_count', 3,
    'arcade_count', 1,
    'total_count', 4,
    'review_note', 'later run',
    'expected_total_count', 3,
    'expected_last_verified_at', current_setting('test.rb_later_verified_at'),
    'expected_verification_source', current_setting('test.rb_later_source')
  )),
  'rollback-later.csv',
  null
)::text, true);
select set_config('test.rb_later_b_run', current_setting('test.rb_later_b_snapshot')::jsonb #>> '{run,id}', true);
select set_config('test.rb_later_b_fp', current_setting('test.rb_later_b_snapshot')::jsonb #>> '{run,preview_fingerprint}', true);
select public.admin_approve_badge_sync_run(current_setting('test.rb_later_b_run')::uuid, current_setting('test.rb_later_b_fp'));
select public.admin_apply_badge_sync_run(
  current_setting('test.rb_later_b_run')::uuid,
  current_setting('test.rb_later_b_fp'),
  gen_random_uuid()
);

select throws_ok(format($$
  select public.admin_rollback_badge_sync_run(%L, gen_random_uuid())
$$, current_setting('test.rb_later_a_run')), '40001', 'A later applied badge sync run changed these participants; rollback is blocked', 'an older run cannot overwrite a later applied run');
select is((public.admin_rollback_badge_sync_run(
  current_setting('test.rb_later_b_run')::uuid,
  gen_random_uuid()
) ->> 'restored_count')::integer, 1, 'the later run itself can still be rolled back');
select is((select verified_badge_count from public.participants where id = '00000000-0000-4000-8000-0000000008c2'), 3, 'rolling back the later run restores the intervening state');
select is((public.admin_rollback_badge_sync_run(
  current_setting('test.rb_later_a_run')::uuid,
  gen_random_uuid()
) ->> 'restored_count')::integer, 1, 'the older run becomes rollback-able after the later run is rolled back');
select is((select verified_badge_count from public.participants where id = '00000000-0000-4000-8000-0000000008c2'), 0, 'the older rollback restores its own pre-apply state');

-- Removed participants cannot be rolled back even with a valid snapshot.
select set_config('test.rb_removed_snapshot', public.admin_create_classified_badge_sync_run(
  jsonb_build_array(jsonb_build_object(
    'row_number', 2,
    'participant_id', '00000000-0000-4000-8000-0000000008c3',
    'skill_count', 1,
    'arcade_count', 0,
    'total_count', 1,
    'review_note', 'removed rollback test',
    'expected_total_count', 0,
    'expected_last_verified_at', null,
    'expected_verification_source', null
  )),
  'rollback-removed.csv',
  null
)::text, true);
select set_config('test.rb_removed_run', current_setting('test.rb_removed_snapshot')::jsonb #>> '{run,id}', true);
select set_config('test.rb_removed_fp', current_setting('test.rb_removed_snapshot')::jsonb #>> '{run,preview_fingerprint}', true);
select public.admin_approve_badge_sync_run(current_setting('test.rb_removed_run')::uuid, current_setting('test.rb_removed_fp'));
select public.admin_apply_badge_sync_run(
  current_setting('test.rb_removed_run')::uuid,
  current_setting('test.rb_removed_fp'),
  gen_random_uuid()
);

reset role;
update public.participants
set registration_status = 'removed', removed_at = now(), removal_reason = 'rollback removed participant test'
where id = '00000000-0000-4000-8000-0000000008c3';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000801';

select throws_ok(format($$
  select public.admin_rollback_badge_sync_run(%L, gen_random_uuid())
$$, current_setting('test.rb_removed_run')), '22023', 'Removed participants cannot be rolled back', 'removed participants are rejected during rollback');

reset role;
update public.participants
set registration_status = 'registered', removed_at = null, removal_reason = null
where id = '00000000-0000-4000-8000-0000000008c3';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000801';

-- Same-total split race: the total matches but the live Skill/Arcade split
-- changed after preview. It must reject with 40001 and write nothing.
reset role;
update public.participants
set skill_badge_count = 4, arcade_game_badge_count = 0
where id = '00000000-0000-4000-8000-0000000008c4';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000801';

select throws_ok($$
  select * from public.admin_bulk_set_classified_badge_counts(jsonb_build_array(
    jsonb_build_object(
      'row_number', 2,
      'participant_id', '00000000-0000-4000-8000-0000000008c4',
      'skill_count', 2,
      'arcade_count', 2,
      'total_count', 4,
      'review_note', 'same-total split race',
      'expected_total_count', 4,
      'expected_last_verified_at', null,
      'expected_verification_source', null,
      'expected_skill_count', 3,
      'expected_arcade_count', 1
    )
  ))
$$, '40001', 'Participant verification changed after preview; preview the CSV again', 'a same-total but different Skill/Arcade split is rejected as stale');
select is((select skill_badge_count from public.participants where id = '00000000-0000-4000-8000-0000000008c4'), 4, 'a stale split change writes no Skill count');
select is((select arcade_game_badge_count from public.participants where id = '00000000-0000-4000-8000-0000000008c4'), 0, 'a stale split change writes no Arcade count');
select is((select count(*)::integer from public.participant_audit_events where participant_id = '00000000-0000-4000-8000-0000000008c4'), 0, 'a stale split change appends no audit event');

-- ------------------------------------------------------------------
-- Non-admin authenticated callers are rejected server-side.
-- ------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000802';

select throws_ok($$
  select public.admin_apply_badge_sync_run(gen_random_uuid(), repeat('a', 32), gen_random_uuid())
$$, '42501', 'Admin access required', 'a non-admin authenticated caller cannot apply a run');
select throws_ok($$
  select public.admin_rollback_badge_sync_run(gen_random_uuid(), gen_random_uuid())
$$, '42501', 'Admin access required', 'a non-admin authenticated caller cannot roll back a run');
select throws_ok($$
  select public.admin_approve_badge_sync_run(gen_random_uuid(), repeat('a', 32))
$$, '42501', 'Admin access required', 'a non-admin authenticated caller cannot approve a run');
select throws_ok($$
  select public.admin_create_classified_badge_sync_run('[]'::jsonb, null, null)
$$, '42501', 'Admin access required', 'a non-admin authenticated caller cannot create a run');

reset role;
select * from finish();
rollback;

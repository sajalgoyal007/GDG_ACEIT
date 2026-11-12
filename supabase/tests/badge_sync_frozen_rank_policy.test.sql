-- Phase 1.6: frozen-rank behavior across badge-sync apply and rollback.
--
-- Covers the five required policy cases:
--   1. A normal apply that crosses the 10-Skill-Badge threshold allocates a rank.
--   2. Rollback after that first allocation restores the counts but never the rank.
--   3. A later applied run blocks an older rollback; the rank survives every step.
--   4. A participant removed after apply cannot be rolled back; the rank survives.
--   5. A repeated rollback replays the stored result without duplicate audit/ledger.
--
-- Run with: supabase test db  (pgTAP). This file never touches production.
begin;
select no_plan();

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-4000-8000-000000000b01', 'authenticated', 'authenticated',
  'badge-sync-frozen-policy@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
);
insert into public.admin_users (user_id) values ('00000000-0000-4000-8000-000000000b01');

insert into public.participants (
  id, participant_key, display_name, registration_status,
  verified_badge_count, skill_badge_count, arcade_game_badge_count
) values
  ('00000000-0000-4000-8000-000000000b11', 'frozen-policy-crossing', 'Frozen Policy Crossing', 'registered', 9, 9, 0),
  ('00000000-0000-4000-8000-000000000b12', 'frozen-policy-later', 'Frozen Policy Later', 'registered', 9, 9, 0),
  ('00000000-0000-4000-8000-000000000b13', 'frozen-policy-removed', 'Frozen Policy Removed', 'registered', 9, 9, 0);

select set_config('test.frp_max_before', coalesce(max(frozen_rank), 0)::text, true)
from public.participants;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000b01';

-- ------------------------------------------------------------------
-- 1. Normal apply that crosses a rank threshold.
-- ------------------------------------------------------------------
select set_config('test.frp_cross_snapshot', public.admin_create_classified_badge_sync_run(
  jsonb_build_array(jsonb_build_object(
    'row_number', 2,
    'participant_id', '00000000-0000-4000-8000-000000000b11',
    'skill_count', 10,
    'arcade_count', 0,
    'total_count', 10,
    'review_note', 'frozen policy first crossing',
    'expected_total_count', 9,
    'expected_last_verified_at', null,
    'expected_verification_source', null
  )),
  'frozen-policy-crossing.csv',
  null
)::text, true);
select set_config('test.frp_cross_run', current_setting('test.frp_cross_snapshot')::jsonb #>> '{run,id}', true);
select set_config('test.frp_cross_fp', current_setting('test.frp_cross_snapshot')::jsonb #>> '{run,preview_fingerprint}', true);
select public.admin_approve_badge_sync_run(
  current_setting('test.frp_cross_run')::uuid,
  current_setting('test.frp_cross_fp')
);
select public.admin_apply_badge_sync_run(
  current_setting('test.frp_cross_run')::uuid,
  current_setting('test.frp_cross_fp'),
  gen_random_uuid()
);

select is((select verified_badge_count from public.participants where id = '00000000-0000-4000-8000-000000000b11'), 10, 'apply raises the total to the threshold');
select is((select skill_badge_count from public.participants where id = '00000000-0000-4000-8000-000000000b11'), 10, 'apply raises Skill Badges to 10');
select ok((select frozen_rank is not null from public.participants where id = '00000000-0000-4000-8000-000000000b11'), 'first threshold crossing allocates a frozen rank');
select is(
  (select frozen_rank::text from public.participants where id = '00000000-0000-4000-8000-000000000b11'),
  ((current_setting('test.frp_max_before')::integer + 1)::text),
  'the allocated rank is the next sequential rank'
);
select ok((select rank_frozen_at is not null from public.participants where id = '00000000-0000-4000-8000-000000000b11'), 'the allocation records a frozen timestamp');
select set_config('test.frp_cross_rank', (select frozen_rank::text from public.participants where id = '00000000-0000-4000-8000-000000000b11'), true);
select set_config('test.frp_cross_rank_at', (select rank_frozen_at::text from public.participants where id = '00000000-0000-4000-8000-000000000b11'), true);

-- ------------------------------------------------------------------
-- 2. Rollback after the new frozen rank exists.
-- ------------------------------------------------------------------
select set_config('test.frp_cross_rollback_1', gen_random_uuid()::text, true);
select is((
  public.admin_rollback_badge_sync_run(
    current_setting('test.frp_cross_run')::uuid,
    current_setting('test.frp_cross_rollback_1')::uuid
  ) ->> 'restored_count'
)::integer, 1, 'rollback restores the crossing participant');
select is((select verified_badge_count from public.participants where id = '00000000-0000-4000-8000-000000000b11'), 9, 'rollback restores the pre-crossing total');
select is((select skill_badge_count from public.participants where id = '00000000-0000-4000-8000-000000000b11'), 9, 'rollback restores the pre-crossing Skill count');
select is(
  (select frozen_rank::text from public.participants where id = '00000000-0000-4000-8000-000000000b11'),
  current_setting('test.frp_cross_rank'),
  'rollback never clears a frozen rank'
);
select is(
  (select rank_frozen_at::text from public.participants where id = '00000000-0000-4000-8000-000000000b11'),
  current_setting('test.frp_cross_rank_at'),
  'rollback never changes the frozen timestamp'
);
select is((
  select count(*)::integer from public.badge_sync_operation_ledger
  where run_id = current_setting('test.frp_cross_run')::uuid
    and operation_type = 'rollback'
), 1, 'rollback writes one rollback ledger row');

-- ------------------------------------------------------------------
-- 3. Later-run apply followed by an older-run rollback attempt.
-- ------------------------------------------------------------------
select set_config('test.frp_later_a_snapshot', public.admin_create_classified_badge_sync_run(
  jsonb_build_array(jsonb_build_object(
    'row_number', 2,
    'participant_id', '00000000-0000-4000-8000-000000000b12',
    'skill_count', 10,
    'arcade_count', 0,
    'total_count', 10,
    'review_note', 'frozen policy older run',
    'expected_total_count', 9,
    'expected_last_verified_at', null,
    'expected_verification_source', null
  )),
  'frozen-policy-older.csv',
  null
)::text, true);
select set_config('test.frp_later_a_run', current_setting('test.frp_later_a_snapshot')::jsonb #>> '{run,id}', true);
select set_config('test.frp_later_a_fp', current_setting('test.frp_later_a_snapshot')::jsonb #>> '{run,preview_fingerprint}', true);
select public.admin_approve_badge_sync_run(
  current_setting('test.frp_later_a_run')::uuid,
  current_setting('test.frp_later_a_fp')
);
select public.admin_apply_badge_sync_run(
  current_setting('test.frp_later_a_run')::uuid,
  current_setting('test.frp_later_a_fp'),
  gen_random_uuid()
);
select set_config('test.frp_later_rank', (select frozen_rank::text from public.participants where id = '00000000-0000-4000-8000-000000000b12'), true);
select set_config('test.frp_later_rank_at', (select rank_frozen_at::text from public.participants where id = '00000000-0000-4000-8000-000000000b12'), true);
select set_config('test.frp_later_verified_at', (select to_char(last_verified_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') from public.participants where id = '00000000-0000-4000-8000-000000000b12'), true);
select set_config('test.frp_later_source', (select verification_source from public.participants where id = '00000000-0000-4000-8000-000000000b12'), true);

select set_config('test.frp_later_b_snapshot', public.admin_create_classified_badge_sync_run(
  jsonb_build_array(jsonb_build_object(
    'row_number', 2,
    'participant_id', '00000000-0000-4000-8000-000000000b12',
    'skill_count', 10,
    'arcade_count', 1,
    'total_count', 11,
    'review_note', 'frozen policy later run',
    'expected_total_count', 10,
    'expected_last_verified_at', current_setting('test.frp_later_verified_at'),
    'expected_verification_source', current_setting('test.frp_later_source')
  )),
  'frozen-policy-later.csv',
  null
)::text, true);
select set_config('test.frp_later_b_run', current_setting('test.frp_later_b_snapshot')::jsonb #>> '{run,id}', true);
select set_config('test.frp_later_b_fp', current_setting('test.frp_later_b_snapshot')::jsonb #>> '{run,preview_fingerprint}', true);
select public.admin_approve_badge_sync_run(
  current_setting('test.frp_later_b_run')::uuid,
  current_setting('test.frp_later_b_fp')
);
select public.admin_apply_badge_sync_run(
  current_setting('test.frp_later_b_run')::uuid,
  current_setting('test.frp_later_b_fp'),
  gen_random_uuid()
);

select is((select verified_badge_count from public.participants where id = '00000000-0000-4000-8000-000000000b12'), 11, 'the later run writes its total');
select throws_ok(format($$
  select public.admin_rollback_badge_sync_run(%L, gen_random_uuid())
$$, current_setting('test.frp_later_a_run')),
  '40001',
  'A later applied badge sync run changed these participants; rollback is blocked',
  'an older rollback is blocked after a later applied run'
);
select is(
  (select frozen_rank::text from public.participants where id = '00000000-0000-4000-8000-000000000b12'),
  current_setting('test.frp_later_rank'),
  'the blocked older rollback does not change the frozen rank'
);

select is((
  public.admin_rollback_badge_sync_run(
    current_setting('test.frp_later_b_run')::uuid,
    gen_random_uuid()
  ) ->> 'restored_count'
)::integer, 1, 'the later run can still be rolled back');
select is((select verified_badge_count from public.participants where id = '00000000-0000-4000-8000-000000000b12'), 10, 'rolling back the later run restores the intervening total');
select is(
  (select frozen_rank::text from public.participants where id = '00000000-0000-4000-8000-000000000b12'),
  current_setting('test.frp_later_rank'),
  'the rank survives rolling back the later run'
);

select is((
  public.admin_rollback_badge_sync_run(
    current_setting('test.frp_later_a_run')::uuid,
    gen_random_uuid()
  ) ->> 'restored_count'
)::integer, 1, 'the older run becomes rollback-able after the later run is rolled back');
select is((select verified_badge_count from public.participants where id = '00000000-0000-4000-8000-000000000b12'), 9, 'the older rollback restores its own pre-apply total');
select is(
  (select frozen_rank::text from public.participants where id = '00000000-0000-4000-8000-000000000b12'),
  current_setting('test.frp_later_rank'),
  'the rank survives the older rollback as well'
);
select is(
  (select rank_frozen_at::text from public.participants where id = '00000000-0000-4000-8000-000000000b12'),
  current_setting('test.frp_later_rank_at'),
  'the frozen timestamp is unchanged across both rollbacks'
);

-- ------------------------------------------------------------------
-- 4. Removed participant during rollback.
-- ------------------------------------------------------------------
select set_config('test.frp_removed_snapshot', public.admin_create_classified_badge_sync_run(
  jsonb_build_array(jsonb_build_object(
    'row_number', 2,
    'participant_id', '00000000-0000-4000-8000-000000000b13',
    'skill_count', 10,
    'arcade_count', 0,
    'total_count', 10,
    'review_note', 'frozen policy removed participant',
    'expected_total_count', 9,
    'expected_last_verified_at', null,
    'expected_verification_source', null
  )),
  'frozen-policy-removed.csv',
  null
)::text, true);
select set_config('test.frp_removed_run', current_setting('test.frp_removed_snapshot')::jsonb #>> '{run,id}', true);
select set_config('test.frp_removed_fp', current_setting('test.frp_removed_snapshot')::jsonb #>> '{run,preview_fingerprint}', true);
select public.admin_approve_badge_sync_run(
  current_setting('test.frp_removed_run')::uuid,
  current_setting('test.frp_removed_fp')
);
select public.admin_apply_badge_sync_run(
  current_setting('test.frp_removed_run')::uuid,
  current_setting('test.frp_removed_fp'),
  gen_random_uuid()
);
select set_config('test.frp_removed_rank', (select frozen_rank::text from public.participants where id = '00000000-0000-4000-8000-000000000b13'), true);
select set_config('test.frp_removed_rank_at', (select rank_frozen_at::text from public.participants where id = '00000000-0000-4000-8000-000000000b13'), true);

reset role;
update public.participants
set registration_status = 'removed',
    removed_at = now(),
    removal_reason = 'frozen policy removed during rollback'
where id = '00000000-0000-4000-8000-000000000b13';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000b01';

select throws_ok(format($$
  select public.admin_rollback_badge_sync_run(%L, gen_random_uuid())
$$, current_setting('test.frp_removed_run')),
  '22023',
  'Removed participants cannot be rolled back',
  'a participant removed after apply cannot be rolled back'
);
select is((select verified_badge_count from public.participants where id = '00000000-0000-4000-8000-000000000b13'), 10, 'the blocked rollback leaves the applied total untouched');
select is(
  (select frozen_rank::text from public.participants where id = '00000000-0000-4000-8000-000000000b13'),
  current_setting('test.frp_removed_rank'),
  'the removal does not clear the frozen rank'
);

reset role;
update public.participants
set registration_status = 'registered',
    removed_at = null,
    removed_by = null,
    removal_reason = null
where id = '00000000-0000-4000-8000-000000000b13';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000b01';

select is((
  public.admin_rollback_badge_sync_run(
    current_setting('test.frp_removed_run')::uuid,
    gen_random_uuid()
  ) ->> 'restored_count'
)::integer, 1, 'the reactivated participant can then be rolled back');
select is((select verified_badge_count from public.participants where id = '00000000-0000-4000-8000-000000000b13'), 9, 'the reactivated rollback restores the pre-apply total');
select is(
  (select frozen_rank::text from public.participants where id = '00000000-0000-4000-8000-000000000b13'),
  current_setting('test.frp_removed_rank'),
  'the rank remains after the eventual rollback'
);
select is(
  (select rank_frozen_at::text from public.participants where id = '00000000-0000-4000-8000-000000000b13'),
  current_setting('test.frp_removed_rank_at'),
  'the frozen timestamp remains after the eventual rollback'
);

-- ------------------------------------------------------------------
-- 5. Repeated rollback.
-- ------------------------------------------------------------------
select set_config('test.frp_cross_rollback_2', gen_random_uuid()::text, true);
select is((
  public.admin_rollback_badge_sync_run(
    current_setting('test.frp_cross_run')::uuid,
    current_setting('test.frp_cross_rollback_2')::uuid
  ) ->> 'request_id'
), current_setting('test.frp_cross_rollback_1'), 'a repeated rollback replays the first stored request id');
select is(
  (select frozen_rank::text from public.participants where id = '00000000-0000-4000-8000-000000000b11'),
  current_setting('test.frp_cross_rank'),
  'a repeated rollback does not clear the frozen rank'
);
select is((
  select count(*)::integer from public.participant_audit_events
  where participant_id = '00000000-0000-4000-8000-000000000b11'
    and event_type = 'badge_count_updated'
), 2, 'a repeated rollback does not duplicate the apply/rollback audit trail');
select is((
  select count(*)::integer from public.badge_sync_operation_ledger
  where run_id = current_setting('test.frp_cross_run')::uuid
    and operation_type = 'rollback'
), 1, 'a repeated rollback does not duplicate the rollback ledger row');

select * from finish();
rollback;

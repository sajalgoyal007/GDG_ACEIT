-- Phase 2 badge-sync fetch queue: seeding, leases, finish transitions,
-- pause/resume, progress, prepare/re-preview, and the completeness guard.
--
-- Run with: supabase test db  (pgTAP). This file never touches production.
begin;
select no_plan();

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-4000-8000-000000000901', 'authenticated', 'authenticated',
  'badge-fetch-admin@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
);
insert into public.admin_users (user_id) values ('00000000-0000-4000-8000-000000000901');

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-4000-8000-000000000902', 'authenticated', 'authenticated',
  'badge-fetch-nonadmin@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.participants (
  id, participant_key, display_name, profile_url, registration_status,
  verified_badge_count, skill_badge_count, arcade_game_badge_count,
  removed_at, removal_reason
) values
  ('00000000-0000-4000-8000-0000000009b1', 'queue-1', 'Queue One',
   'https://www.skills.google/public_profiles/queue-1', 'registered', 0, null, null, null, null),
  ('00000000-0000-4000-8000-0000000009b2', 'queue-2', 'Queue Two',
   'https://www.skills.google/public_profiles/queue-2', 'registered', 0, null, null, null, null),
  ('00000000-0000-4000-8000-0000000009b3', 'queue-3', 'Queue Three',
   'https://www.skills.google/public_profiles/queue-3', 'registered', 0, null, null, null, null),
  ('00000000-0000-4000-8000-0000000009b4', 'queue-removed', 'Queue Removed',
   null, 'removed', 5, 4, 1, now(), 'Removed before the queue was created'),
  ('00000000-0000-4000-8000-0000000009b5', 'queue-later-removed', 'Queue Later Removed',
   null, 'registered', 0, null, null, null, null);

-- ------------------------------------------------------------------
-- Privileges and server-side authorization.
-- ------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.admin_create_badge_sync_fetch_run(text)', 'EXECUTE'), 'anonymous clients cannot create fetch runs');
select ok(not has_function_privilege('anon', 'public.admin_claim_badge_sync_fetch_batch(uuid, integer, integer)', 'EXECUTE'), 'anonymous clients cannot claim fetch work');
select ok(not has_function_privilege('anon', 'public.admin_finish_badge_sync_fetch_item(uuid, uuid, uuid, text, text, integer)', 'EXECUTE'), 'anonymous clients cannot finish fetch work');
select ok(not has_function_privilege('anon', 'public.admin_set_badge_sync_fetch_pause(uuid, boolean, text)', 'EXECUTE'), 'anonymous clients cannot pause a fetch run');
select ok(not has_function_privilege('anon', 'public.admin_badge_sync_progress(uuid)', 'EXECUTE'), 'anonymous clients cannot read fetch progress');
select ok(not has_function_privilege('anon', 'public.admin_prepare_badge_sync_staging(uuid)', 'EXECUTE'), 'anonymous clients cannot prepare staging');
select ok(not has_table_privilege('authenticated', 'public.badge_sync_fetch_queue', 'INSERT'), 'authenticated clients cannot insert queue rows directly');
select ok(not has_table_privilege('authenticated', 'public.badge_sync_fetch_queue', 'UPDATE'), 'authenticated clients cannot update queue rows directly');
select ok(not has_table_privilege('authenticated', 'public.badge_sync_fetch_queue', 'DELETE'), 'authenticated clients cannot delete queue rows directly');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000902';
select throws_ok($$
  select public.admin_create_badge_sync_fetch_run(null)
$$, '42501', 'Admin access required', 'a non-admin authenticated caller cannot create a fetch run');

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000901';

-- ------------------------------------------------------------------
-- Run creation and queue seeding.
-- ------------------------------------------------------------------
select set_config('test.queue_run', public.admin_create_badge_sync_fetch_run('Queue integration test')::text, true);
select is((select status from public.badge_sync_runs where id = current_setting('test.queue_run')::uuid), 'draft', 'a fetch run starts in draft');
select is((select mode from public.badge_sync_runs where id = current_setting('test.queue_run')::uuid), 'badge_observations', 'a fetch run uses the observation mode');
select is((select source from public.badge_sync_runs where id = current_setting('test.queue_run')::uuid), 'profile_evidence', 'a fetch run records profile evidence, never an admin import');
select is((select created_by from public.badge_sync_runs where id = current_setting('test.queue_run')::uuid), '00000000-0000-4000-8000-000000000901'::uuid, 'the creating admin owns the run');

select is((select count(*)::integer from public.admin_claim_badge_sync_fetch_batch(
  current_setting('test.queue_run')::uuid, 8, 120
)), 4, 'the first claim seeds every active participant and returns the batch');
select is((select count(*)::integer from public.badge_sync_fetch_queue
  where run_id = current_setting('test.queue_run')::uuid
    and participant_id = '00000000-0000-4000-8000-0000000009b4'), 0, 'removed participants are never queued');
select is((select count(*)::integer from public.badge_sync_fetch_queue
  where run_id = current_setting('test.queue_run')::uuid
    and status = 'claimed'), 4, 'every seeded item is claimed');
select ok((select bool_and(lease_token is not null and lease_expires_at > now())
  from public.badge_sync_fetch_queue
  where run_id = current_setting('test.queue_run')::uuid), 'every claim carries a live lease');
select ok((select bool_and(attempt_count = 1)
  from public.badge_sync_fetch_queue
  where run_id = current_setting('test.queue_run')::uuid), 'the first claim increments each attempt count once');
select is((select count(*)::integer from public.admin_claim_badge_sync_fetch_batch(
  current_setting('test.queue_run')::uuid, 8, 120
)), 0, 'already claimed items are not handed to a second caller');

select set_config('test.item_1', (select id::text from public.badge_sync_fetch_queue
  where run_id = current_setting('test.queue_run')::uuid
    and participant_id = '00000000-0000-4000-8000-0000000009b1'), true);
select set_config('test.item_2', (select id::text from public.badge_sync_fetch_queue
  where run_id = current_setting('test.queue_run')::uuid
    and participant_id = '00000000-0000-4000-8000-0000000009b2'), true);
select set_config('test.item_3', (select id::text from public.badge_sync_fetch_queue
  where run_id = current_setting('test.queue_run')::uuid
    and participant_id = '00000000-0000-4000-8000-0000000009b3'), true);
select set_config('test.item_5', (select id::text from public.badge_sync_fetch_queue
  where run_id = current_setting('test.queue_run')::uuid
    and participant_id = '00000000-0000-4000-8000-0000000009b5'), true);
select set_config('test.token_1', (select lease_token::text from public.badge_sync_fetch_queue
  where id = current_setting('test.item_1')::uuid), true);
select set_config('test.token_2', (select lease_token::text from public.badge_sync_fetch_queue
  where id = current_setting('test.item_2')::uuid), true);
select set_config('test.token_3', (select lease_token::text from public.badge_sync_fetch_queue
  where id = current_setting('test.item_3')::uuid), true);
select set_config('test.token_5', (select lease_token::text from public.badge_sync_fetch_queue
  where id = current_setting('test.item_5')::uuid), true);

select is((select total from public.admin_badge_sync_progress(current_setting('test.queue_run')::uuid)), 4, 'progress counts the four queued participants');
select is((select claimed_count from public.admin_badge_sync_progress(current_setting('test.queue_run')::uuid)), 4, 'progress counts claimed work');
select is((select remaining from public.admin_badge_sync_progress(current_setting('test.queue_run')::uuid)), 4, 'claimed work still counts as remaining');
select is((select complete from public.admin_badge_sync_progress(current_setting('test.queue_run')::uuid)), false, 'a claimed run is not complete');

-- ------------------------------------------------------------------
-- Lease token fencing and retry backoff.
-- ------------------------------------------------------------------
select is((select item_status from public.admin_finish_badge_sync_fetch_item(
  current_setting('test.queue_run')::uuid,
  current_setting('test.item_1')::uuid,
  gen_random_uuid(),
  'staged'
)), 'stale', 'a wrong claim token cannot finish an item');

select is((select item_status from public.admin_finish_badge_sync_fetch_item(
  current_setting('test.queue_run')::uuid,
  current_setting('test.item_1')::uuid,
  current_setting('test.token_1')::uuid,
  'pending',
  'rate_limited',
  900
)), 'pending', 'a rate-limited item returns to pending instead of being staged');
select ok((select retry_after > now() from public.badge_sync_fetch_queue
  where id = current_setting('test.item_1')::uuid), 'a pending retry records a future retry window');
select is((select error_category from public.badge_sync_fetch_queue
  where id = current_setting('test.item_1')::uuid), 'rate_limited', 'the retry keeps its error category');
select is((select count(*)::integer from public.admin_claim_badge_sync_fetch_batch(
  current_setting('test.queue_run')::uuid, 8, 120
)), 0, 'backoff prevents an immediate re-claim');

-- ------------------------------------------------------------------
-- Pause blocks claims; resume clears backoff.
-- ------------------------------------------------------------------
select is((select paused from public.admin_set_badge_sync_fetch_pause(
  current_setting('test.queue_run')::uuid, true, 'HTTP 429 rate limit'
)), true, 'an admin can pause the run');
select is((select fetch_pause_reason from public.badge_sync_runs
  where id = current_setting('test.queue_run')::uuid), 'HTTP 429 rate limit', 'the pause reason is persisted on the run');
select is((select paused from public.admin_badge_sync_progress(current_setting('test.queue_run')::uuid)), true, 'progress reports the paused state');
select is((select count(*)::integer from public.admin_claim_badge_sync_fetch_batch(
  current_setting('test.queue_run')::uuid, 8, 120
)), 0, 'a paused run hands out no work');

select is((select paused from public.admin_set_badge_sync_fetch_pause(
  current_setting('test.queue_run')::uuid, false, null
)), false, 'the run can be resumed');
select ok((select retry_after is null from public.badge_sync_fetch_queue
  where id = current_setting('test.item_1')::uuid), 'resume clears the pending retry backoff');

select is((select count(*)::integer from public.admin_claim_badge_sync_fetch_batch(
  current_setting('test.queue_run')::uuid, 8, 120
)), 1, 'resume makes the backed-off participant claimable again');
select is((select attempt_count from public.badge_sync_fetch_queue
  where id = current_setting('test.item_1')::uuid), 2, 'a retry increments the attempt count');
select set_config('test.token_1', (select lease_token::text from public.badge_sync_fetch_queue
  where id = current_setting('test.item_1')::uuid), true);

-- ------------------------------------------------------------------
-- Expired leases are recovered; removed participants are retired.
-- ------------------------------------------------------------------
reset role;
update public.badge_sync_fetch_queue
set lease_expires_at = now() - interval '1 minute'
where id = current_setting('test.item_2')::uuid;
update public.participants
set registration_status = 'removed', removed_at = now(), removal_reason = 'Removed mid-run'
where id = '00000000-0000-4000-8000-0000000009b5';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000901';

select is((select count(*)::integer from public.admin_claim_badge_sync_fetch_batch(
  current_setting('test.queue_run')::uuid, 8, 120
)), 1, 'an expired lease is recovered and the item is claimable again');
select is((select attempt_count from public.badge_sync_fetch_queue
  where id = current_setting('test.item_2')::uuid), 2, 'lease recovery increments the attempt count');
select is((select status from public.badge_sync_fetch_queue
  where id = current_setting('test.item_5')::uuid), 'skipped', 'a participant removed mid-run is retired from the queue');
select is((select error_category from public.badge_sync_fetch_queue
  where id = current_setting('test.item_5')::uuid), 'participant_removed', 'the retired item records why it was skipped');
select set_config('test.token_2', (select lease_token::text from public.badge_sync_fetch_queue
  where id = current_setting('test.item_2')::uuid), true);

select throws_ok(format($$
  select * from public.admin_finish_badge_sync_fetch_item(%L, %L, %L, 'bogus')
$$,
  current_setting('test.queue_run'),
  current_setting('test.item_1'),
  current_setting('test.token_1')
), '22023', 'Fetch item status is invalid', 'an unknown finish status is rejected');

select is((select item_status from public.admin_finish_badge_sync_fetch_item(
  current_setting('test.queue_run')::uuid,
  current_setting('test.item_1')::uuid,
  current_setting('test.token_1')::uuid,
  'staged'
)), 'staged', 'a claimed item can be staged');
select is((select item_status from public.admin_finish_badge_sync_fetch_item(
  current_setting('test.queue_run')::uuid,
  current_setting('test.item_2')::uuid,
  current_setting('test.token_2')::uuid,
  'staged'
)), 'staged', 'a recovered item can be staged');
select is((select item_status from public.admin_finish_badge_sync_fetch_item(
  current_setting('test.queue_run')::uuid,
  current_setting('test.item_3')::uuid,
  current_setting('test.token_3')::uuid,
  'skipped',
  'participant_removed'
)), 'skipped', 'an item can be retired as skipped');
select ok((select bool_and(lease_token is null and lease_expires_at is null and completed_at is not null)
  from public.badge_sync_fetch_queue
  where run_id = current_setting('test.queue_run')::uuid
    and status in ('staged', 'skipped')), 'finished items release their lease and record completion');

select is((select processed from public.admin_badge_sync_progress(current_setting('test.queue_run')::uuid)), 4, 'progress counts staged and skipped items as processed');
select is((select remaining from public.admin_badge_sync_progress(current_setting('test.queue_run')::uuid)), 0, 'no work remains after every item finishes');
select is((select staged_count from public.admin_badge_sync_progress(current_setting('test.queue_run')::uuid)), 2, 'progress counts two staged items');
select is((select skipped_count from public.admin_badge_sync_progress(current_setting('test.queue_run')::uuid)), 2, 'progress counts two skipped items');
select is((select complete from public.admin_badge_sync_progress(current_setting('test.queue_run')::uuid)), true, 'the queue is complete when no pending or claimed work remains');

-- ------------------------------------------------------------------
-- Completeness guard: every active participant must be staged.
-- ------------------------------------------------------------------
select public.admin_stage_badge_sync_observations(
  current_setting('test.queue_run')::uuid,
  jsonb_build_array(
    jsonb_build_object(
      'participant_id', '00000000-0000-4000-8000-0000000009b1',
      'observation_status', 'complete',
      'badges', jsonb_build_array(
        jsonb_build_object('badge_key', 'course_template:1080', 'badge_title', 'MLOps Model Evaluation')
      )
    ),
    jsonb_build_object(
      'participant_id', '00000000-0000-4000-8000-0000000009b2',
      'observation_status', 'complete',
      'badges', jsonb_build_array(
        jsonb_build_object('badge_key', 'course_template:756', 'badge_title', 'Using the Google Cloud Speech API')
      )
    )
  )
);

select throws_ok(format($$
  select public.admin_preview_badge_sync_run(%L)
$$, current_setting('test.queue_run')),
  '22023', 'Badge sync run is incomplete: every active participant must be staged before preview',
  'preview refuses a queue-complete run that is missing an active participant''s staging row');

select public.admin_stage_badge_sync_observations(
  current_setting('test.queue_run')::uuid,
  jsonb_build_array(jsonb_build_object(
    'participant_id', '00000000-0000-4000-8000-0000000009b3',
    'observation_status', 'incomplete',
    'badges', jsonb_build_array()
  ))
);

select is(public.admin_bulk_set_staged_badge_status(current_setting('test.queue_run')::uuid, 'approved'), 2, 'bulk approval approves only catalog-classified badges');
select set_config('test.queue_fingerprint', (public.admin_preview_badge_sync_run(
  current_setting('test.queue_run')::uuid
) #>> '{run,preview_fingerprint}'), true);
select is((select status from public.badge_sync_runs where id = current_setting('test.queue_run')::uuid), 'previewed', 'a fully staged queue previews successfully');
select is((select total_participants from public.badge_sync_runs where id = current_setting('test.queue_run')::uuid), 2, 'the preview writes counts only for complete participants');
select is((select total_skill from public.badge_sync_runs where id = current_setting('test.queue_run')::uuid), 2, 'the preview totals both approved Skill badges');

-- ------------------------------------------------------------------
-- Prepare staging clears only an unapplied preview and recomputes.
-- ------------------------------------------------------------------
select is((select prepared from public.admin_prepare_badge_sync_staging(current_setting('test.queue_run')::uuid)), true, 'prepare accepts a previewed run');
select is((select status from public.badge_sync_runs where id = current_setting('test.queue_run')::uuid), 'staged', 'prepare returns the run to staged');
select is((select preview_fingerprint from public.badge_sync_runs where id = current_setting('test.queue_run')::uuid), null, 'prepare clears the stale preview fingerprint');
select is(public.admin_bulk_set_staged_badge_status(current_setting('test.queue_run')::uuid, 'approved'), 0, 'prepare keeps already-approved catalog badges approved');
select set_config('test.queue_fingerprint', (public.admin_preview_badge_sync_run(
  current_setting('test.queue_run')::uuid
) #>> '{run,preview_fingerprint}'), true);
select is((select status from public.badge_sync_runs where id = current_setting('test.queue_run')::uuid), 'previewed', 'a prepared run can be previewed again');

select public.admin_approve_badge_sync_run(
  current_setting('test.queue_run')::uuid,
  current_setting('test.queue_fingerprint')
);
select is((select (public.admin_apply_badge_sync_run(
  current_setting('test.queue_run')::uuid,
  current_setting('test.queue_fingerprint'),
  gen_random_uuid()
) ->> 'applied_count')::integer), 2, 'apply writes the two complete participants');
select is((select verified_badge_count from public.participants
  where id = '00000000-0000-4000-8000-0000000009b1'), 1, 'apply writes the observed Skill count');
select is((select verified_badge_count from public.participants
  where id = '00000000-0000-4000-8000-0000000009b3'), 0, 'an incomplete observation preserves the previous total');
select throws_ok(format($$
  select public.admin_prepare_badge_sync_staging(%L)
$$, current_setting('test.queue_run')),
  '22023', 'Only a staged or previewed run can be prepared',
  'prepare can never reopen an applied run');

-- ------------------------------------------------------------------
-- A run with unprocessed queue rows cannot preview.
-- ------------------------------------------------------------------
select set_config('test.pending_run', public.admin_create_badge_sync_fetch_run('Pending guard test')::text, true);
select is((select count(*)::integer from public.admin_claim_badge_sync_fetch_batch(
  current_setting('test.pending_run')::uuid, 8, 120
)), 3, 'the second run seeds the three remaining active participants');

select public.admin_stage_badge_sync_observations(
  current_setting('test.pending_run')::uuid,
  jsonb_build_array(
    jsonb_build_object(
      'participant_id', '00000000-0000-4000-8000-0000000009b1',
      'observation_status', 'complete',
      'badges', jsonb_build_array(
        jsonb_build_object('badge_key', 'course_template:1080', 'badge_title', 'MLOps Model Evaluation')
      )
    ),
    jsonb_build_object(
      'participant_id', '00000000-0000-4000-8000-0000000009b2',
      'observation_status', 'complete',
      'badges', jsonb_build_array()
    ),
    jsonb_build_object(
      'participant_id', '00000000-0000-4000-8000-0000000009b3',
      'observation_status', 'incomplete',
      'badges', jsonb_build_array()
    )
  )
);

select throws_ok(format($$
  select public.admin_preview_badge_sync_run(%L)
$$, current_setting('test.pending_run')),
  '22023', 'Badge sync fetch is incomplete: remaining participants must be processed before preview',
  'preview refuses a run while participants are still pending or claimed');

select set_config('test.classified_run', public.admin_create_badge_sync_run(
  'classified_counts', 'classified.csv', null, 'not a fetch run'
)::text, true);
select throws_ok(format($$
  select * from public.admin_claim_badge_sync_fetch_batch(%L, 8, 120)
$$, current_setting('test.classified_run')),
  '22023', 'This run does not accept live profile evidence',
  'a classified-count run is rejected by the fetch queue');

-- ------------------------------------------------------------------
-- Admin RLS: a non-admin cannot read queue internals.
-- ------------------------------------------------------------------
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000902';
select is((select count(*)::integer from public.badge_sync_fetch_queue
  where run_id = current_setting('test.queue_run')::uuid), 0, 'a non-admin cannot read fetch queue rows');

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000901';
reset role;
select * from finish();
rollback;

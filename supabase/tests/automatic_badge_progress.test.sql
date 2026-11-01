begin;
select plan(36);

insert into public.participants (participant_key, display_name, profile_url, registration_status, verified_badge_count, last_verified_at)
select
  'auto-test-' || lpad(n::text, 2, '0'),
  'Auto Progress Test ' || n,
  'https://skills.google/public_profiles/auto-test-' || n,
  'registered',
  case when n = 1 then 7 else 0 end,
  case when n = 1 then '2026-01-02 03:04:05+00'::timestamptz else null end
from generate_series(1, 14) as n;
insert into public.participants (participant_key, display_name, profile_url, registration_status)
values
  ('auto-duplicate-a', 'Auto Duplicate A', 'https://skills.google/public_profiles/same-profile', 'registered'),
  ('auto-duplicate-b', 'Auto Duplicate B', 'https://www.cloudskillsboost.google/public_profiles/same-profile/', 'registered');

set local role service_role;
set local request.jwt.claim.role = 'service_role';
select set_config(
  'test.claim01',
  (select claim_token::text from public.claim_participant_auto_fetch(
    (select id from public.participants where participant_key = 'auto-test-01')
  )),
  true
);
select is(
  (select result_status from public.record_participant_auto_fetch(
    (select id from public.participants where participant_key = 'auto-test-01'),
    'https://skills.google/public_profiles/auto-test-1',
    current_setting('test.claim01')::uuid,
    1,
    'ok',
    (select jsonb_agg(jsonb_build_object('key', 'badge-' || n)) from generate_series(1, 10) n),
    'snapshot-one', 'fixture-1', null
  )),
  'ok',
  'a database claim finalizes a complete automatic snapshot'
);

reset role;
set local role service_role;
select is(
  (select claim_status from public.claim_participant_auto_fetch(
    (select id from public.participants where participant_key = 'auto-test-01')
  )),
  'cooldown',
  'a second sequential claim is rejected during the one-minute cooldown'
);
reset role;
select ok(
  (select ap.next_fetch_allowed_at > clock_timestamp()
      and ap.next_fetch_allowed_at <= clock_timestamp() + interval '60 seconds'
   from public.participant_auto_progress ap join public.participants p on p.id = ap.participant_id
   where p.participant_key = 'auto-test-01'),
  'cooldown retry time is database-generated and bounded to one minute'
);
update public.participant_auto_progress ap
set next_fetch_allowed_at = clock_timestamp() - interval '1 second'
from public.participants p
where p.id = ap.participant_id and p.participant_key = 'auto-test-01';
select is(
  (select eligible_badge_count from public.participant_auto_progress ap join public.participants p on p.id = ap.participant_id where p.participant_key = 'auto-test-01'),
  10,
  'complete badge keys produce the observed eligible count'
);
select is(
  (select finish_rank from public.participant_auto_milestones am join public.participants p on p.id = am.participant_id where p.participant_key = 'auto-test-01'),
  1,
  'first observed qualifier receives rank one'
);
set local role service_role;
select set_config(
  'test.claim01_repeat',
  (select claim_token::text from public.claim_participant_auto_fetch(
    (select id from public.participants where participant_key = 'auto-test-01')
  )),
  true
);
select is(
  (select finish_rank from public.record_participant_auto_fetch(
    (select id from public.participants where participant_key = 'auto-test-01'),
    'https://skills.google/public_profiles/auto-test-1',
    current_setting('test.claim01_repeat')::uuid,
    1,
    'ok',
    (select jsonb_agg(jsonb_build_object('key', 'badge-' || n)) from generate_series(1, 10) n),
    'snapshot-one', 'fixture-1', null
  )),
  1,
  'repeat processing preserves the assigned rank'
);

reset role;
select set_config(
  'test.initial_success_at',
  (select ap.last_successful_check_at::text from public.participant_auto_progress ap join public.participants p on p.id = ap.participant_id where p.participant_key = 'auto-test-01'),
  true
);
set local role service_role;

do $$
declare
  v_participant record;
  v_claim record;
begin
  for v_participant in
    select p.id, p.profile_url
    from public.participants p
    where p.participant_key between 'auto-test-02' and 'auto-test-11'
    order by p.participant_key
  loop
    select * into v_claim from public.claim_participant_auto_fetch(v_participant.id);
    if v_claim.claim_status <> 'claimed' then
      raise exception 'Expected claim, received %', v_claim.claim_status;
    end if;
    perform * from public.record_participant_auto_fetch(
      v_participant.id, v_participant.profile_url, v_claim.claim_token, v_claim.profile_revision, 'ok',
      (select jsonb_agg(jsonb_build_object('key', 'badge-' || n)) from generate_series(1, 10) n),
      'snapshot-many', 'fixture-1', null
    );
  end loop;
end
$$;

reset role;
select is(
  (select count(*)::integer from public.participant_auto_milestones where finish_rank is not null),
  10,
  'at most ten finish ranks are allocated'
);
select is(
  (select array_agg(finish_rank order by finish_rank) from public.participant_auto_milestones where finish_rank is not null),
  array[1,2,3,4,5,6,7,8,9,10],
  'assigned finish ranks are unique and contiguous'
);
select is(
  (select finish_rank from public.participant_auto_milestones am join public.participants p on p.id = am.participant_id where p.participant_key = 'auto-test-11'),
  null,
  'the eleventh qualifier remains unranked'
);

set local role service_role;
select set_config(
  'test.claim12',
  (select claim_token::text from public.claim_participant_auto_fetch(
    (select id from public.participants where participant_key = 'auto-test-12')
  )),
  true
);
select is(
  (select result_status from public.record_participant_auto_fetch(
    (select id from public.participants where participant_key = 'auto-test-12'),
    'https://skills.google/public_profiles/auto-test-12',
    current_setting('test.claim12')::uuid, 1, 'ok', '[]'::jsonb,
    'snapshot-zero', 'fixture-1', null
  )),
  'ok',
  'complete empty snapshot is a successful zero result'
);
reset role;
select is(
  (select eligible_badge_count from public.participant_auto_progress ap join public.participants p on p.id = ap.participant_id where p.participant_key = 'auto-test-12'),
  0,
  'complete empty snapshot stores zero only in the automatic-progress table'
);
reset role;
update public.participant_auto_progress ap
set next_fetch_allowed_at = clock_timestamp() - interval '1 second'
from public.participants p
where p.id = ap.participant_id and p.participant_key = 'auto-test-01';
set local role service_role;

select set_config(
  'test.claim01_failure',
  (select claim_token::text from public.claim_participant_auto_fetch(
    (select id from public.participants where participant_key = 'auto-test-01')
  )),
  true
);
select is(
  (select eligible_badge_count from public.record_participant_auto_fetch(
    (select id from public.participants where participant_key = 'auto-test-01'),
    'https://skills.google/public_profiles/auto-test-1',
    current_setting('test.claim01_failure')::uuid, 1,
    'timeout', null, null, null, 'timeout'
  )),
  10,
  'a failure status preserves the last successful count'
);
reset role;
select ok(
  (select ap.last_successful_check_at = current_setting('test.initial_success_at')::timestamptz
      and p.verified_badge_count = 7
      and p.last_verified_at = '2026-01-02 03:04:05+00'::timestamptz
   from public.participant_auto_progress ap
   join public.participants p on p.id = ap.participant_id
   where p.participant_key = 'auto-test-01'),
  'failure preserves last-good timestamp and all manual verification fields'
);

set local role service_role;
select is(
  (select claim_status from public.claim_participant_auto_fetch(
    (select id from public.participants where participant_key = 'auto-test-01')
  )),
  'cooldown',
  'failed fetches retain the cooldown and cannot be retried immediately'
);
reset role;
update public.participant_auto_progress ap
set next_fetch_allowed_at = clock_timestamp() - interval '1 second'
from public.participants p
where p.id = ap.participant_id and p.participant_key = 'auto-test-01';
set local role service_role;
select set_config(
  'test.claim01_decrease',
  (select claim_token::text from public.claim_participant_auto_fetch(
    (select id from public.participants where participant_key = 'auto-test-01')
  )),
  true
);
select is(
  (select eligible_badge_count from public.record_participant_auto_fetch(
    (select id from public.participants where participant_key = 'auto-test-01'),
    'https://skills.google/public_profiles/auto-test-1',
    current_setting('test.claim01_decrease')::uuid, 1, 'ok',
    (select jsonb_agg(jsonb_build_object('key', 'badge-' || n)) from generate_series(1, 9) n),
    'snapshot-decreased', 'fixture-1', null
  )),
  9,
  'a complete later snapshot can reflect a badge count decrease'
);
reset role;
select is(
  (select finish_rank from public.participant_auto_milestones am join public.participants p on p.id = am.participant_id where p.participant_key = 'auto-test-01'),
  1,
  'a locked finish rank does not change after the count decreases'
);

-- These next cases exercise identity invalidation rather than the cooldown;
-- the SQL fixture runs them as the database owner to avoid waiting a minute.
reset role;
update public.participant_auto_progress ap
set next_fetch_allowed_at = clock_timestamp() - interval '1 second'
from public.participants p
where p.id = ap.participant_id and p.participant_key between 'auto-test-02' and 'auto-test-11';

-- URL replacement invalidates current progress and frees the old unique key.
update public.participants set profile_url = 'https://skills.google/public_profiles/replacement'
where participant_key = 'auto-test-01';
select ok(
  (select ap.next_fetch_allowed_at > clock_timestamp()
   from public.participant_auto_progress ap join public.participants p on p.id = ap.participant_id
   where p.participant_key = 'auto-test-01'),
  'changing a profile revision does not reset the participant cooldown'
);
select ok(
  (select ap.status = 'unavailable' and ap.eligible_badge_count is null
      and ap.normalized_profile_url is null and ap.claim_token is null
   from public.participant_auto_progress ap join public.participants p on p.id = ap.participant_id
   where p.participant_key = 'auto-test-01'),
  'profile replacement invalidates its snapshot and claim'
);
select ok(
  (select v.status = 'unavailable' and v.eligible_badge_count is null and v.ten_badge_finish_rank = 1
   from public.public_auto_progress_leaderboard v
   join public.participants p on p.id = v.participant_id
   where p.participant_key = 'auto-test-01'),
  'public projection hides old profile progress but keeps the locked rank'
);
select is(
  (select count(*)::integer from public.participant_auto_badges b
   join public.participants p on p.id = b.participant_id
   where p.participant_key = 'auto-test-01' and b.is_current),
  0,
  'profile replacement retains badge history but marks it non-current'
);

-- Removal also invalidates the current snapshot.
update public.participants set profile_url = null where participant_key = 'auto-test-02';
select ok(
  (select ap.status = 'unavailable' and ap.eligible_badge_count is null and ap.normalized_profile_url is null
   from public.participant_auto_progress ap join public.participants p on p.id = ap.participant_id
   where p.participant_key = 'auto-test-02'),
  'profile removal invalidates its current progress'
);

-- Reassign the released URL to another participant, then claim its new identity.
update public.participants
set profile_url = 'https://cloudskillsboost.google/public_profiles/auto-test-1/'
where participant_key = 'auto-test-03';
select is(
  (select claim_status from public.claim_participant_auto_fetch(
    (select id from public.participants where participant_key = 'auto-test-03')
  )),
  'claimed',
  'a released normalized URL can be reassigned to another participant'
);

-- A profile change invalidates an in-flight claim before it can finalize.
select set_config(
  'test.stale_claim',
  (select claim_token::text from public.claim_participant_auto_fetch(
    (select id from public.participants where participant_key = 'auto-test-04')
  )),
  true
);
reset role;
update public.participants set profile_url = 'https://skills.google/public_profiles/changed-mid-fetch'
where participant_key = 'auto-test-04';
set local role service_role;
select is(
  (select result_status from public.record_participant_auto_fetch(
    (select id from public.participants where participant_key = 'auto-test-04'),
    'https://skills.google/public_profiles/auto-test-4',
    current_setting('test.stale_claim')::uuid, 1, 'ok',
    (select jsonb_agg(jsonb_build_object('key', 'badge-' || n)) from generate_series(1, 10) n),
    'stale-snapshot', 'fixture-1', null
  )),
  'stale_claim',
  'a claim from a prior profile revision cannot finalize'
);
reset role;
select is(
  (select status from public.participant_auto_progress ap join public.participants p on p.id = ap.participant_id where p.participant_key = 'auto-test-04'),
  'unavailable',
  'stale profile finalization leaves the invalidated status unchanged'
);

-- Expired claims are rejected and recoverable with a new database claim.
set local role service_role;
select set_config(
  'test.expired_claim',
  (select claim_token::text from public.claim_participant_auto_fetch(
    (select id from public.participants where participant_key = 'auto-test-05'), 5
  )),
  true
);
select pg_sleep(5.1);
select is(
  (select result_status from public.record_participant_auto_fetch(
    (select id from public.participants where participant_key = 'auto-test-05'),
    'https://skills.google/public_profiles/auto-test-5',
    current_setting('test.expired_claim')::uuid, 1, 'ok', '[]'::jsonb,
    'expired-snapshot', 'fixture-1', null
  )),
  'stale_claim',
  'expired claim cannot finalize'
);
reset role;
update public.participant_auto_progress ap
set next_fetch_allowed_at = clock_timestamp() - interval '1 second'
from public.participants p
where p.id = ap.participant_id and p.participant_key = 'auto-test-05';
set local role service_role;
select is(
  (select claim_status from public.claim_participant_auto_fetch(
    (select id from public.participants where participant_key = 'auto-test-05')
  )),
  'claimed',
  'an expired claim can be recovered by issuing a new token'
);

-- An invalid token cannot mutate a current claim or progress state.
select set_config(
  'test.valid_claim',
  (select claim_token::text from public.claim_participant_auto_fetch(
    (select id from public.participants where participant_key = 'auto-test-06')
  )),
  true
);
select is(
  (select result_status from public.record_participant_auto_fetch(
    (select id from public.participants where participant_key = 'auto-test-06'),
    'https://skills.google/public_profiles/auto-test-6',
    gen_random_uuid(), 1, 'ok', '[]'::jsonb, 'invalid-token', 'fixture-1', null
  )),
  'stale_claim',
  'invalid claim token is rejected'
);
reset role;
select is(
  (select status from public.participant_auto_progress ap join public.participants p on p.id = ap.participant_id where p.participant_key = 'auto-test-06'),
  'ok',
  'invalid claim does not change progress status'
);

set local role service_role;
select is(
  (select claim_status from public.claim_participant_auto_fetch(
    (select id from public.participants where participant_key = 'auto-duplicate-a')
  )),
  'duplicate_profile',
  'normalized duplicate profiles cannot claim or qualify'
);

reset role;
set local role anon;
select lives_ok(
  $$select participant_id, status, eligible_badge_count from public.public_auto_progress_leaderboard$$,
  'anonymous readers can use the restricted public progress projection'
);
select throws_ok(
  $$select badge_key from public.participant_auto_badges$$,
  '42501', null,
  'anonymous readers cannot access the itemized automatic badge snapshot'
);
select throws_ok(
  $$insert into public.participant_auto_progress (participant_id, profile_revision) select id, 1 from public.participants limit 1$$,
  '42501', null,
  'anonymous clients cannot write automatic progress'
);
select throws_ok(
  $$insert into public.participant_auto_badges (participant_id, badge_key, first_seen_at, last_seen_at) select id, 'forbidden', now(), now() from public.participants limit 1$$,
  '42501', null,
  'anonymous clients cannot write badge observations'
);
select throws_ok(
  $$select * from public.claim_participant_auto_fetch('00000000-0000-0000-0000-000000000000'::uuid)$$,
  '42501', null,
  'anonymous clients cannot acquire worker claims'
);
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
select throws_ok(
  $$select * from public.claim_participant_auto_fetch('00000000-0000-0000-0000-000000000000'::uuid)$$,
  '42501', null,
  'authenticated clients cannot bypass the worker-only cooldown claim'
);
set local request.jwt.claim.role = 'anon';
reset role;
set local role anon;
select throws_ok(
  $$select * from public.record_participant_auto_fetch('00000000-0000-0000-0000-000000000000'::uuid, 'https://skills.google/public_profiles/not-a-participant', gen_random_uuid(), 1, 'ok', '[]'::jsonb, 'snapshot', 'fixture', null)$$,
  '42501', null,
  'anonymous clients cannot invoke worker finalization'
);

select * from finish();
rollback;

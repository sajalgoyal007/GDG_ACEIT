begin;
select plan(27);

-- Schema and public projection.
select has_column('public', 'participants', 'frozen_rank', 'frozen_rank column exists');
select has_column('public', 'participants', 'rank_frozen_at', 'rank_frozen_at column exists');
select ok(has_column_privilege('anon', 'public.participants', 'frozen_rank', 'SELECT'), 'anonymous readers can select frozen_rank');
select ok(has_column_privilege('anon', 'public.participants', 'rank_frozen_at', 'SELECT'), 'anonymous readers can select rank_frozen_at');
select ok(exists(
  select 1 from pg_trigger
  where tgrelid = 'public.participants'::regclass
    and tgname = 'participants_capture_frozen_ranks'
    and not tgisinternal
), 'threshold capture trigger exists');
select ok(exists(
  select 1 from pg_trigger
  where tgrelid = 'public.participants'::regclass
    and tgname = 'participants_protect_frozen_rank'
    and not tgisinternal
), 'frozen-rank overwrite protection trigger exists');
select ok(to_regclass('public.participants_frozen_rank_key') is not null, 'unique frozen-rank index exists');

-- Simultaneous crossings are allocated in one deterministic statement pass:
-- Skill DESC, Arcade DESC, Total DESC, UUID ASC.
insert into public.participants (
  id, participant_key, display_name, registration_status,
  verified_badge_count, skill_badge_count, arcade_game_badge_count
) values
  ('00000000-0000-4000-8000-0000000000a1', 'freeze-a', 'Freeze A', 'registered', 10, 10, 0),
  ('00000000-0000-4000-8000-0000000000a2', 'freeze-b', 'Freeze B', 'registered', 20, 12, 8);

select is((select frozen_rank from public.participants where participant_key = 'freeze-b'), 1, 'higher Skill Badge crossing receives the first frozen rank');
select is((select frozen_rank from public.participants where participant_key = 'freeze-a'), 2, 'lower Skill Badge crossing receives the next frozen rank');

-- Arcade and total badges alone never freeze.
insert into public.participants (
  id, participant_key, display_name, registration_status,
  verified_badge_count, skill_badge_count, arcade_game_badge_count
) values
  ('00000000-0000-4000-8000-0000000000a3', 'freeze-c', 'Freeze C', 'registered', 14, 9, 5),
  ('00000000-0000-4000-8000-0000000000a4', 'freeze-d', 'Freeze D', 'registered', 12, 0, 12);

select ok((select frozen_rank is null from public.participants where participant_key = 'freeze-c'), '9 Skill + 5 Arcade is not frozen');
select ok((select frozen_rank is null from public.participants where participant_key = 'freeze-d'), '0 Skill + 12 Arcade is not frozen');

insert into public.participants (
  id, participant_key, display_name, registration_status,
  verified_badge_count, skill_badge_count, arcade_game_badge_count
) values
  ('00000000-0000-4000-8000-0000000000a5', 'freeze-e', 'Freeze E', 'registered', 15, 15, 0);

select is((select frozen_rank from public.participants where participant_key = 'freeze-e'), 3, 'later 15-Skill crossing receives rank 3');

-- Same Skill count: Arcade DESC breaks the tie.
insert into public.participants (
  id, participant_key, display_name, registration_status,
  verified_badge_count, skill_badge_count, arcade_game_badge_count
) values
  ('00000000-0000-4000-8000-0000000000a6', 'freeze-f', 'Freeze F', 'registered', 11, 11, 0),
  ('00000000-0000-4000-8000-0000000000a7', 'freeze-g', 'Freeze G', 'registered', 13, 11, 2);

select is((select frozen_rank from public.participants where participant_key = 'freeze-g'), 4, 'higher Arcade count wins the simultaneous tie');
select is((select frozen_rank from public.participants where participant_key = 'freeze-f'), 5, 'lower Arcade count receives the next rank');

-- Full tie: stable UUID ASC breaks the tie.
insert into public.participants (
  id, participant_key, display_name, registration_status,
  verified_badge_count, skill_badge_count, arcade_game_badge_count
) values
  ('00000000-0000-4000-8000-0000000000a8', 'freeze-h', 'Freeze H', 'registered', 10, 10, 0),
  ('00000000-0000-4000-8000-0000000000a9', 'freeze-i', 'Freeze I', 'registered', 10, 10, 0);

select is((select frozen_rank from public.participants where participant_key = 'freeze-h'), 6, 'stable UUID ascending breaks an exact tie');
select is((select frozen_rank from public.participants where participant_key = 'freeze-i'), 7, 'the next tied participant receives the next sequential rank');

select set_config(
  'test.freeze_e_time',
  (select rank_frozen_at::text from public.participants where participant_key = 'freeze-e'),
  true
);

update public.participants
set skill_badge_count = 25, verified_badge_count = 25
where participant_key = 'freeze-e';

select is((select frozen_rank from public.participants where participant_key = 'freeze-e'), 3, 'a frozen rank survives a later Skill Badge gain');
select is((select rank_frozen_at::text from public.participants where participant_key = 'freeze-e'), current_setting('test.freeze_e_time'), 'the frozen timestamp is captured exactly once');

update public.participants
set skill_badge_count = 30, verified_badge_count = 30
where participant_key = 'freeze-a';

select is((select frozen_rank from public.participants where participant_key = 'freeze-a'), 2, 'another participant gaining badges cannot change an existing frozen rank');

-- A participant who reaches 10 Skill Badges later is frozen then.
update public.participants
set skill_badge_count = 10, arcade_game_badge_count = 4, verified_badge_count = 14
where participant_key = 'freeze-c';

select is((select frozen_rank from public.participants where participant_key = 'freeze-c'), 8, 'a later threshold crossing receives the next distinct rank');

-- Frozen ranks are never cleared, even if the count later drops.
update public.participants
set skill_badge_count = 9, arcade_game_badge_count = 5, verified_badge_count = 14
where participant_key = 'freeze-c';

select is((select frozen_rank from public.participants where participant_key = 'freeze-c'), 8, 'a frozen rank is never cleared by a later count decrease');

select is((select frozen_rank_count from public.get_public_summary()), 8, 'summary RPC reports the number of frozen ranks');
select is((select ten_badge_count from public.get_public_summary()), 7, 'summary RPC counts current 10+ Skill Badge holders');
select ok(not (public.get_public_summary() ? 'five_badge_count'), 'obsolete five_badge_count is removed from the public summary');

select throws_ok(
  $$update public.participants set frozen_rank = 99 where participant_key = 'freeze-a'$$,
  '42501',
  'A frozen rank cannot be changed once captured',
  'an established frozen rank cannot be overwritten'
);

select throws_ok(
  $$insert into public.participants (
      id, participant_key, display_name, registration_status,
      verified_badge_count, skill_badge_count, arcade_game_badge_count,
      frozen_rank, rank_frozen_at
    ) values (
      '00000000-0000-4000-8000-0000000000aa', 'freeze-dup', 'Freeze Dup', 'registered',
      0, 0, 0, 1, now()
    )$$,
  '23505',
  null,
  'duplicate frozen ranks are rejected by the unique index'
);

select ok((
  select bool_and(rank_frozen_at is not null)
  from public.participants
  where frozen_rank is not null
), 'every frozen rank has a capture timestamp');

select * from finish();
rollback;

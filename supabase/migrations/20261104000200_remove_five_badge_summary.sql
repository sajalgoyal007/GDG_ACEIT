-- Remove the obsolete five-badge metric from the public summary.
--
-- The 5-badge milestone/tier system has been removed from the application. The
-- classified badge migration still exposed `five_badge_count` for backwards
-- compatibility, which meant an unused five-badge rule remained in a database
-- function. This migration replaces the summary so the obsolete field cannot be
-- consumed by any client.
--
-- This migration intentionally precedes the 10-Skill-Badge rank-freeze migration.
-- That later migration replaces this function again and additionally exposes
-- `frozen_rank_count`. It does not modify participant badge counts.

create or replace function public.get_public_summary()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'registered_count',         count(*)::integer,
    'total_verified_badges',    coalesce(sum(participants.verified_badge_count), 0)::integer,
    'total_skill_badges',       coalesce(sum(participants.skill_badge_count), 0)::integer,
    'total_arcade_badges',      coalesce(sum(participants.arcade_game_badge_count), 0)::integer,
    'ten_badge_count',          count(*) filter (where participants.skill_badge_count >= 10)::integer,
    'last_updated_at',          coalesce(max(participants.updated_at), now())
  )
  from public.participants
  where participants.registration_status = 'registered';
$$;
revoke all on function public.get_public_summary() from public;
grant execute on function public.get_public_summary() to anon, authenticated;

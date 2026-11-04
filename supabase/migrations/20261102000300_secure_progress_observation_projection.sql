-- Expose only the intended public observation projection.
-- A security-invoker view would require anon to receive SELECT grants on every
-- internal column used by its lateral subqueries. Keep those grants private
-- and enforce registered/current profile identity inside this owner-rights view.
create or replace view public.public_progress_observation_leaderboard
with (security_barrier = true)
as
select
  p.id as participant_id,
  p.display_name,
  latest.source_name as latest_source_name,
  latest.retrieved_at as latest_retrieved_at,
  latest.recorded_at as latest_recorded_at,
  latest.http_status as latest_http_status,
  latest.completeness_status as latest_status,
  report.reported_total,
  report.detail_count,
  report.unique_badge_count,
  report.source_name as report_source_name,
  report.retrieved_at as last_reported_at,
  latest.identity_status
from public.participants p
join lateral (
  select
    o.source_name,
    o.retrieved_at,
    o.recorded_at,
    o.http_status,
    o.completeness_status,
    o.identity_status,
    o.profile_revision,
    o.normalized_profile_url
  from public.participant_progress_observations o
  where o.participant_id = p.id
  order by o.recorded_at desc, o.id desc
  limit 1
) latest on true
left join lateral (
  select o.reported_total, o.detail_count, o.unique_badge_count, o.source_name, o.retrieved_at
  from public.participant_progress_observations o
  where o.participant_id = p.id and o.reported_total is not null
  order by o.recorded_at desc, o.id desc
  limit 1
) report on true
where private.is_current_progress_observation(p.id, latest.profile_revision, latest.normalized_profile_url);

revoke all on public.public_progress_observation_leaderboard from public, authenticated;
grant select on public.public_progress_observation_leaderboard to anon;

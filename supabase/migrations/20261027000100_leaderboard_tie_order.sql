-- Keep the database's public ordering aligned with the documented UI tie rule.
drop index if exists public.participants_public_rank_idx;
create index participants_public_rank_idx
  on public.participants (verified_badge_count desc, id asc)
  where registration_status = 'registered';

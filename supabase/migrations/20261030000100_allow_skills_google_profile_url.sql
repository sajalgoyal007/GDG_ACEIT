-- Accept public profile URLs from both supported Google Skills domains.
-- Registration sync and audit invariants are defined by the existing
-- 20261028000100_google_form_sync migration and remain unchanged.
alter table public.participants
  drop constraint if exists participants_public_profile_url;

alter table public.participants
  add constraint participants_public_profile_url check (
    profile_url is null or profile_url ~ '^https://(www\.)?(cloudskillsboost|skills)\.google/public_profiles/[A-Za-z0-9_-]+/?$'
  );

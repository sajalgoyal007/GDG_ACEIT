# GDG ACEIT — Learn with Communities 2026 Leaderboard

A Next.js App Router dashboard with a provider interface, synthetic demo provider, and optional Supabase PostgreSQL persistence. The UI shows a visible data-source label. Demo records are synthetic; database badge counts are values entered by this community and are not claims of Google verification.

## Run locally

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. Without Supabase environment variables, the dashboard uses only synthetic demo data and management actions stay unavailable.

## Supabase setup

1. Create a Supabase project and copy its project URL and publishable key into a local `.env.local` using `.env.example` as a template. The publishable key is intended for browser use; PostgreSQL grants and RLS are the access boundary. `SUPABASE_SERVICE_ROLE_KEY` is used only by server-only isolated worker and account-linking code; it bypasses RLS, so never expose it to the browser, commit it, or set a `NEXT_PUBLIC_` prefix. Automatic profile fetching remains disabled.
2. Install the Supabase CLI and authenticate/link the project using Supabase's documented workflow. Apply the migrations in `supabase/migrations/` (for example `supabase db push`). Review the SQL before applying it to a production project.
3. Enable Supabase Auth email OTP/magic links and add `http://localhost:3000/auth/callback` to the project's allowed redirect URLs (plus the production callback after deployment). `shouldCreateUser: false` prevents the admin login form from creating arbitrary accounts. Create/invite operator accounts through the Supabase dashboard.
4. Add each approved Auth user's UUID to `public.admin_users` using the Supabase SQL editor as the project owner. The table intentionally contains no email addresses. Admin membership is read through the authenticated user's session; privileged actions are enforced again by security-definer RPCs and `private.is_admin()`.
5. Run the RLS database tests in `supabase/tests/leaderboard_rls.test.sql` using Supabase CLI/pgTAP in a local or staging database before production use. This repository does not include project credentials, so the migration, live Auth flow, and RLS tests have not been applied or run against your Supabase project. Do not treat a deployment as production-ready until those checks pass in your environment.

The app uses the publishable key with the signed-in user's cookies for admin operations and a separate anonymous client for the public leaderboard. The public table grant exposes only display name, public profile URL, badge aggregate, and verification metadata; RLS limits rows to registered participants. Aggregate statistics come from `get_public_summary()`. Admin reads and writes are additionally role-checked by PostgreSQL. No participant email is collected in this workflow. Supabase Auth may process admin login addresses for authentication, but participant registration data must not be placed there or in the participant CSV.

## Rank freeze and ranking

- 0–9 **Skill Badges**: **In Progress**. The participant keeps a dynamic rank.
- 10 or more **Skill Badges**: the leaderboard rank is **frozen exactly once**. Later badge gains never change it, and no participant can move above a frozen rank.
- Only Skill Badges count toward the threshold. Arcade Game Badges and the combined total never freeze a rank, even when they are 10 or more.
- Ranking is by the persisted frozen rank first, then for unfrozen participants by Skill Badges descending, Arcade Game Badges descending, total Badges descending, and finally stable participant UUID ascending. Equal counts never share a rank: every reviewed participant receives a distinct sequential rank (`1, 2, 3`).
- Simultaneous threshold crossings are allocated once, deterministically, in the same order (Skill, Arcade, Total, UUID) and receive the next distinct sequential ranks.
- `frozen_rank` and `rank_frozen_at` are written by the database only. The application reads the persisted rank and never regenerates it. This requires migration `20261105000100_ten_skill_badge_rank_freeze.sql`; until it is applied, the public UI shows threshold status but no locked ranks.
- The 5-badge milestone, filter, progress meter, and summary field have been removed entirely.
- The dashboard keeps public fields separate from the admin audit history. Admins can expand each participant's audit events to review count changes, notes, actor ID, event time, and verification time.
- CSV import requires an explicit confirmation checkbox; the server action independently rejects submissions without that confirmation.

## CSV participant import

Download [`public/participants-import-template.csv`](public/participants-import-template.csv) or use the authenticated admin page's template link. The required header is:

```csv
participant_key,display_name,profile_url
```

- `participant_key` is a stable, non-email key supplied by your registration workflow (1–120 letters, digits, `.`, `_`, `:`, or `-`). It is normalized to lowercase and uniquely constrained.
- `display_name` is the approved public display name (1–80 characters).
- `profile_url` is optional. If supplied, it must be an HTTPS Google Skills public profile URL. No profile is scraped.
- Files are limited to 1 MB and 500 valid rows. Quoted commas and escaped quotes are supported. Invalid rows and duplicates are reported with CSV row numbers.
- Re-imports never update an existing participant's display name, profile URL, registration state, or badge progress. New rows start at zero only; an import audit event is recorded.

The CSV parser has automated tests (`npm test`). The data import itself runs through the admin-only `admin_import_participants` database function.

## Organizer progress CSV (unverified fallback)

The `/admin` workspace also supports an organizer-only progress update while no permitted live Google Skills data provider is available. This is an explicitly unverified fallback; it never writes `participants.verified_badge_count`, `last_verified_at`, automatic badge snapshots, or automatic Top 10 ranks.

Download [`public/unverified-progress-template.csv`](public/unverified-progress-template.csv). The exact header is:

```csv
participant_key,profile_url,badge_count
```

Add one row for each currently registered participant, using that participant's exact key and current HTTPS public profile URL. Counts must be whole numbers from 0 to 10,000. Duplicate keys/profile URLs, unknown participants, changed profile URLs, malformed counts, and ambiguous registered URLs are excluded from the preview. The administrator reviews the matched preview and confirms before the database writes any previewed row. The database rechecks each identity inside one transaction. The import operation, admin actor, and affected participant IDs/counts are retained in separate audit tables; public access is limited to the registered participant's reported count and import time. The progress page displays the latest eligible import as **Organizer CSV · unverified**, with its import time. Profile changes invalidate the association. These organizer-reported counts do not qualify participants for automatic finish ranks or verified badges.

Automatic fetching remains disabled. Both `AUTO_PROGRESS_ENABLED=true` and `GOOGLE_SKILLS_PROFILE_FETCH_AUTHORIZED=true` are required server-side; the latter must remain false until written authorization for the intended retrieval is obtained. The protected `GET /api/cron/auto-progress` trigger requires a server-only `CRON_SECRET`, checks the provider/feature gates before creating a job, uses the existing database lock and durable batches, and returns run counters without participant details. It attempts bounded batches for at most 25 seconds per invocation; unfinished work remains persisted for a later protected invocation. Do not configure a schedule until an authorized provider is available and the deployment plan can support six-hour Cron execution. Google Skills' official help confirms public profiles may show earned badges, but the [Google Skills Boost Acceptable Use Policy](https://cloud.google.com/terms/skillsboost-organizations/aup) prohibits data extraction through data mining, robots, or similar tools. Whether this AUP applies to this community's public-profile use is unresolved; the policy gate must not be enabled without written clarification/authorization. ArcadeCalc's endpoint is undocumented and is not used as an authoritative source.

The admin source-observation panel offers a one-profile check and a bounded, resumable **Refresh All** only when both server-side fetch gates are true; Refresh All also requires a configured worker key. Both reuse the guarded HTML observer. Positive rendered card candidates remain in the separate unverified observation table. Only the one-profile admin action may record verified zero, and only after its explicit owner-policy confirmation when the response is HTTP 200, canonical identity matches exactly, the document is complete, no badge container exists, and no recognized loading, challenge, access-denied, or incomplete marker is present; it calls the existing audited admin verification RPC with a fixed policy note. Empty containers and all failures remain unknown. Refresh All is observations-only and never updates automatic snapshots, verified badge counts, verification timestamps, audit history, or ranks. It remains subject to admin authentication, origin checks, independent worker-key checks, durable leases/fencing, bounded concurrency, and the 60-second per-profile cooldown. Keep both gates false until applicable authorization is established; do not schedule these requests.

When an identity-matched HTTP 200 page is structurally complete but has no recognizable badge container, the diagnostic shows **“No badge section detected. This profile may have zero earned badges. Please manually verify before recording zero.”** It never records zero itself. The admin can use **Review and verify zero** to open the existing manual-verification form with the participant and zero prefilled; a required review note and confirmation remain necessary. The authenticated `admin_set_verified_badge_count` RPC is still the sole verified-count writer. Exact retries of the same manual review are idempotent and do not append a duplicate audit event; a new note/actor remains a new auditable review. Empty containers, failed fetches, identity mismatches, and pages with recognized loading/challenge/access markers remain unknown or failed.

### Manual source observations

When an organizer has a one-time diagnostic result, an administrator can record it under **Admin → Automatic progress → Record one profile diagnostic**. Select the exact registered participant key and current profile URL together, enter the source, retrieval time, HTTP result, any source-reported total and returned detail count, and confirm the observation. Leave counts blank for failed or blocked requests. Do not infer zero from an empty or inaccessible result. The record is append-only and labeled **unverified** or **partial**; failed attempts remain visible while the last report stays separately available. The public progress page shows these diagnostic values separately from organizer CSV imports and verified counts. They never update manual verification, automatic snapshots, or ranks.

Administrators must not treat a source total or HTML candidate count as earned-badge truth. The migrations `20261101000100_progress_observations.sql` and `20261102000100_durable_progress_observation_refresh.sql` must be reviewed and applied through the approved database release process before these actions can store or display observations. No database was accessed while preparing these migrations.

An approved provider must return a complete typed snapshot with the normalized profile URL, retrieval time, source, stable badge IDs, eligibility, and explicit pagination/truncation state. Missing badge arrays, duplicate IDs, malformed results, or unfinished pagination are failures and must preserve the last successful snapshot. The current automatic-progress tables persist eligible badge IDs and observed times; they do not persist badge titles or categories. Add storage for those fields only if an approved provider and product requirement need them. Provider output must not be converted to synthetic HTML to reuse the local fixture parser.

If six-hour scheduling is approved later, configure the protected route with the UTC schedule `0 */6 * * *` only after confirming the Vercel plan supports that frequency. Vercel Hobby supports daily Cron only; the Vercel account plan remains unverified. Each invocation drains bounded batches and the durable job resumes unfinished items on a later invocation; slow provider responses may extend completion beyond one six-hour window. The route is infrastructure only: no schedule is configured and live fetching remains unavailable.

## Google Form response synchronization

For the beginner-friendly order of operations, exact environment variable sources, Supabase setup, and Google Cloud setup, see [`SETUP_CHECKLIST.md`](SETUP_CHECKLIST.md). Run `npm run preflight` to check for missing configuration names without printing their values; this checks local presence and basic format only and does not verify access or perform a sync.

The admin workspace has **Preview Google Form sync** followed by a separate confirmation. Preview reads the configured private sheet, validates each row, reports new/updated/duplicate/invalid counts, and returns a short-lived signed preview token. Apply reads the sheet and participant records again; if either changed since preview, it rejects the stale confirmation. The database RPC is administrator-only. New participants begin at zero; updates change only display name and a non-empty public profile URL, preserve an existing profile link when the response is blank, preserve registration state and verified badge counts, and append an audit event. The sync never derives badges from a profile URL.

### Google Cloud and spreadsheet access

1. In Google Cloud Console, create or choose a project and [enable Google Sheets API](https://developers.google.com/workspace/guides/enable-apis).
2. [Create a dedicated Google Cloud service account](https://docs.cloud.google.com/iam/docs/service-accounts-create) for this dashboard, without granting project-wide roles. Create a [JSON key](https://docs.cloud.google.com/iam/docs/keys-create-delete) for it and keep the file in a secure password manager while configuring the Vercel secret. Do not add the JSON key to the repository or paste it into chat.
3. Copy the service account's `client_email`. [Share the private response spreadsheet](https://developers.google.com/workspace/guides/create-credentials#service-account) with that address as **Viewer** only. Do not enable link/public access. The app uses the official Sheets API with the `spreadsheets.readonly` scope.
4. Inspect the response tab's exact name, header row, and the exact text in the Name, Email, and Google Skills profile URL header cells. Set the mapping variables below to those exact values. Matching ignores case and repeated whitespace, but does not guess column order or aliases.
5. For local testing, add the values to ignored `.env.local`; for Vercel, add them in Project Settings → Environment Variables. The service account private key and match secret are server-only values. Do not prefix them with `NEXT_PUBLIC_`.

Required Google sync variables:

| Variable | Purpose |
| --- | --- |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | ID from the spreadsheet URL |
| `GOOGLE_SHEETS_TAB_NAME` | Exact response tab name |
| `GOOGLE_SHEETS_HEADER_ROW` | 1-based header row number (1–20) |
| `GOOGLE_SHEETS_NAME_HEADER` | Exact Name column header |
| `GOOGLE_SHEETS_EMAIL_HEADER` | Exact Email column header, used transiently for matching |
| `GOOGLE_SHEETS_PROFILE_URL_HEADER` | Exact Google Skills profile URL header |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Dedicated service account's client email |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | Private key from its JSON key file; store as a Vercel secret. Literal `\\n` sequences are converted to line breaks. |
| `PARTICIPANT_MATCH_HMAC_SECRET` | Dedicated random secret, at least 32 bytes, for keyed email identifiers and signed previews |

Generate a match secret locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. Keep this value stable and back it up securely: rotating it changes every participant match key and can make existing people appear new. The database stores only `form:<HMAC-SHA-256>` derived from the trimmed, lowercased email; it never stores the source email. HMAC is keyed pseudonymization, not anonymization: anyone with the secret and a candidate email can test a match. Do not reuse the secret for unrelated systems. If an email occurs more than once in the sheet, all rows with that identity are excluded for manual review—even if their other fields match—because the sheet alone cannot distinguish duplicate submissions from two people sharing an email. A profile URL already linked to a different participant is also reported for review rather than merged. Older CSV participants without a matching HMAC key can only be detected by an exact public profile URL match.

The reader fetches only the configured Name, Email, and profile URL columns. Mobile number, year, branch, section, RTU roll number, and class roll number are not fetched as response values or persisted. Email is read server-side only to compute the keyed identifier and is not returned in preview state, logs, or public projections.

The private sheet link supplied for this task could not be inspected or read from this workspace because no Google Sheets account or service-account credentials are connected. Header names therefore must be confirmed in the sheet and entered in the configurable environment variables before preview will work. No live synchronization has been run.

### Scheduled sync

Scheduled Google Form synchronization is not enabled. Its current database RPC requires a real authenticated administrator, and the manually triggered preview-and-confirm sync remains the supported workflow. Although a server-only Supabase service-role key is configured for isolated participant account linking and automatic-progress worker RPCs, it is not used to bypass the Google Form administrator workflow. No Vercel Cron writer is configured.

## Verification and audit model

An authenticated admin may record a current verified badge count (integer 0–10,000) with a required note. The database function records prior/new counts, the Supabase Auth user ID when available, the verification timestamp, and the manual source in an append-only audit event. `last_verified_at` is an observation/verification time. Itemized badge observations have a separate nullable `earned_at`; the count workflow never fabricates earned dates or milestone completion times. This is a community-reviewed count, not an integration with Google.

## Administrator authentication

`/admin/login` supports password sign-in and the existing email magic-link flow. The same page can request a Supabase password reset; the recovery callback is limited to `/admin/update-password`. Both password and magic-link sign-in still pass the server-side `public.admin_users` membership check before the workspace renders. Sign-in never creates an account or admin membership. Enable Supabase Email/password auth and allow the local/deployment redirect patterns in **Authentication → URL Configuration** as described in [SETUP_CHECKLIST.md](SETUP_CHECKLIST.md). End-to-end password reset requires a real Supabase account and a recovery email; it has not been verified from this code workspace.

The admin workspace only uses existing participant and audit records. “Last recorded sync activity” is derived from Google Sheets audit events and remains empty until such an event exists. A preview is never requested automatically by rendering the dashboard.

## Architecture

- `src/lib/types.ts` defines the public snapshot and provider interface.
- `src/lib/demo-provider.ts` retains synthetic records for local UI work.
- `src/lib/supabase/leaderboard-provider.ts` serves a restricted public projection.
- `src/app/admin` contains Auth-gated server actions and admin UI.
- `supabase/migrations` contains tables, constraints, policies, RPCs, and audit records.
- `supabase/tests` contains pgTAP RLS assertions.

No bulk Google Skills Boost collection or undocumented API is used. The optional admin diagnostic performs only one guarded public HTML request per explicit submission and records its card candidates as unverified; it is not the automatic provider. The GDG BCET dashboard and GDG-Link are visual/architecture references only; their 2025 backend is not used.

Admins can review verified zero or positive badge counts in the Badge Verification section. For multiple reviewed counts, use the authenticated bulk CSV preview and confirmation workflow described in [the verified badge CSV guide](scripts/README-verified-badge-csv.md). Each entry goes through the existing audited manual-verification RPC; unverified profile observations and organizer-reported progress are never promoted automatically. Keep `AUTO_PROGRESS_ENABLED=false` and do not configure a schedule until an authorized, complete data source is established.

## Vercel deployment

The app uses the standard Next.js build (`npm run build`) and does not need a custom `vercel.json`. Add only these project environment variables in Vercel **Settings → Environment Variables**:

| Variable | Required when | Value |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Using the database provider or admin sign-in | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Using the database provider or admin sign-in | Supabase publishable key (`sb_publishable_…`) |

Both are safe public configuration values; PostgreSQL grants and RLS protect data. The durable worker requires `SUPABASE_SERVICE_ROLE_KEY` as a server-only Vercel environment variable, but its RPC grants are isolated and live profile fetching remains disabled until an authorized provider is configured. If the public values are absent, the site uses synthetic demo data and disables admin tools. Add Production values to Production and appropriate test-project values to Preview; Vercel applies environment changes to new deployments.

### GitHub-to-Vercel checklist

1. Review the current changes, then commit and push them to the existing GitHub repository on its intended production branch.
2. In Vercel, choose **Add New → Project**, authorize GitHub access if prompted, and import that repository. Keep the repository root as the project root and the Next.js framework/build defaults (`npm run build`).
3. Add the Supabase public variables above in the Vercel environment scopes you intend to use. Keep `SUPABASE_SERVICE_ROLE_KEY` in a server-only encrypted environment setting and never expose it in client code or logs.
4. Deploy and use the default `*.vercel.app` URL. After the first deployment reveals that URL, set it as the Supabase Auth Site URL and add `https://<your-vercel-host>/auth/callback` to the Supabase Auth redirect allow-list. Keep localhost for local testing; add preview callbacks only if you will test admin sign-in on Preview deployments.
5. Verify the deployed home page shows **DATABASE** (not **DEMO DATA**), `/admin` redirects signed-out users to sign-in, a non-admin account is denied, and an authorized admin can import/update and inspect audit history. Run the RLS tests in staging before production use.

The default Vercel URL is sufficient; no custom domain is required. Vercel import/deployment and the live Auth checks require GitHub/Vercel access and Supabase project credentials, which are not available in this workspace.

For database and Google response synchronization in Production, also add all Supabase and Google variables listed above. Use a separate Google service account/key and match secret for Preview if the Preview project should read a separate test sheet; otherwise leave Google sync variables unset in Preview. Changes to Vercel environment variables require a new deployment.

## Checks

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

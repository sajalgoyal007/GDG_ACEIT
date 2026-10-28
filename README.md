# GDG ACEIT — Learn with Communities 2026 Leaderboard

A Next.js App Router dashboard with a provider interface, synthetic demo provider, and optional Supabase PostgreSQL persistence. The UI shows a visible data-source label. Demo records are synthetic; database badge counts are values entered by this community and are not claims of Google verification.

## Run locally

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. Without Supabase environment variables, the dashboard uses only synthetic demo data and management actions stay unavailable.

## Supabase setup

1. Create a Supabase project and copy its project URL and publishable key into a local `.env.local` using `.env.example` as a template. The publishable key is intended for browser use; PostgreSQL grants and RLS are the access boundary. Do not add a service-role or secret key to this app.
2. Install the Supabase CLI and authenticate/link the project using Supabase's documented workflow. Apply the migrations in `supabase/migrations/` (for example `supabase db push`). Review the SQL before applying it to a production project.
3. Enable Supabase Auth email OTP/magic links and add `http://localhost:3000/auth/callback` to the project's allowed redirect URLs (plus the production callback after deployment). `shouldCreateUser: false` prevents the admin login form from creating arbitrary accounts. Create/invite operator accounts through the Supabase dashboard.
4. Add each approved Auth user's UUID to `public.admin_users` using the Supabase SQL editor as the project owner. The table intentionally contains no email addresses. Admin membership is read through the authenticated user's session; privileged actions are enforced again by security-definer RPCs and `private.is_admin()`.
5. Run the RLS database tests in `supabase/tests/leaderboard_rls.test.sql` using Supabase CLI/pgTAP in a local or staging database before production use. This repository does not include project credentials, so the migration, live Auth flow, and RLS tests have not been applied or run against your Supabase project. Do not treat a deployment as production-ready until those checks pass in your environment.

The app uses the publishable key with the signed-in user's cookies for admin operations and a separate anonymous client for the public leaderboard. The public table grant exposes only display name, public profile URL, badge aggregate, and verification metadata; RLS limits rows to registered participants. Aggregate statistics come from `get_public_summary()`. Admin reads and writes are additionally role-checked by PostgreSQL. No participant email is collected in this workflow. Supabase Auth may process admin login addresses for authentication, but participant registration data must not be placed there or in the participant CSV.

## Milestones and ranking

- 0–4 recorded verified badges: **In Progress**.
- 5–9: **5-Badge Milestone**.
- 10 or more: **10-Badge Milestone**, which also qualifies for the 5+ threshold and filter.
- Participants are ordered by badge count descending, then stable participant UUID ascending for tied counts. Equal counts share a competition rank (`1, 1, 3`); verification timestamps and milestone-earned times are not used for ranking.
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

Scheduled synchronization is not enabled. The current database RPC requires a real authenticated administrator and this app intentionally has no service-role key or alternate privileged database identity. Adding a Vercel Cron writer would require a separate privileged server-side database path and credentials, which would expand access beyond the user-scoped admin workflow. The manually triggered preview-and-confirm sync is the supported workflow until that security design is separately approved and tested.

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

No Google Skills Boost scraping or undocumented APIs are used. The GDG BCET dashboard and GDG-Link are visual/architecture references only; their 2025 backend is not used.

## Vercel deployment

The app uses the standard Next.js build (`npm run build`) and does not need a custom `vercel.json`. Add only these project environment variables in Vercel **Settings → Environment Variables**:

| Variable | Required when | Value |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Using the database provider or admin sign-in | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Using the database provider or admin sign-in | Supabase publishable key (`sb_publishable_…`) |

Both are safe public configuration values; PostgreSQL grants and RLS protect data. No service-role or secret key is needed or supported by this app. If these values are absent, the site uses synthetic demo data and disables admin tools. Add production values to Production and appropriate test-project values to Preview; Vercel applies environment changes to new deployments.

### GitHub-to-Vercel checklist

1. Push the finished project to the existing GitHub repository on its intended production branch. This workspace currently has no `.git` directory or remote configured, so local changes still need to be committed and pushed from the repository checkout.
2. In Vercel, choose **Add New → Project**, authorize GitHub access if prompted, and import that repository. Keep the repository root as the project root and the Next.js framework/build defaults (`npm run build`).
3. Add the two Supabase variables above in the Vercel environment scopes you intend to use. Do not add `SUPABASE_SERVICE_ROLE_KEY` or other privileged credentials.
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

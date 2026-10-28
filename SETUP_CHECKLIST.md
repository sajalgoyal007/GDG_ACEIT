# GDG ACEIT leaderboard setup checklist

Use these steps in order. The spreadsheet stays private and is read through Google's official Sheets API in read-only mode. The app fetches only the configured name, email, and public profile URL columns; it does not request phone or roll-number columns. Email is used on the server to derive a keyed matching ID and is not stored or displayed.

## 1. Prepare Supabase

1. Create/open the Supabase project and copy its **Project URL** and **publishable key** from **Project Settings → API**. Put them in your local `.env.local` (copy `.env.example`) and later in Vercel as described below.
2. The Supabase CLI is a project-local development dependency. Sign in with `npx supabase login`, then from this project folder run the [migration workflow](https://supabase.com/docs/guides/local-development/database-migrations):

   ```powershell
   npx supabase login
   $ProjectRef = "<YOUR_PROJECT_REF>"
   npx supabase link --project-ref $ProjectRef
   npx supabase migration list
   npx supabase db push --dry-run
   ```

   Replace `YOUR_PROJECT_REF` with the Reference ID shown in Supabase **Project Settings → General** (also in the project dashboard URL). The `project_id` in `supabase/config.toml` is only a local CLI label; do not use it as the remote Reference ID. Review the migration list and dry-run output before applying. The repository migrations, in order, are `20261026000100_leaderboard.sql`, `20261027000100_leaderboard_tie_order.sql`, and `20261028000100_google_form_sync.sql`. `db push` applies pending migrations; it does not replace the schema from scratch. If this remote project already has tables or hand-applied schema, stop and reconcile it before pushing.

   Only after verifying the linked project is the intended **empty/new** project and the dry run lists only these expected migrations, apply them:

   ```powershell
   npx supabase db push
   npx supabase migration list
   ```
3. Set up a local database test environment with Docker, then run `supabase start` and [`supabase test db`](https://supabase.com/docs/guides/local-development/cli/testing-and-linting). This runs `supabase/tests/leaderboard_rls.test.sql` and `supabase/tests/google_form_sync.test.sql` against the local Supabase database. Do not run SQL test fixtures against production. Ensure both tests pass before using admin sync.
4. In **Authentication → Sign In / Providers → Email**, confirm email authentication is enabled. This app uses existing accounts only: it contains no sign-up flow. Keep **Allow new users to sign up** disabled if accounts are invite-only. Email magic links remain available alongside passwords. Password recovery uses the Supabase recovery email and requires an authenticated recovery session; it never grants admin membership. The app requires a minimum 12-character password when setting/resetting one. In **Authentication → Email Templates → Reset Password**, keep the reset template active and make sure it uses Supabase’s recovery link.
5. In **Authentication → URL Configuration**, set the local Site URL to `http://localhost:3000`; add both of these under **Redirect URLs**:

   ```text
   http://localhost:3000/auth/callback
   http://localhost:3000/auth/callback?next=%2Fadmin%2Fupdate-password
   ```

   After Vercel provides the deployment URL, set the production Site URL to `https://<your-project>.vercel.app` and add the corresponding two callback URLs, replacing the host. Add both callback URLs for Preview hosts only if you will test admin sign-in there. The callback accepts only `/admin` or the fixed `/admin/update-password` destination; it does not accept arbitrary external redirect targets. See [Supabase Auth redirect URL configuration](https://supabase.com/docs/guides/auth/redirect-urls).
6. In **Authentication → Users**, invite/create the administrator account. Sign in once using `/admin/login` and the provisioned account. Copy that Auth user's UUID from the dashboard. As the project owner, run this in **SQL Editor** (replace the UUID):

   ```sql
   insert into public.admin_users (user_id)
   values ('00000000-0000-0000-0000-000000000000')
   on conflict (user_id) do nothing;
   ```

   This grants admin membership to that Auth user; an email address is not put in the participant database. Verify `/admin` works for the admin and denies a signed-out user and a signed-in non-admin. Password sign-in and password reset do not change this allow-list.

## 2. Allow read-only Google Sheets access

1. In [Google Cloud Console](https://console.cloud.google.com/), select/create a project. Open **APIs & Services → Library**, find **Google Sheets API**, and select **Enable**.
2. Go to **IAM & Admin → Service Accounts → Create service account**. Give it a recognizable name such as `gdg-aceit-sheet-reader`. Do not grant it project roles; it only needs access to this one spreadsheet.
3. Open the service account, use **Keys → Add key → Create new key → JSON**, and save the downloaded JSON securely. Its `client_email` and `private_key` supply the corresponding settings below. Never commit the JSON or put its contents in browser code.
4. Open the supplied spreadsheet in Google Drive, click **Share**, enter the service account's `client_email`, and grant **Viewer**. Keep general access restricted. This is a manual action; the app will never alter sharing settings.
5. In the spreadsheet, identify the exact response tab name, header row number, and header cell text for **Name**, **Email**, and the public Google Skills profile URL. Set the three header mapping variables and tab/row variables exactly. Header comparison ignores case and repeated whitespace, but does not guess aliases or column order. Do not use private phone/roll fields.

   **The private spreadsheet contents could not be inspected from this workspace.** The `.env.example` values `Form Responses 1`, `1`, `Name`, `Email`, and `Google Skills profile URL` are examples only; confirm them against your sheet before syncing. No sheet data has been read and no live sync has been run.

## 3. Configure environment variables

Copy `.env.example` to ignored `.env.local` for local use. Use the same exact names in **Vercel → Project → Settings → Environment Variables** for Production (and Preview only if Preview should access a separate test sheet). Add secrets in the Vercel UI; do not commit them. Redeploy after changing Vercel environment values.

| Exact variable | Where to get/set the value | Local / Vercel |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase **Project Settings → API → Project URL** | `.env.local` / Vercel |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase **Project Settings → API → Publishable key** | `.env.local` / Vercel |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | Between `/d/` and `/edit` in the spreadsheet URL | `.env.local` / Vercel |
| `GOOGLE_SHEETS_TAB_NAME` | Exact bottom tab label in the response spreadsheet | `.env.local` / Vercel |
| `GOOGLE_SHEETS_HEADER_ROW` | 1-based row number containing the column headers (supported: 1–20) | `.env.local` / Vercel |
| `GOOGLE_SHEETS_NAME_HEADER` | Exact header cell for participant display name | `.env.local` / Vercel |
| `GOOGLE_SHEETS_EMAIL_HEADER` | Exact header cell for matching email; read transiently only | `.env.local` / Vercel |
| `GOOGLE_SHEETS_PROFILE_URL_HEADER` | Exact header cell for public Google Skills profile URL | `.env.local` / Vercel |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | `client_email` in the service account JSON; this is the address you shared as Viewer | `.env.local` / Vercel |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | `private_key` in the downloaded JSON; server-only secret. Literal `\n` line breaks are accepted. | `.env.local` / Vercel secret |
| `PARTICIPANT_MATCH_HMAC_SECRET` | Generate a unique random value locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`; keep it stable and back it up securely | `.env.local` / Vercel secret |

The Supabase publishable key is intended to be public; never add a Supabase service-role/secret key. Google key and HMAC secret must not have a `NEXT_PUBLIC_` prefix. The HMAC key must remain stable: changing it makes existing form identities unmatchable and may create duplicate participant records.

Run `npm run preflight` to see only which variable names are missing or whether configuration has basic format problems. It never prints values and does not contact either service, so a `READY` result is not proof that credentials, permissions, migrations, or spreadsheet headers work.

## 4. Verify locally, then sync

1. Start `npm run dev`, open `http://localhost:3000/admin/login`, and use the provisioned administrator sign-in link.
2. In the admin area choose **Preview Google Form sync**. Review counts and row issues. An empty response sheet has no changes to apply; invalid or duplicate identities are excluded; changed sheet/database data invalidates the preview; invalid profile URLs are rejected. The confirmation token expires after 10 minutes.
3. Confirm once. Repeating a successful sync is idempotent: unchanged rows do not create new participants/audit writes, updated registration details preserve verified badge progress, and new participants start at zero badges. The database also rejects duplicate matching keys and profile URL conflicts.
4. Check the dashboard and admin audit history. The spreadsheet is only read; no badge totals are inferred from profiles. Do not claim real synchronization is working until this authorized preview and confirmed sync succeed against your actual sheet.

## 5. Vercel

Push the existing repository to GitHub, import it in Vercel with the repository root and default Next.js settings, add the Supabase variables, and deploy to the default `*.vercel.app` URL. Add the Google variables only after the Google access steps are complete. Then configure the Supabase production callback URL using the actual Vercel URL and verify admin authorization and one real preview/confirm sync. Deployment and synchronization have not been performed from this workspace.

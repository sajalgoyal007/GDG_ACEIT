import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const configured = (name) => {
  const value = process.env[name]?.trim();
  if (!value || /^(replace_with|your[-_])/i.test(value)) return false;
  return true;
};

const checks = [
  {
    title: "Supabase public project configuration",
    variables: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"],
    valid: () => {
      try {
        const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
        return url.protocol === "https:" && Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim());
      } catch {
        return false;
      }
    },
  },
  {
    title: "Google Sheets read-only sync configuration",
    variables: [
      "GOOGLE_SHEETS_SPREADSHEET_ID",
      "GOOGLE_SHEETS_TAB_NAME",
      "GOOGLE_SHEETS_HEADER_ROW",
      "GOOGLE_SHEETS_NAME_HEADER",
      "GOOGLE_SHEETS_EMAIL_HEADER",
      "GOOGLE_SHEETS_PROFILE_URL_HEADER",
      "GOOGLE_SERVICE_ACCOUNT_EMAIL",
      "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
      "PARTICIPANT_MATCH_HMAC_SECRET",
    ],
    valid: () => {
      const row = Number(process.env.GOOGLE_SHEETS_HEADER_ROW);
      return /^[A-Za-z0-9_-]{20,}$/.test(process.env.GOOGLE_SHEETS_SPREADSHEET_ID ?? "")
        && Number.isInteger(row) && row >= 1 && row <= 20
        && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? "")
        && /PRIVATE KEY/.test(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ?? "")
        && Buffer.byteLength(process.env.PARTICIPANT_MATCH_HMAC_SECRET ?? "", "utf8") >= 32;
    },
  },
];

let allReady = true;
for (const check of checks) {
  const missing = check.variables.filter((name) => !configured(name));
  const ready = missing.length === 0 && check.valid();
  allReady &&= ready;
  console.log(`${ready ? "READY" : "INCOMPLETE"}  ${check.title}`);
  if (!ready) {
    for (const name of missing) console.log(`  Missing: ${name}`);
    if (missing.length === 0) console.log("  One or more values are present but fail basic format checks.");
  }
}

console.log("\nPreflight checks presence and basic format only; it does not contact Supabase or Google.");
console.log(allReady ? "Configuration looks complete." : "Add the listed values in .env.local or the matching Vercel environment, then rerun npm run preflight.");
if (!allReady) process.exitCode = 1;

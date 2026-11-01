import type { UnverifiedProgressEntry } from "@/lib/supabase/auto-progress-provider";

function formatImportedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Import time unavailable";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(date) + " IST";
}

export function UnverifiedProgressLeaderboard({ entries }: { entries: UnverifiedProgressEntry[] }) {
  return <section className="unverified-progress-list" aria-labelledby="unverified-progress-title">
    <div><p className="eyebrow">ORGANIZER CSV · UNVERIFIED</p><h2 id="unverified-progress-title">Imported progress updates</h2><p>Reported counts are displayed separately. They do not affect verified badge counts or automatic finish ranks.</p></div>
    {entries.length === 0 ? <p className="unverified-progress-empty">No organizer progress updates have been imported.</p> : <ul>
      {entries.map((entry) => <li key={entry.participantId}><div><strong>{entry.displayName}</strong><span>{entry.badgeCount} reported badges</span></div><small>Unverified · imported {formatImportedAt(entry.importedAt)}</small></li>)}
    </ul>}
  </section>;
}

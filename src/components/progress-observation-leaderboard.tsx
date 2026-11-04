import type { ProgressObservationSummary } from "@/lib/supabase/auto-progress-provider";

function sourceLabel(source: NonNullable<ProgressObservationSummary["reportSourceName"]> | ProgressObservationSummary["latestSourceName"]) {
  return source === "arcadecalc_frontend" ? "ArcadeCalc frontend" : "Google Skills public HTML";
}

function dateLabel(value: string | null) {
  if (!value) return "No reported data snapshot";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Timestamp unavailable";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(date) + " IST";
}

function statusLabel(status: ProgressObservationSummary["latestStatus"]) {
  if (status === "partial") return "Partial · unverified";
  if (status === "failed") return "Latest request failed";
  if (status === "blocked") return "Blocked";
  return "Unverified · completeness unknown";
}

export function ProgressObservationLeaderboard({ entries, admin = false }: { entries: ProgressObservationSummary[]; admin?: boolean }) {
  if (entries.length === 0 && !admin) return null;
  return <section className="progress-observation-list" aria-labelledby={admin ? "admin-observations-title" : "progress-observations-title"}>
    <div>
      <p className="eyebrow">DIAGNOSTIC SOURCE REPORTS · UNVERIFIED</p>
      <h2 id={admin ? "admin-observations-title" : "progress-observations-title"}>{admin ? "Latest profile observations" : "Source-reported profile diagnostics"}</h2>
      <p>These reports do not represent verified earned badges and do not affect automatic snapshots, verified counts, or ranks.</p>
    </div>
    {entries.length === 0 ? <p className="progress-observation-empty">No profile observations have been recorded.</p> : <ul>
      {entries.map((entry) => {
        const stale = entry.lastReportedAt !== null && Date.now() - Date.parse(entry.lastReportedAt) > 6 * 60 * 60 * 1000;
        return <li key={entry.participantId}>
          <div className="progress-observation-main">
            <strong>{entry.displayName}</strong>
            <span>Latest attempt: {sourceLabel(entry.latestSourceName)} · {statusLabel(entry.latestStatus)}</span>
            {entry.reportedTotal !== null
              ? <span>{entry.reportSourceName === "google_skills_public_html" ? "Observed HTML badge-card candidates (not a total)" : "Last source-reported total"}: {entry.reportedTotal} · returned details: {entry.detailCount ?? "unavailable"}{entry.uniqueBadgeCount === null ? " · unique badge IDs not established" : ` · unique IDs: ${entry.uniqueBadgeCount}`} · {entry.reportSourceName ? sourceLabel(entry.reportSourceName) : "source unavailable"}</span>
              : <span>No count was recorded for the latest result.</span>}
          </div>
          <div className="progress-observation-times">
            {entry.reportedTotal !== null && <small>Last reported data: {dateLabel(entry.lastReportedAt)}{stale ? " · stale after six hours" : ""}</small>}
            <small>Latest source attempt: {dateLabel(entry.latestRetrievedAt)} · HTTP {entry.latestHttpStatus}</small>
            <small>Identity: not independently verified</small>
          </div>
        </li>;
      })}
    </ul>}
  </section>;
}

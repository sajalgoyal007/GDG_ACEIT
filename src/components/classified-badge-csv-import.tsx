"use client";

import { useActionState } from "react";
import { Award } from "lucide-react";
import { applyClassifiedBadgeCsvAction, previewClassifiedBadgeCsvAction } from "@/app/admin/actions";
import { initialClassifiedBadgeImportState, type ClassifiedBadgeImportResult } from "@/app/admin/classified-badge-import-state";

function csvCell(value: string | number | null | undefined) {
  // NULL means the row was not applied. Never serialize it as zero.
  const text = value === null || value === undefined ? "Not applied" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadCsv(name: string, rows: readonly (string | number | null)[][]) {
  const content = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function reportRows(results: readonly ClassifiedBadgeImportResult[], status: ClassifiedBadgeImportResult["status"]) {
  return results
    .filter((row) => row.status === status)
    .map((row) => [
      row.rowNumber,
      row.participantId,
      row.skillBadgeCount,
      row.arcadeGameBadgeCount,
      row.totalBadgeCount,
      row.status,
      row.reason,
    ]);
}

export function ClassifiedBadgeCsvImport() {
  const [preview, previewAction, previewPending] = useActionState(
    previewClassifiedBadgeCsvAction,
    initialClassifiedBadgeImportState,
  );
  const [applied, applyAction, applyPending] = useActionState(
    applyClassifiedBadgeCsvAction,
    initialClassifiedBadgeImportState,
  );
  const rows = preview.rows ?? [];
  const approvedRows = rows.filter((row) => row.previewStatus === "approved");
  const hasRun = Boolean(preview.runId && preview.previewFingerprint);
  const alreadyApplied = applied.runStatus === "applied" || preview.runStatus === "applied";
  const skippedRows = [
    ...(preview.issues ?? []).map(
      (issue) =>
        [issue.rowNumber, "", null, null, null, issue.kind, issue.message] as (string | number | null)[],
    ),
    ...reportRows(applied.results ?? [], "skipped"),
  ];

  return (
    <article className="admin-panel admin-import-panel" id="classified-badge-import">
      <div className="admin-panel-heading">
        <span className="admin-panel-icon blue">
          <Award size={16} aria-hidden="true" />
        </span>
        <div>
          <p className="admin-panel-eyebrow">OFFICIAL SKILL &amp; ARCADE BADGE IMPORT</p>
          <h3>Bulk import Skill &amp; Arcade badge counts</h3>
        </div>
      </div>
      <div className="admin-import-guidance">
        <strong>Required columns (data/classified-badge-import.csv)</strong>
        <code>participant_id,skill_badge_count,arcade_game_badge_count,total_badge_count,review_note</code>
        <p>
          Upload <code>data/classified-badge-import.csv</code> here. Enforces the sum invariant: <code>skill_badge_count + arcade_game_badge_count = total_badge_count</code>.
          Zeroes are permitted when genuinely verified. Unknown badges must be resolved prior to import.
          Skill badge count determines official leaderboard ranking.
          Preview creates a server-side run; apply revalidates the stored fingerprint, so a repeated or concurrent apply never writes a duplicate audit event.
        </p>
      </div>
      <form action={previewAction} className="admin-form">
        <label htmlFor="classified-badge-csv">Select classified badge CSV (data/classified-badge-import.csv)</label>
        <input
          id="classified-badge-csv"
          type="file"
          name="classifiedBadgeCsv"
          accept=".csv,text/csv"
          required
          disabled={previewPending || applyPending}
        />
        <button type="submit" disabled={previewPending || applyPending}>
          {previewPending ? "Validating classified roster…" : "Preview classified badge CSV"}
        </button>
      </form>
      {preview.status !== "idle" && (
        <div
          className={`admin-feedback ${preview.status === "preview" ? "success" : "error"}`}
          role={preview.status === "error" ? "alert" : "status"}
        >
          <p>{preview.message}</p>
          {preview.totals ? (
            <p>
              <strong>Skill {preview.totals.skill}</strong> + <strong>Arcade {preview.totals.arcade}</strong> ={" "}
              <strong>{preview.totals.total}</strong> across {preview.totals.participants} participant
              {preview.totals.participants === 1 ? "" : "s"} · {preview.totals.blocked} blocked ·{" "}
              {preview.totals.unclassified} unclassified · {preview.totals.pending} pending
            </p>
          ) : null}
          {preview.issues?.length ? (
            <ul>
              {preview.issues.map((issue, index) => (
                <li key={`${issue.rowNumber}-${index}`}>
                  <strong>Row {issue.rowNumber} · {issue.kind}:</strong> {issue.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
      {preview.status === "preview" && rows.length > 0 && (
        <>
          <div className="admin-directory-table-wrap">
            <table className="admin-directory-table">
              <thead>
                <tr>
                  <th scope="col">CSV ROW</th>
                  <th scope="col">PARTICIPANT</th>
                  <th scope="col">CURRENT TOTAL</th>
                  <th scope="col">SKILL BADGES</th>
                  <th scope="col">ARCADE BADGES</th>
                  <th scope="col">NEW TOTAL</th>
                  <th scope="col">DELTA</th>
                  <th scope="col">STATUS</th>
                  <th scope="col">REVIEW NOTE</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.rowNumber}-${row.participantId}`}>
                    <td>{row.rowNumber}</td>
                    <td>
                      <strong>{row.displayName}</strong>
                      <small>{row.participantId}</small>
                    </td>
                    <td>
                      {row.verifiedBadgeCount}
                      {row.currentSkillBadgeCount !== null
                        ? ` (${row.currentSkillBadgeCount} skill, ${row.currentArcadeGameBadgeCount} arcade)`
                        : " (unclassified)"}
                    </td>
                    <td><strong>{row.skillBadgeCount ?? "—"}</strong></td>
                    <td>{row.arcadeGameBadgeCount ?? "—"}</td>
                    <td><strong>{row.totalBadgeCount ?? "—"}</strong></td>
                    <td>{row.delta ?? "—"}</td>
                    <td>
                      {row.previewStatus === "approved"
                        ? "approved"
                        : `Not applied (${row.previewStatus ?? "pending"})`}
                    </td>
                    <td>{row.blockingReason ?? row.reviewNote}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hasRun && !alreadyApplied && approvedRows.length > 0 && (
            <form
              action={applyAction}
              className="admin-form"
              onSubmit={(event) => {
                if (
                  !window.confirm(
                    `Apply ${approvedRows.length} approved classified badge count updates? The server will revalidate the preview fingerprint before writing.`,
                  )
                ) {
                  event.preventDefault();
                }
              }}
            >
              <input type="hidden" name="runId" value={preview.runId} />
              <input type="hidden" name="previewFingerprint" value={preview.previewFingerprint} />
              <label className="admin-confirm">
                <input
                  type="checkbox"
                  name="confirmClassifiedBadgeImport"
                  value="confirmed"
                  required
                  disabled={applyPending}
                />
                I reviewed every eligible classification and confirm this bulk update.
              </label>
              <button type="submit" disabled={applyPending}>
                {applyPending ? "Applying classifications…" : `Apply ${approvedRows.length} approved update${approvedRows.length === 1 ? "" : "s"}`}
              </button>
            </form>
          )}
          {alreadyApplied ? (
            <p className="admin-help">
              This run is already applied. Re-submitting returns the stored result without writing counts or audit events again.
            </p>
          ) : (
            <p className="admin-help">
              Updates total verified counts and category breakdowns in a single server-side run and records audit trail events.
            </p>
          )}
        </>
      )}
      {applied.status !== "idle" && (
        <div className={`admin-feedback ${applied.status}`} role={applied.status === "error" ? "alert" : "status"}>
          <p>{applied.message}</p>
          {applied.issues?.length ? (
            <ul>
              {applied.issues.map((issue, index) => (
                <li key={`${issue.rowNumber}-${index}`}>
                  <strong>Row {issue.rowNumber} · {issue.kind}:</strong> {issue.message}
                </li>
              ))}
            </ul>
          ) : null}
          {applied.results && (
            <div className="admin-import-report-links">
              <button
                type="button"
                onClick={() =>
                  downloadCsv("classified-badge-success.csv", [
                    ["row_number", "participant_id", "skill_badge_count", "arcade_game_badge_count", "total_badge_count", "status", "reason"],
                    ...reportRows(applied.results ?? [], "success"),
                  ])
                }
              >
                Download success report
              </button>
              <button
                type="button"
                onClick={() =>
                  downloadCsv("classified-badge-skipped.csv", [
                    ["row_number", "participant_id", "skill_badge_count", "arcade_game_badge_count", "total_badge_count", "status", "reason"],
                    ...skippedRows,
                  ])
                }
              >
                Download skipped report
              </button>
              <button
                type="button"
                onClick={() =>
                  downloadCsv("classified-badge-failed.csv", [
                    ["row_number", "participant_id", "skill_badge_count", "arcade_game_badge_count", "total_badge_count", "status", "reason"],
                    ...reportRows(applied.results ?? [], "failed"),
                  ])
                }
              >
                Download failed report
              </button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

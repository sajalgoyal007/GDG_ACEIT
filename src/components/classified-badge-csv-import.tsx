"use client";

import { useActionState, useState } from "react";
import { Award } from "lucide-react";
import { applyClassifiedBadgeCsvAction, previewClassifiedBadgeCsvAction } from "@/app/admin/actions";
import { initialClassifiedBadgeImportState, type ClassifiedBadgeImportResult } from "@/app/admin/classified-badge-import-state";

function csvCell(value: string | number) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadCsv(name: string, rows: readonly (string | number)[][]) {
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
  const [appliedForPreview, setAppliedForPreview] = useState(false);
  const rows = preview.rows ?? [];
  const skippedRows = [
    ...(preview.issues ?? []).map(
      (issue) => [issue.rowNumber, "", "", "", "", issue.kind, issue.message] as (string | number)[],
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
        </p>
      </div>
      <form action={previewAction} className="admin-form" onSubmit={() => setAppliedForPreview(false)}>
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
      {preview.status === "preview" && !appliedForPreview && rows.length > 0 && (
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
                    <td><strong>{row.skillBadgeCount}</strong></td>
                    <td>{row.arcadeGameBadgeCount}</td>
                    <td><strong>{row.totalBadgeCount}</strong></td>
                    <td>{row.reviewNote}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form
            action={applyAction}
            className="admin-form"
            onSubmit={(event) => {
              if (
                !window.confirm(
                  `Apply ${rows.length} classified badge count updates? This will set Skill Badge and Arcade Game Badge counts with audited history.`,
                )
              ) {
                event.preventDefault();
              } else {
                setAppliedForPreview(true);
              }
            }}
          >
            <input type="hidden" name="previewRows" value={JSON.stringify(rows)} />
            <input type="hidden" name="previewIssues" value={JSON.stringify(preview.issues ?? [])} />
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
              {applyPending ? "Applying classifications…" : `Apply ${rows.length} classified update${rows.length === 1 ? "" : "s"}`}
            </button>
          </form>
          <p className="admin-help">
            Updates total verified counts and category breakdowns in a single transaction and records audit trail events.
          </p>
        </>
      )}
      {appliedForPreview && applied.status !== "idle" && (
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


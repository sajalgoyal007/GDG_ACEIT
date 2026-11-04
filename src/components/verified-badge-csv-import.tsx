"use client";

import { useActionState, useState } from "react";
import { ArrowDownToLine, FileUp } from "lucide-react";
import { applyVerifiedBadgeCsvAction, previewVerifiedBadgeCsvAction } from "@/app/admin/actions";
import { initialVerifiedBadgeImportState, type VerifiedBadgeImportResult } from "@/app/admin/verified-badge-import-state";

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

function reportRows(results: readonly VerifiedBadgeImportResult[], status: VerifiedBadgeImportResult["status"]) {
  return results.filter((row) => row.status === status).map((row) => [row.rowNumber, row.participantId, row.badgeCount, row.status, row.reason]);
}

export function VerifiedBadgeCsvImport() {
  const [preview, previewAction, previewPending] = useActionState(previewVerifiedBadgeCsvAction, initialVerifiedBadgeImportState);
  const [applied, applyAction, applyPending] = useActionState(applyVerifiedBadgeCsvAction, initialVerifiedBadgeImportState);
  const [appliedForPreview, setAppliedForPreview] = useState(false);
  const rows = preview.rows ?? [];
  const skippedRows = [
    ...(preview.issues ?? []).map((issue) => [issue.rowNumber, "", "", issue.kind, issue.message] as (string | number)[]),
    ...reportRows(applied.results ?? [], "skipped"),
  ];
  return <article className="admin-panel admin-import-panel">
    <div className="admin-panel-heading"><span className="admin-panel-icon green"><FileUp size={16} aria-hidden="true" /></span><div><p className="admin-panel-eyebrow">AUDITED VERIFIED COUNTS</p><h3>Bulk verify badge counts</h3></div></div>
    <div className="admin-import-guidance"><strong>Required columns</strong><code>participant_id,verified_badge_count,review_note</code><p>Use the admin-only roster export and independently reviewed evidence. A count of 0 is valid. Each write runs through the existing audited admin verification RPC; observations are never promoted.</p><p><a href="/api/admin/verified-badge-roster" download>Download current participant UUID roster <ArrowDownToLine size={13} aria-hidden="true" /></a></p><p><a href="/verified-badge-count-template.csv" download>Download CSV template <ArrowDownToLine size={13} aria-hidden="true" /></a></p></div>
    <form action={previewAction} className="admin-form" onSubmit={() => setAppliedForPreview(false)}>
      <label htmlFor="verified-badge-csv">Select reviewed verified-count CSV</label>
      <input id="verified-badge-csv" type="file" name="verifiedBadgeCsv" accept=".csv,text/csv" required disabled={previewPending || applyPending} />
      <button type="submit" disabled={previewPending || applyPending}>{previewPending ? "Validating roster…" : "Preview verified-count CSV"}</button>
    </form>
    {preview.status !== "idle" && <div className={`admin-feedback ${preview.status === "preview" ? "success" : "error"}`} role={preview.status === "error" ? "alert" : "status"}>
      <p>{preview.message}</p>
      {preview.issues?.length ? <ul>{preview.issues.map((issue, index) => <li key={`${issue.rowNumber}-${index}`}><strong>Row {issue.rowNumber} · {issue.kind}:</strong> {issue.message}</li>)}</ul> : null}
    </div>}
    {preview.status === "preview" && !appliedForPreview && rows.length > 0 && <>
      <div className="admin-directory-table-wrap"><table className="admin-directory-table"><thead><tr><th scope="col">CSV ROW</th><th scope="col">PARTICIPANT</th><th scope="col">CURRENT VERIFIED</th><th scope="col">NEW VERIFIED</th><th scope="col">REVIEW NOTE</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.rowNumber}-${row.participantId}`}><td>{row.rowNumber}</td><td><strong>{row.displayName}</strong><small>{row.participantId}</small></td><td>{row.verifiedBadgeCount}{row.lastVerifiedAt ? ` · reviewed ${new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Calcutta" }).format(new Date(row.lastVerifiedAt))}` : " · unknown"}</td><td>{row.badgeCount}</td><td>{row.reviewNote}</td></tr>)}</tbody></table></div>
      <form action={applyAction} className="admin-form" onSubmit={(event) => {
        if (!window.confirm(`Apply ${rows.length} audited verified badge-count updates? This will create or idempotently reuse the review audit records.`)) event.preventDefault();
        else setAppliedForPreview(true);
      }}>
        <input type="hidden" name="previewRows" value={JSON.stringify(rows)} />
        <input type="hidden" name="previewIssues" value={JSON.stringify(preview.issues ?? [])} />
        <label className="admin-confirm"><input type="checkbox" name="confirmVerifiedBadgeImport" value="confirmed" required disabled={applyPending} />I reviewed every eligible count and note and confirm this audited bulk verification.</label>
        <button type="submit" disabled={applyPending}>{applyPending ? "Applying verification…" : `Apply ${rows.length} reviewed count${rows.length === 1 ? "" : "s"}`}</button>
      </form>
      <p className="admin-help">The database rechecks the reviewed state, locks participants in a stable order, and applies the whole eligible batch in one transaction. If any item becomes stale, that transaction makes no changes.</p>
    </>}
    {appliedForPreview && applied.status !== "idle" && <div className={`admin-feedback ${applied.status}`} role={applied.status === "error" ? "alert" : "status"}>
      <p>{applied.message}</p>
      {applied.issues?.length ? <ul>{applied.issues.map((issue, index) => <li key={`${issue.rowNumber}-${index}`}><strong>Row {issue.rowNumber} · {issue.kind}:</strong> {issue.message}</li>)}</ul> : null}
      {applied.results && <div className="admin-import-report-links">
        <button type="button" onClick={() => downloadCsv("verified-badge-success.csv", [["row_number", "participant_id", "verified_badge_count", "status", "reason"], ...reportRows(applied.results ?? [], "success")])}>Download success report</button>
        <button type="button" onClick={() => downloadCsv("verified-badge-skipped.csv", [["row_number", "participant_id", "verified_badge_count", "status", "reason"], ...skippedRows])}>Download skipped report</button>
        <button type="button" onClick={() => downloadCsv("verified-badge-failed.csv", [["row_number", "participant_id", "verified_badge_count", "status", "reason"], ...reportRows(applied.results ?? [], "failed")])}>Download failed report</button>
      </div>}
    </div>}
  </article>;
}

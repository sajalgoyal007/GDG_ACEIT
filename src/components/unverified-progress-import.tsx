"use client";

import { useActionState, useEffect, useState } from "react";
import { ArrowDownToLine, FileUp } from "lucide-react";
import { applyUnverifiedProgressAction, previewUnverifiedProgressAction } from "@/app/admin/actions";
import { initialUnverifiedProgressPreviewState } from "@/app/admin/progress-import-state";

function Feedback({ state }: { state: typeof initialUnverifiedProgressPreviewState }) {
  if (state.status === "idle") return null;
  return <div className={`admin-feedback ${state.status === "preview" || state.status === "success" ? "success" : "error"}`} role={state.status === "error" ? "alert" : "status"}>
    <p>{state.message}</p>
    {state.issues && state.issues.length > 0 && <ul>{state.issues.map((issue, index) => <li key={`${issue.rowNumber}-${index}`}><strong>Row {issue.rowNumber} · {issue.kind}:</strong> {issue.message}</li>)}</ul>}
  </div>;
}

export function UnverifiedProgressImport() {
  const [preview, previewAction, previewPending] = useActionState(previewUnverifiedProgressAction, initialUnverifiedProgressPreviewState);
  const [applied, applyAction, applyPending] = useActionState(applyUnverifiedProgressAction, initialUnverifiedProgressPreviewState);
  const [appliedForPreview, setAppliedForPreview] = useState(false);
  useEffect(() => {
    if (applied.status === "success") setAppliedForPreview(true);
    if (applied.status === "error") setAppliedForPreview(false);
  }, [applied.status]);
  const rows = preview.rows ?? [];
  return <article className="admin-panel admin-import-panel">
    <div className="admin-panel-heading"><span className="admin-panel-icon"><FileUp size={16} aria-hidden="true" /></span><div><p className="admin-panel-eyebrow">UNVERIFIED PROGRESS</p><h3>Import organizer progress CSV</h3></div></div>
    <div className="admin-import-guidance"><strong>Required columns</strong><code>participant_key, profile_url, badge_count</code><p>Use current registered identities only. Counts are labeled unverified and remain separate from evidence-reviewed badge records and automatic ranks.</p><a href="/unverified-progress-template.csv" download>Download CSV template <ArrowDownToLine size={13} aria-hidden="true" /></a></div>
    <form action={previewAction} className="admin-form" onSubmit={() => setAppliedForPreview(false)}>
      <label htmlFor="unverified-progress-csv">Select organizer progress CSV</label>
      <input id="unverified-progress-csv" type="file" name="progressCsv" accept=".csv,text/csv" required disabled={previewPending || applyPending} />
      <button type="submit" disabled={previewPending || applyPending}>{previewPending ? "Validating…" : "Preview progress CSV"}</button>
    </form>
    <Feedback state={preview} />
    {preview.status === "preview" && !appliedForPreview && rows.length > 0 && <>
      <div className="admin-directory-table-wrap"><table className="admin-directory-table"><thead><tr><th scope="col">CSV ROW</th><th scope="col">PARTICIPANT</th><th scope="col">UNVERIFIED COUNT</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.rowNumber}-${row.participantId}`}><td>{row.rowNumber}</td><td><strong>{row.displayName}</strong></td><td>{row.badgeCount}</td></tr>)}</tbody></table></div>
      <form action={applyAction} className="admin-form">
        <input type="hidden" name="previewRows" value={JSON.stringify(rows)} />
        <label className="admin-confirm"><input type="checkbox" name="confirmProgressImport" value="confirmed" required disabled={applyPending} />I reviewed this preview and confirm these counts are unverified organizer-reported progress.</label>
        <button type="submit" disabled={applyPending}>{applyPending ? "Importing…" : `Import ${rows.length} valid row${rows.length === 1 ? "" : "s"}`}</button>
      </form>
      <p className="admin-help">Rechecks every participant before importing. If any record changed after preview, no rows are imported.</p>
    </>}
    <Feedback state={applied} />
  </article>;
}

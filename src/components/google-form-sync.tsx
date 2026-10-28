"use client";

import { useActionState } from "react";
import { FileSpreadsheet, RefreshCw, ShieldCheck } from "lucide-react";
import { googleFormSyncAction } from "@/app/admin/google-form-sync-actions";
import { initialGoogleFormSyncState } from "@/app/admin/google-form-sync-state";

export function GoogleFormSync() {
  const [state, action, pending] = useActionState(googleFormSyncAction, initialGoogleFormSyncState);
  const preview = state.status === "preview" ? state.preview : undefined;

  return <section className="admin-card google-sync-card">
    <div className="admin-card-heading"><span><FileSpreadsheet size={17} /></span><div><h2>Sync Google Form responses</h2><p>Read-only Sheets API access · review before applying</p></div></div>
    <p className="admin-help google-sync-intro">Reads only the configured response tab. Email is used transiently to create a keyed matching identifier; email, phone, and roll numbers are not stored or shown here.</p>
    <form action={action} className="admin-form"><input type="hidden" name="intent" value="preview" /><button type="submit" disabled={pending}>{pending ? "Reading private response sheet…" : "Preview Google Form sync"}</button></form>
    {(state.status === "error" || state.status === "success") && <div className={`admin-feedback ${state.status}`} role={state.status === "error" ? "alert" : "status"}><p>{state.message}</p></div>}
    {preview && <div className="google-sync-preview">
      <p className="google-sync-preview-note" role="status"><ShieldCheck size={14} />{state.message}</p>
      <dl className="google-sync-counts">
        <div><dt>New</dt><dd>{preview.counts.new}</dd></div>
        <div><dt>Updated</dt><dd>{preview.counts.updated}</dd></div>
        <div><dt>Duplicate</dt><dd>{preview.counts.duplicate}</dd></div>
        <div><dt>Invalid</dt><dd>{preview.counts.invalid}</dd></div>
      </dl>
      {preview.records.length > 0 && <div className="google-sync-records"><strong>Response preview</strong><ul>{preview.records.map((record) => <li key={`${record.rowNumber}-${record.result}`}><span>Row {record.rowNumber} · {record.displayName}</span><strong className={`sync-result sync-${record.result}`}>{record.result}</strong><small>{record.detail}</small></li>)}</ul></div>}
      {preview.issues.length > 0 && <div className="google-sync-issues" role="note"><strong>Rows for review</strong><ul>{preview.issues.map((issue, index) => <li key={`${issue.rowNumber}-${index}`}>Row {issue.rowNumber} · {issue.kind}: {issue.message}</li>)}</ul></div>}
      {preview.counts.new + preview.counts.updated > 0 && <form action={action} className="admin-form google-sync-confirm" onSubmit={(event) => {
        if (!window.confirm("Apply the reviewed Google Form changes? Existing verified badge counts will be preserved.")) event.preventDefault();
      }}>
        <input type="hidden" name="intent" value="apply" />
        <input type="hidden" name="previewToken" value={preview.token} />
        <label className="admin-confirm"><input type="checkbox" name="confirmSync" value="confirmed" required /> I reviewed this preview and confirm these changes.</label>
        <button type="submit" disabled={pending}>{pending ? "Applying approved changes…" : "Confirm and sync participants"}</button>
      </form>}
      {preview.counts.new + preview.counts.updated === 0 && <p className="admin-empty">No new or changed records are ready to apply.</p>}
    </div>}
    <p className="admin-help"><RefreshCw size={12} className="google-sync-inline-icon" />Manual sync only. Scheduled sync is not configured. No badge counts are inferred from profile URLs.</p>
  </section>;
}

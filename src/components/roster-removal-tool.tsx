"use client";

import { useActionState } from "react";
import { AlertTriangle, FileUp, ShieldAlert, UserX } from "lucide-react";
import { applyRosterRemovalAction, previewRosterRemovalAction } from "@/app/admin/actions";
import {
  initialRosterRemovalApplyState,
  initialRosterRemovalPreviewState,
  type RosterRemovalPreviewState,
} from "@/app/admin/roster-removal-state";

function RemovalFeedback({ state }: { state: RosterRemovalPreviewState }) {
  if (state.status === "idle") return null;
  return (
    <div className={`admin-feedback ${state.status}`} role={state.status === "error" ? "alert" : "status"}>
      <p>{state.message}</p>
      {state.issues && state.issues.length > 0 && (
        <ul>
          {state.issues.map((issue, index) => (
            <li key={`${issue.rowNumber}-${index}`}>
              <strong>Row {issue.rowNumber} · {issue.kind}:</strong> {issue.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function RosterRemovalTool() {
  const [previewState, previewAction, previewPending] = useActionState(
    previewRosterRemovalAction,
    initialRosterRemovalPreviewState,
  );
  const [applyState, applyAction, applyPending] = useActionState(
    applyRosterRemovalAction,
    initialRosterRemovalApplyState,
  );

  return (
    <article className="admin-panel admin-import-panel" id="roster-removal">
      <div className="admin-panel-heading">
        <span className="admin-panel-icon amber"><ShieldAlert size={16} aria-hidden="true" /></span>
        <div>
          <p className="admin-panel-eyebrow">AUTHORITATIVE ROSTER RECONCILIATION</p>
          <h3>Remove production-only participants</h3>
        </div>
      </div>
      <div className="admin-feedback" role="note" style={{ marginBottom: "1rem", borderColor: "var(--color-amber, #d97706)", background: "color-mix(in srgb, var(--color-amber, #d97706) 8%, transparent)" }}>
        <p><strong>Only the public Google Skills Profile URL is read.</strong> Email, access codes, and every other CSV column are discarded and never stored.</p>
        <p style={{ marginTop: ".35rem", fontSize: ".85em" }}>Removal is terminal and reversible only through a database administrator. Participant rows, badge history, and audit events are preserved; removed records stop appearing publicly and cannot re-enter through roster or form sync.</p>
      </div>

      <form action={previewAction} className="admin-form">
        <label htmlFor="authoritative-roster-csv">Select the authoritative registration CSV</label>
        <input
          id="authoritative-roster-csv"
          type="file"
          name="authoritativeRosterCsv"
          accept=".csv,text/csv"
          required
          disabled={previewPending}
        />
        <button type="submit" disabled={previewPending}>
          {previewPending ? "Comparing roster…" : "Preview production-only records"}
        </button>
      </form>
      <p className="admin-help">Preview compares normalized public profile URLs. Nothing is removed until the preview is confirmed below.</p>
      <RemovalFeedback state={previewState} />

      {previewState.status === "preview" && previewState.rows && previewState.rows.length > 0 && applyState.status !== "success" && (
        <div className="admin-removal-preview">
          <div className="admin-removal-summary">
            <span><UserX size={15} aria-hidden="true" />{previewState.rows.length} to remove</span>
            <span>{previewState.matchedCount ?? 0} matched</span>
            <span>{previewState.authoritativeCount ?? 0} authoritative URLs</span>
          </div>
          {(previewState.missingAuthoritativeCount ?? 0) > 0 && (
            <p className="admin-help"><AlertTriangle size={14} aria-hidden="true" /> {previewState.missingAuthoritativeCount} authoritative URL{previewState.missingAuthoritativeCount === 1 ? " is" : "s are"} not registered yet. This is informational only; those records were not removed.</p>
          )}
          <div className="admin-directory-table-wrap">
            <table className="admin-directory-table">
              <thead>
                <tr>
                  <th scope="col">PARTICIPANT</th>
                  <th scope="col">STATUS</th>
                  <th scope="col">BADGES</th>
                </tr>
              </thead>
              <tbody>
                {previewState.rows.map((row) => (
                  <tr key={row.id}>
                    <td><strong>{row.displayName}</strong></td>
                    <td><span className={`admin-registration-pill ${row.registrationStatus}`}>{row.registrationStatus}</span></td>
                    <td>{row.lastVerifiedAt ? row.verifiedBadgeCount.toLocaleString("en-IN") : "Not reviewed"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form action={applyAction} className="admin-form" onSubmit={(event) => {
            if (!window.confirm(`Soft-remove ${previewState.rows?.length ?? 0} participant${(previewState.rows?.length ?? 0) === 1 ? "" : "s"} from the public roster? Badge and audit history will be preserved.`)) event.preventDefault();
          }}>
            <input type="hidden" name="previewRows" value={JSON.stringify(previewState.rows)} />
            <input type="hidden" name="authoritativeUrls" value={JSON.stringify(previewState.authoritativeUrls ?? [])} />
            <label htmlFor="removal-reason">Removal reason</label>
            <textarea
              id="removal-reason"
              name="removalReason"
              minLength={8}
              maxLength={1000}
              rows={3}
              required
              disabled={applyPending}
              defaultValue="Participant is absent from the authoritative registration roster; soft-removed during roster reconciliation."
            />
            <label className="admin-confirm">
              <input type="checkbox" name="confirmRosterRemoval" value="confirmed" required disabled={applyPending} />
              I reviewed the preview and confirm these records should leave the public roster.
            </label>
            <button type="submit" disabled={applyPending}>
              <FileUp size={15} aria-hidden="true" />{applyPending ? "Removing participants…" : `Soft-remove ${previewState.rows.length} participant${previewState.rows.length === 1 ? "" : "s"}`}
            </button>
          </form>
          <RemovalFeedback state={applyState} />
        </div>
      )}

      {applyState.status === "success" && <RemovalFeedback state={applyState} />}
    </article>
  );
}

"use client";

import { useActionState, useState } from "react";
import { FileSearch } from "lucide-react";
import { fetchProgressObservationAction, recordProgressObservationAction } from "@/app/admin/actions";
import { initialProgressObservationActionState } from "@/app/admin/observation-state";

type ObservationParticipant = { participantKey: string; displayName: string; profileUrl: string | null; registrationStatus: "registered" | "pending" | "removed" };

export function ProgressObservationForm({ participants, fetchingEnabled }: { participants: ObservationParticipant[]; fetchingEnabled: boolean }) {
  const [state, action, pending] = useActionState(recordProgressObservationAction, initialProgressObservationActionState);
  const [fetchState, fetchAction, fetchPending] = useActionState(fetchProgressObservationAction, initialProgressObservationActionState);
  const [sourceName, setSourceName] = useState("arcadecalc_frontend");
  const eligible = participants.filter((participant) => participant.registrationStatus === "registered" && participant.profileUrl);

  return <article className="admin-panel admin-import-panel">
    <div className="admin-panel-heading"><span className="admin-panel-icon"><FileSearch size={16} aria-hidden="true" /></span><div><p className="admin-panel-eyebrow">SOURCE OBSERVATION · UNVERIFIED</p><h3>Record one profile diagnostic</h3></div></div>
    <div className="admin-import-guidance"><strong>One-profile admin check</strong><p>Positive badge-card candidates are recorded only as unverified observations. A verified zero is recorded only under the separately confirmed owner policy, after the explicit admin confirmation below, through the existing audited verification RPC.</p></div>
    <form action={fetchAction} className="admin-form">
      <label htmlFor="fetch-observation-participant">Fetch one registered profile</label>
      <select id="fetch-observation-participant" name="participantKey" required defaultValue="" disabled={fetchPending || !fetchingEnabled}>
        <option value="" disabled>Select a registered profile</option>
        {eligible.map((participant) => <option key={participant.participantKey} value={participant.participantKey}>{participant.participantKey} · {participant.displayName}</option>)}
      </select>
      <p className="admin-help">One bounded public GET is made only after an administrator submits this form. The server resolves the current registered URL and requires matching canonical profile identity.</p>
      <p className="admin-help">A response with HTTP 200, exactly matching canonical identity, no badge container, and no recognized incomplete/loading/challenge/access-denied markers records verified zero through the audited admin RPC. Positive badge-card candidates remain unverified.</p>
      <label className="admin-confirm"><input type="checkbox" name="confirmOwnerZeroPolicy" value="confirmed" required disabled={fetchPending || !fetchingEnabled} />I authorize the owner-approved zero rule for this profile check. Any zero is written only through the existing audited verification workflow.</label>
      <button type="submit" disabled={fetchPending || !fetchingEnabled || eligible.length === 0}>{fetchPending ? "Checking profile…" : "Check one profile"}</button>
      {!fetchingEnabled && <p className="admin-help">Public profile fetching is disabled. It requires explicit feature enablement and documented source authorization; no request is made while disabled.</p>}
    </form>
    {fetchState.status !== "idle" && <div className={`admin-feedback ${fetchState.status}`} role={fetchState.status === "error" ? "alert" : "status"}>
      <p>{fetchState.message}</p>
    </div>}
    <hr />
    <p className="admin-help">Or record an observation you already inspected manually:</p>
    <form action={action} className="admin-form">
      <label htmlFor="observation-participant">Registered participant and exact profile</label>
      <select id="observation-participant" name="participantIdentity" required defaultValue="" disabled={pending}>
        <option value="" disabled>Select a registered profile</option>
        {eligible.map((participant) => <option key={participant.participantKey} value={JSON.stringify({ participantKey: participant.participantKey, profileUrl: participant.profileUrl })}>{participant.participantKey} · {participant.displayName} · {participant.profileUrl}</option>)}
      </select>
      <label htmlFor="observation-source">Observed source</label>
      <select id="observation-source" name="sourceName" required disabled={pending} value={sourceName} onChange={(event) => setSourceName(event.target.value)}>
        <option value="arcadecalc_frontend">ArcadeCalc frontend endpoint</option>
        <option value="google_skills_public_html">Google Skills public HTML diagnostic</option>
      </select>
      <label htmlFor="observation-retrieved-at">Source retrieval time</label>
      <input id="observation-retrieved-at" name="retrievedAt" type="datetime-local" required disabled={pending} />
      <label htmlFor="observation-http-status">HTTP status</label>
      <input id="observation-http-status" name="httpStatus" type="number" min="100" max="599" step="1" required disabled={pending} />
      <label htmlFor="observation-status">Completeness / result status</label>
      <select id="observation-status" name="completenessStatus" required disabled={pending} defaultValue="unverified">
        <option value="unverified">Unverified response (completeness unknown)</option>
        <option value="partial">Partial response / discrepancy</option>
        <option value="failed">Failed request or parsing</option>
        <option value="blocked">Blocked or access denied</option>
      </select>
      <label htmlFor="observation-reported-total">{sourceName === "google_skills_public_html" ? "Observed HTML badge-card candidates (not a total)" : "Source-reported total (leave blank for failure)"}</label>
      <input id="observation-reported-total" name="reportedTotal" type="number" min="0" max="10000" step="1" disabled={pending} />
      <label htmlFor="observation-detail-count">Returned badge detail objects</label>
      <input id="observation-detail-count" name="detailCount" type="number" min="0" max="10000" step="1" disabled={pending} />
      <label htmlFor="observation-unique-count">Unique badge IDs established (optional)</label>
      <input id="observation-unique-count" name="uniqueBadgeCount" type="number" min="0" max="10000" step="1" disabled={pending} />
      <label htmlFor="observation-note">Short limitation or error summary</label>
      <textarea id="observation-note" name="summaryNote" maxLength={500} rows={2} disabled={pending} placeholder="Do not include names, credentials, or raw profile content." />
      <label className="admin-confirm"><input type="checkbox" name="confirmObservation" value="confirmed" required disabled={pending} />I checked the selected profile URL and confirm this source result is unverified diagnostic information.</label>
      <button type="submit" disabled={pending}>{pending ? "Recording observation…" : "Record diagnostic observation"}</button>
    </form>
    {state.status !== "idle" && <div className={`admin-feedback ${state.status}`} role={state.status === "error" ? "alert" : "status"}><p>{state.message}</p></div>}
    {eligible.length === 0 && <p className="admin-help">No registered participants with profile URLs are available.</p>}
  </article>;
}

"use client";

import { useActionState, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
} from "lucide-react";
import {
  applyBadgeSyncRunAction,
  rollbackBadgeSyncRunAction,
  updateBadgeCatalogCategoryAction,
} from "@/app/admin/badge-sync-actions";
import { initialBadgeCatalogActionState, initialBadgeSyncActionState } from "@/app/admin/badge-sync-state";
import {
  badgeSyncProgressPercent,
  badgeSyncUnclassifiedBadges,
  badgeSyncViewReducer,
  initialBadgeSyncViewState,
  type BadgeSyncBatchResponse,
} from "@/lib/badges/batch-state";
import type { BadgeSyncSnapshotParticipant } from "@/lib/badges/snapshot";
import { isOfficialSyllabusBadgeKey } from "@/lib/badges/syllabus";

const SYNC_ENDPOINT = "/api/admin/badge-sync/batch";
const MAX_BATCHES = 64;
const PREVIEW_PAGE_SIZE = 15;

type PreviewFilter = "all" | "changes" | "blocked" | "unclassified";

function formatCount(value: number | null | undefined) {
  // NULL means "not verified" or "unchanged". Never render it as zero.
  return value === null || value === undefined ? "—" : value.toLocaleString("en-IN");
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return "Not yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(date) + " IST";
}

async function postBatch(body: Record<string, unknown>): Promise<BadgeSyncBatchResponse> {
  const response = await fetch(SYNC_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null) as BadgeSyncBatchResponse | null;
  if (!payload || typeof payload.status !== "string") {
    return {
      status: "temporarily_unavailable",
      message: "The badge sync service returned an unreadable response. Saved counts are unchanged.",
    };
  }
  return payload;
}

function participantReason(participant: BadgeSyncSnapshotParticipant) {
  const notes = [...(participant.preview_details ?? [])];
  if (participant.blocking_reason) notes.push(participant.blocking_reason);
  if (participant.review_note) notes.push(participant.review_note);
  if (notes.length === 0) {
    if (participant.observation_status === "incomplete") notes.push("Evidence incomplete — previous counts preserved.");
    if (participant.observation_status === "failed") notes.push("Evidence failed — previous counts preserved.");
  }
  return notes.length === 0 ? "—" : notes.join(" · ");
}

function phaseTone(phase: string) {
  if (phase === "previewed") return "success";
  if (phase === "applied") return "success";
  if (phase === "paused") return "warning";
  if (phase === "error" || phase === "disabled") return "error";
  return "neutral";
}

function matchesPreviewFilter(participant: BadgeSyncSnapshotParticipant, filter: PreviewFilter) {
  if (filter === "changes") return participant.delta !== null && participant.delta !== 0;
  if (filter === "blocked") {
    return Boolean(participant.blocking_reason)
      || participant.is_removed
      || participant.status === "rejected"
      || participant.observation_status !== "complete";
  }
  if (filter === "unclassified") {
    return participant.status === "unclassified" || participant.unclassified_badge_count > 0;
  }
  return true;
}

function DeltaBadge({ value }: { value: number | null }) {
  if (value === null || Number.isNaN(value)) return <span className="badge-sync-delta neutral">—</span>;
  const tone = value > 0 ? "up" : value < 0 ? "down" : "neutral";
  return <span className={`badge-sync-delta ${tone}`}>{value > 0 ? `+${value.toLocaleString("en-IN")}` : value.toLocaleString("en-IN")}</span>;
}

function PreviewKpi({ label, value, delta, note }: { label: string; value: string; delta: number | null; note?: string }) {
  return (
    <div className="badge-sync-kpi">
      <span className="badge-sync-kpi-label">{label}</span>
      <div className="badge-sync-kpi-value">
        <strong>{value}</strong>
        <DeltaBadge value={delta} />
      </div>
      {note && <small>{note}</small>}
    </div>
  );
}

export function BadgeSyncSyncAll({
  fetchingEnabled,
  unavailableMessage,
}: {
  fetchingEnabled: boolean;
  unavailableMessage: string | null;
}) {
  const [state, dispatch] = useReducer(badgeSyncViewReducer, initialBadgeSyncViewState);
  const [applyState, applyAction, applyPending] = useActionState(
    applyBadgeSyncRunAction,
    initialBadgeSyncActionState,
  );
  const [rollbackState, rollbackAction, rollbackPending] = useActionState(
    rollbackBadgeSyncRunAction,
    initialBadgeSyncActionState,
  );
  const [catalogState, catalogAction, catalogPending] = useActionState(
    updateBadgeCatalogCategoryAction,
    initialBadgeCatalogActionState,
  );
  const [repreviewPending, setRepreviewPending] = useState(false);
  const [previewQuery, setPreviewQuery] = useState("");
  const [previewFilter, setPreviewFilter] = useState<PreviewFilter>("all");
  const [previewPage, setPreviewPage] = useState(0);

  const runningRef = useRef(false);
  const pauseRequestedRef = useRef(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      pauseRequestedRef.current = true;
    };
  }, []);

  useEffect(() => {
    const snapshot = rollbackState.snapshot ?? applyState.snapshot;
    if (!snapshot) return;
    dispatch({
      type: "snapshot",
      snapshot,
      message: rollbackState.snapshot ? rollbackState.message : applyState.message,
    });
  }, [applyState, rollbackState]);

  useEffect(() => {
    setPreviewPage(0);
  }, [previewQuery, previewFilter]);

  async function waitForIdle() {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (!runningRef.current) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  async function runBatches(initial: "start" | "continue", runId: string | null) {
    if (runningRef.current) return;
    runningRef.current = true;
    let currentRunId = runId;
    let action: "start" | "continue" = initial;
    try {
      for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
        if (cancelledRef.current) return;
        const response = await postBatch(action === "start" ? { action } : { action, runId: currentRunId });
        if (response.runId) currentRunId = response.runId;
        if (cancelledRef.current) return;
        if (pauseRequestedRef.current && response.status === "running") break;
        dispatch({ type: "response", response });
        if (response.status !== "running") break;
        action = "continue";
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    } catch {
      if (!cancelledRef.current) {
        dispatch({
          type: "failure",
          message: "The badge sync request could not reach the server. Queued participants and saved counts are unchanged.",
        });
      }
    } finally {
      runningRef.current = false;
    }
  }

  function startSync() {
    if (!fetchingEnabled || runningRef.current) return;
    pauseRequestedRef.current = false;
    dispatch({ type: "start" });
    void runBatches("start", null);
  }

  async function pauseSync() {
    const runId = state.runId;
    if (!runId) return;
    pauseRequestedRef.current = true;
    dispatch({ type: "pause_requested" });
    try {
      const response = await postBatch({ action: "pause", runId });
      dispatch({ type: "response", response });
    } catch {
      if (!cancelledRef.current) {
        dispatch({ type: "failure", message: "The pause request could not reach the server. The run may still be active." });
      }
    }
  }

  async function resumeSync() {
    const runId = state.runId;
    if (!runId || !fetchingEnabled) return;
    pauseRequestedRef.current = false;
    dispatch({ type: "resume_requested" });
    await waitForIdle();
    try {
      const response = await postBatch({ action: "resume", runId });
      dispatch({ type: "response", response });
      if (response.status === "running") void runBatches("continue", runId);
    } catch {
      if (!cancelledRef.current) {
        dispatch({ type: "failure", message: "The resume request could not reach the server. The run stays paused." });
      }
    }
  }

  async function repreview() {
    const runId = state.runId;
    if (!runId || repreviewPending) return;
    setRepreviewPending(true);
    try {
      const response = await postBatch({ action: "repreview", runId });
      dispatch({ type: "response", response });
    } catch {
      dispatch({ type: "failure", message: "The preview could not be refreshed. Classifications are saved." });
    } finally {
      setRepreviewPending(false);
    }
  }

  const snapshot = state.snapshot;
  const run = snapshot?.run ?? null;
  const progress = state.progress;
  const percent = badgeSyncProgressPercent(progress);
  const unclassified = badgeSyncUnclassifiedBadges(snapshot);
  const fingerprint = run?.preview_fingerprint ?? null;
  const canPreview = run ? run.status === "previewed" || run.status === "approved" : false;
  const canApply = canPreview && Boolean(fingerprint);
  const canRollback = run?.status === "applied";
  const busy = state.phase === "starting" || state.phase === "running" || repreviewPending;
  const participantRows = useMemo(() => snapshot?.participants ?? [], [snapshot]);

  const approvedParticipants = participantRows.filter((participant) => participant.status === "approved").length;
  const changesCount = participantRows.filter((participant) => participant.delta !== null && participant.delta !== 0).length;
  const blockedCount = participantRows.filter((participant) => matchesPreviewFilter(participant, "blocked")).length;
  const unclassifiedCount = participantRows.filter((participant) => matchesPreviewFilter(participant, "unclassified")).length;

  const deltas = useMemo(() => {
    let skill = 0;
    let arcade = 0;
    let total = 0;
    for (const participant of participantRows) {
      if (participant.status !== "approved") continue;
      if (participant.skill_count !== null && participant.previous_skill_count !== null) {
        skill += participant.skill_count - participant.previous_skill_count;
      }
      if (participant.arcade_count !== null && participant.previous_arcade_count !== null) {
        arcade += participant.arcade_count - participant.previous_arcade_count;
      }
      if (participant.delta !== null) total += participant.delta;
    }
    return { skill, arcade, total };
  }, [participantRows]);

  const filteredPreview = useMemo(() => {
    const needle = previewQuery.trim().toLocaleLowerCase();
    return participantRows.filter((participant) => {
      if (!matchesPreviewFilter(participant, previewFilter)) return false;
      if (!needle) return true;
      return participant.display_name.toLocaleLowerCase().includes(needle)
        || participant.participant_key.toLocaleLowerCase().includes(needle);
    });
  }, [participantRows, previewFilter, previewQuery]);

  const previewPageCount = Math.max(1, Math.ceil(filteredPreview.length / PREVIEW_PAGE_SIZE));
  const safePreviewPage = Math.min(previewPage, previewPageCount - 1);
  const visiblePreview = filteredPreview.slice(
    safePreviewPage * PREVIEW_PAGE_SIZE,
    (safePreviewPage + 1) * PREVIEW_PAGE_SIZE,
  );
  const previewRangeStart = filteredPreview.length === 0 ? 0 : safePreviewPage * PREVIEW_PAGE_SIZE + 1;
  const previewRangeEnd = Math.min(filteredPreview.length, (safePreviewPage + 1) * PREVIEW_PAGE_SIZE);
  const lastSyncAt = run?.applied_at ?? run?.previewed_at ?? run?.created_at ?? null;

  const previewFilters: { id: PreviewFilter; label: string; count: number }[] = [
    { id: "all", label: "All", count: participantRows.length },
    { id: "changes", label: "Changes (+)", count: changesCount },
    { id: "blocked", label: "Blocked", count: blockedCount },
    { id: "unclassified", label: "Unclassified", count: unclassifiedCount },
  ];

  return (
    <article className="admin-panel badge-sync-panel" id="badge-sync-panel">
      <div className="badge-sync-panel-head">
        <div className="admin-panel-heading">
          <span className="admin-panel-icon blue">
            <RefreshCw size={16} aria-hidden="true" />
          </span>
          <div>
            <p className="admin-panel-eyebrow">ONE-CLICK PROFILE EVIDENCE</p>
            <h3>Sync all badges</h3>
          </div>
        </div>
        {run && <span className={`badge-sync-run-chip ${run.status}`}>{run.status.replaceAll("_", " ")}</span>}
      </div>

      {!fetchingEnabled && (
        <div className="admin-feedback error" role="alert">
          <p><AlertTriangle size={14} aria-hidden="true" /> Badge sync fetching is disabled.</p>
          <small>
            {unavailableMessage ??
              "It requires AUTO_PROGRESS_ENABLED=true and GOOGLE_SKILLS_PROFILE_FETCH_AUTHORIZED=true after written source authorization. No profile requests are made while disabled."}
          </small>
        </div>
      )}

      <div className="badge-sync-hero">
        <section className="badge-sync-command" aria-label="Sync command center">
          <p className="admin-panel-eyebrow">COMMAND CENTER</p>

          <div className="badge-sync-controls">
            <button
              type="button"
              className="button-primary"
              onClick={startSync}
              disabled={!fetchingEnabled || busy}
              aria-busy={busy}
            >
              {state.phase === "starting" ? (
                <><LoaderCircle size={16} className="auth-spinner" aria-hidden="true" />Starting sync…</>
              ) : state.phase === "running" ? (
                <><LoaderCircle size={16} className="auth-spinner" aria-hidden="true" />Syncing profiles…</>
              ) : (
                <><RefreshCw size={15} aria-hidden="true" />Sync All Badges</>
              )}
            </button>

            {(state.phase === "running" || state.phase === "starting") && (
              <button
                type="button"
                className="badge-sync-secondary"
                onClick={() => void pauseSync()}
                disabled={!state.runId}
              >
                <Pause size={14} aria-hidden="true" />Pause
              </button>
            )}

            {state.phase === "paused" && (
              <button type="button" className="badge-sync-secondary" onClick={() => void resumeSync()} disabled={!fetchingEnabled}>
                <Play size={14} aria-hidden="true" />Resume
              </button>
            )}

            {canPreview && (
              <button type="button" className="badge-sync-secondary" onClick={() => void repreview()} disabled={repreviewPending}>
                {repreviewPending ? <><LoaderCircle size={14} className="auth-spinner" aria-hidden="true" />Re-previewing…</> : <><RefreshCw size={14} aria-hidden="true" />Re-preview</>}
              </button>
            )}
          </div>

          <div className={`badge-sync-status ${phaseTone(state.phase)}`} role="status">
            <span className="badge-sync-status-dot" aria-hidden="true" />
            <span>{state.message || "Ready. No profile has been read yet."}</span>
          </div>

          {state.halted && (
            <div className="admin-feedback error" role="alert">
              <p><AlertTriangle size={14} aria-hidden="true" /> Fetching paused automatically ({state.halted === "rate_limited" ? "HTTP 429" : "HTTP 403"}).</p>
              <small>Unattempted participants stay queued as pending. Resume only after the rate limit or access restriction clears.</small>
            </div>
          )}

          {progress ? (
            <div className="badge-sync-progress">
              <div className="badge-sync-progress-head">
                <strong>{percent}%</strong>
                <span>{progress.processed.toLocaleString("en-IN")} of {progress.total.toLocaleString("en-IN")} participants processed</span>
                {progress.paused && <span className="badge-sync-pause-chip">Paused</span>}
              </div>
              <div
                className="badge-sync-progress-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                aria-label="Badge sync progress"
              >
                <span style={{ width: `${percent}%` }} />
              </div>
              <ul className="badge-sync-stats">
                <li><strong>{progress.stagedCount.toLocaleString("en-IN")}</strong><span>staged</span></li>
                <li><strong>{progress.failedCount.toLocaleString("en-IN")}</strong><span>failed observations</span></li>
                <li><strong>{progress.skippedCount.toLocaleString("en-IN")}</strong><span>skipped</span></li>
                <li><strong>{progress.remaining.toLocaleString("en-IN")}</strong><span>remaining</span></li>
              </ul>
            </div>
          ) : (
            <p className="badge-sync-command-note">
              Reads every active public Google Skills profile in paced batches. Only trustworthy observations are staged; incomplete or failed profiles keep their previous verified counts.
            </p>
          )}
        </section>

        <aside className="badge-sync-run" aria-label="Run status and preview summary">
          <dl className="badge-sync-run-meta">
            <div><dt>Run status</dt><dd>{run ? run.status.replaceAll("_", " ") : "Not started"}</dd></div>
            <div><dt>Last sync</dt><dd>{formatTimestamp(lastSyncAt)}</dd></div>
            <div><dt>Participants</dt><dd>{run ? run.total_participants.toLocaleString("en-IN") : "—"}</dd></div>
          </dl>

          {snapshot && run ? (
            <>
              <div className="admin-feedback success" role="note">
                <p><BadgeCheck size={14} aria-hidden="true" /> Official 10-Badge Campaign Syllabus enforced.</p>
                <small>
                  Only the ten exact syllabus courses count as Skill Badges. Every other course is logged as
                  {" "}Non-syllabus course (ignored) in the participant note. Arcade is unchanged. A false Frozen Rank
                  {" "}is cleared only when this preview is explicitly applied with a verified Skill count below 10.
                </small>
              </div>

              <div className="badge-sync-preview-summary">
                <p className="admin-panel-eyebrow">PREVIEW DELTA SUMMARY</p>
                <div className="badge-sync-kpis">
                  <PreviewKpi label="Skill Badges" value={run.total_skill.toLocaleString("en-IN")} delta={deltas.skill} />
                  <PreviewKpi label="Arcade Badges" value={run.total_arcade.toLocaleString("en-IN")} delta={deltas.arcade} />
                  <PreviewKpi label="Total Verified" value={run.total_badges.toLocaleString("en-IN")} delta={deltas.total} />
                  <PreviewKpi
                    label="Eligible / Blocked"
                    value={`${approvedParticipants.toLocaleString("en-IN")} / ${run.blocked_participant_count.toLocaleString("en-IN")}`}
                    delta={null}
                    note={`${run.unclassified_participant_count.toLocaleString("en-IN")} unclassified · ${run.pending_participant_count.toLocaleString("en-IN")} pending`}
                  />
                </div>
              </div>

              {run.unclassified_participant_count > 0 && (
                <div className="admin-feedback error" role="note">
                  <p><AlertTriangle size={14} aria-hidden="true" /> {run.unclassified_participant_count} participant{run.unclassified_participant_count === 1 ? "" : "s"} have unclassified badge identities.</p>
                  <small>Those participants stay unchanged until each identity is classified below. Re-preview after classifying.</small>
                </div>
              )}

              {canApply && (
                <form
                  action={applyAction}
                  className="admin-form badge-sync-apply badge-sync-apply-bar"
                  onSubmit={(event) => {
                    if (!window.confirm(`Apply the previewed badge counts for ${approvedParticipants} approved participant${approvedParticipants === 1 ? "" : "s"}? The server revalidates the stored fingerprint before writing. A false Frozen Rank is cleared only by this apply when the verified Skill count is below 10.`)) {
                      event.preventDefault();
                    }
                  }}
                >
                  <input type="hidden" name="runId" value={run.id} />
                  <input type="hidden" name="previewFingerprint" value={fingerprint ?? ""} />
                  <label className="admin-confirm">
                    <input type="checkbox" name="confirmBadgeSyncApply" value="confirmed" required disabled={applyPending} />
                    I reviewed the preview, including every blocked and unclassified participant, and confirm this audited update.
                  </label>
                  <button type="submit" disabled={applyPending || !fingerprint}>
                    {applyPending ? <><LoaderCircle size={15} className="auth-spinner" aria-hidden="true" />Applying…</> : <><ShieldCheck size={15} aria-hidden="true" />Confirm and apply</>}
                  </button>
                </form>
              )}

              {canRollback && (
                <form
                  action={rollbackAction}
                  className="admin-form badge-sync-rollback badge-sync-apply-bar"
                  onSubmit={(event) => {
                    if (!window.confirm("Roll back this applied badge sync run and restore the previous verified counts?")) {
                      event.preventDefault();
                    }
                  }}
                >
                  <input type="hidden" name="runId" value={run.id} />
                  <label className="admin-confirm">
                    <input type="checkbox" name="confirmBadgeSyncRollback" value="confirmed" required disabled={rollbackPending} />
                    I understand this restores the counts that existed immediately before this run was applied.
                  </label>
                  <button type="submit" disabled={rollbackPending}>
                    {rollbackPending ? <><LoaderCircle size={15} className="auth-spinner" aria-hidden="true" />Rolling back…</> : <><RotateCcw size={15} aria-hidden="true" />Roll back this run</>}
                  </button>
                </form>
              )}

              {run.status === "applied" && run.apply_result && (
                <p className="badge-sync-inline-feedback success" role="status">
                  <CheckCircle2 size={14} aria-hidden="true" /> Applied {run.apply_result.applied_count} participant update{run.apply_result.applied_count === 1 ? "" : "s"} at {run.apply_result.applied_at}.
                  {typeof run.apply_result.frozen_ranks_cleared === "number" && ` ${run.apply_result.frozen_ranks_cleared} false Frozen Rank${run.apply_result.frozen_ranks_cleared === 1 ? "" : "s"} cleared.`}
                </p>
              )}

              {run.status === "rolled_back" && (
                <p className="badge-sync-inline-feedback success" role="status">
                  <RotateCcw size={14} aria-hidden="true" /> This run was rolled back; previous verified counts are restored.
                </p>
              )}
            </>
          ) : (
            <div className="badge-sync-preview-empty">
              <span><BadgeCheck size={17} aria-hidden="true" /></span>
              <p>No preview yet</p>
              <small>Run a sync to generate a deterministic preview. Counts are only written after you confirm.</small>
            </div>
          )}
        </aside>
      </div>

      {unclassified.length > 0 && (
        <section className="badge-sync-classifier" aria-labelledby="badge-sync-classifier-title">
          <h5 id="badge-sync-classifier-title">Unclassified identities</h5>
          <p className="admin-help">
            Classification is catalog-wide and audited. Only the ten exact official campaign courses can be Skill;
            every other course template is always ignored. A game can be Arcade or ignored. Nothing is inferred from
            the badge title.
          </p>
          <ul className="badge-sync-classifier-list">
            {unclassified.map((entry) => {
              const options = entry.badgeKey.startsWith("game:")
                ? ["arcade", "ignored"]
                : isOfficialSyllabusBadgeKey(entry.badgeKey)
                  ? ["skill"]
                  : ["ignored"];
              return (
                <li key={entry.badgeKey}>
                  <div className="badge-sync-classifier-copy">
                    <strong>{entry.badgeTitle}</strong>
                    <code>{entry.badgeKey}</code>
                    <small>{entry.participants} participant{entry.participants === 1 ? "" : "s"}</small>
                  </div>
                  <form action={catalogAction} className="badge-sync-classifier-form">
                    <input type="hidden" name="badgeKey" value={entry.badgeKey} />
                    <input type="hidden" name="displayName" value={entry.badgeTitle} />
                    <label>
                      <span className="sr-only">Category for {entry.badgeKey}</span>
                      <select name="category" defaultValue={options[0]} disabled={catalogPending}>
                        {options.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </label>
                    <label>
                      <span className="sr-only">Reason for classifying {entry.badgeKey}</span>
                      <input name="reason" required minLength={1} maxLength={1000} placeholder="Reason for classification" disabled={catalogPending} />
                    </label>
                    <button type="submit" disabled={catalogPending}>
                      {catalogPending ? "Saving…" : "Classify"}
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
          {catalogState.status !== "idle" && (
            <p className={`badge-sync-inline-feedback ${catalogState.status}`} role={catalogState.status === "error" ? "alert" : "status"}>
              {catalogState.message}
            </p>
          )}
        </section>
      )}

      {snapshot && run && (
        <section className="badge-sync-preview" aria-labelledby="badge-sync-preview-title">
          <div className="badge-sync-preview-head">
            <div>
              <p className="admin-panel-eyebrow">DETERMINISTIC PREVIEW · {run.status.toUpperCase()}</p>
              <h4 id="badge-sync-preview-title">Participant preview</h4>
            </div>
            <span className="admin-section-count">{filteredPreview.length.toLocaleString("en-IN")} of {participantRows.length.toLocaleString("en-IN")} rows</span>
          </div>

          <div className="badge-sync-preview-toolbar">
            <label className="admin-directory-search badge-sync-preview-search">
              <Search size={15} aria-hidden="true" />
              <span className="sr-only">Search participants in this preview</span>
              <input
                value={previewQuery}
                onChange={(event) => setPreviewQuery(event.target.value)}
                placeholder="Search by name or participant ID"
              />
            </label>
            <div className="badge-sync-chips" role="group" aria-label="Participant preview filters">
              {previewFilters.map(({ id, label, count }) => (
                <button
                  key={id}
                  type="button"
                  className="badge-sync-chip"
                  aria-pressed={previewFilter === id}
                  onClick={() => setPreviewFilter(id)}
                >
                  {label} ({count.toLocaleString("en-IN")})
                </button>
              ))}
            </div>
          </div>

          {filteredPreview.length === 0 ? (
            <div className="admin-panel-empty" role="status">
              <span><Search size={17} aria-hidden="true" /></span>
              <p>No preview rows match</p>
              <small>Change the search text or filter to review more participants.</small>
              <button type="button" onClick={() => { setPreviewQuery(""); setPreviewFilter("all"); }}>Clear filters</button>
            </div>
          ) : (
            <>
              <div className="admin-directory-table-wrap badge-sync-preview-table">
                <table className="admin-directory-table">
                  <thead>
                    <tr>
                      <th scope="col">PARTICIPANT</th>
                      <th scope="col">EVIDENCE</th>
                      <th scope="col">SKILL</th>
                      <th scope="col">ARCADE</th>
                      <th scope="col">TOTAL</th>
                      <th scope="col">DELTA</th>
                      <th scope="col">STATUS</th>
                      <th scope="col">NOTE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiblePreview.map((participant) => (
                      <tr key={participant.id}>
                        <td>
                          <strong>{participant.display_name}</strong>
                          <small>{participant.registration_status}</small>
                        </td>
                        <td>{participant.observation_status}</td>
                        <td className="admin-badge-count">{formatCount(participant.skill_count)}</td>
                        <td className="admin-badge-count">{formatCount(participant.arcade_count)}</td>
                        <td className="admin-badge-count"><strong>{formatCount(participant.total_count)}</strong></td>
                        <td><DeltaBadge value={participant.delta} /></td>
                        <td>{participant.status}</td>
                        <td className="badge-sync-preview-note">{participantReason(participant)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <ul className="badge-sync-preview-mobile" aria-label="Participant preview rows">
                {visiblePreview.map((participant) => (
                  <li key={participant.id}>
                    <div className="badge-sync-preview-mobile-head">
                      <strong>{participant.display_name}</strong>
                      <span className={`admin-registration-pill ${participant.registration_status}`}>{participant.status}</span>
                    </div>
                    <p>
                      {formatCount(participant.skill_count)} Skill · {formatCount(participant.arcade_count)} Arcade ·{" "}
                      <strong>{formatCount(participant.total_count)}</strong> total <DeltaBadge value={participant.delta} />
                    </p>
                    <small>{participantReason(participant)}</small>
                  </li>
                ))}
              </ul>

              <div className="admin-pagination" role="navigation" aria-label="Participant preview pages">
                <span>{filteredPreview.length === 0 ? "No rows" : `Showing ${previewRangeStart}–${previewRangeEnd} of ${filteredPreview.length}`}</span>
                <div className="admin-pagination-controls">
                  <button type="button" onClick={() => setPreviewPage((current) => Math.max(0, current - 1))} disabled={safePreviewPage <= 0}>Previous</button>
                  <span>Page {safePreviewPage + 1} / {previewPageCount}</span>
                  <button type="button" onClick={() => setPreviewPage((current) => Math.min(previewPageCount - 1, current + 1))} disabled={safePreviewPage >= previewPageCount - 1}>Next</button>
                </div>
              </div>
            </>
          )}
        </section>
      )}

      {applyState.status !== "idle" && applyState.snapshot?.run.id === state.runId && !rollbackState.snapshot && (
        <div className={`admin-feedback ${applyState.status}`} role={applyState.status === "error" ? "alert" : "status"}>
          <p>{applyState.message}</p>
        </div>
      )}

      {rollbackState.status !== "idle" && rollbackState.snapshot?.run.id === state.runId && (
        <div className={`admin-feedback ${rollbackState.status}`} role={rollbackState.status === "error" ? "alert" : "status"}>
          <p>{rollbackState.message}</p>
        </div>
      )}

      <p className="admin-help badge-sync-footnote">
        <BadgeCheck size={13} aria-hidden="true" /> Apply and rollback run through the existing audited count writers.
      </p>
    </article>
  );
}

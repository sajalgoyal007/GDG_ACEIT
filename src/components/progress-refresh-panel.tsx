"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import type { AutoProgressRow } from "@/lib/auto-progress/leaderboard";

type IdentityState = "linked" | "signed_out" | "unverified_email" | "not_linked" | "unconfigured" | "check_failed";
type RefreshReply = { status?: string; message?: string };

function timestamp(value: string | null) {
  if (!value) return "No successful refresh yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Last successful time unavailable" : date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) + " IST";
}

export function ProgressRefreshPanel({ identityState, progress, loadFailed = false, refreshAvailable }: {
  identityState: IdentityState;
  progress: AutoProgressRow | null;
  loadFailed?: boolean;
  refreshAvailable: boolean;
}) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const linked = identityState === "linked";
  const canRefresh = linked && refreshAvailable;
  const autoCount = progress?.eligibleBadgeCount ?? null;
  const reportedCount = progress?.unverifiedBadgeCount ?? null;
  const visibleCount = autoCount ?? reportedCount;
  const progressLabel = visibleCount === null ? "Unavailable / 10" : `${Math.min(visibleCount, 10)} / 10`;
  const stateLabel = loadFailed ? "Saved progress could not be loaded"
    : autoCount !== null ? progress?.displayState ?? "Saved progress"
      : reportedCount !== null ? "Organizer CSV · unverified"
        : progress?.displayState ?? "No successful snapshot";

  async function refresh() {
    if (inFlight.current || !canRefresh) return;
    inFlight.current = true;
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/auto-progress/refresh", {
        method: "POST",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      const reply = await response.json() as RefreshReply;
      if (!response.ok || reply.status !== "refreshed") {
        setMessage(reply.message ?? "The refresh did not complete. Previously saved progress is unchanged.");
        return;
      }
      setMessage(reply.message ?? "Progress refreshed.");
      router.refresh();
    } catch {
      setMessage("The refresh could not reach the server. Previously saved progress is unchanged.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return <section className="auto-progress-panel" aria-labelledby="auto-progress-heading">
    <div className="auto-progress-copy">
      <p className="eyebrow">AUTOMATIC PROGRESS · SEPARATE FROM VERIFIED BADGES</p>
      <h2 id="auto-progress-heading">Google Skills progress</h2>
      <p>Progress shown here is separate from manually verified badge counts. Organizer CSV values are unverified reports.</p>
    </div>
    <div className="auto-progress-summary">
      <strong aria-label={`Automatic badge progress ${progressLabel}`}>{progressLabel}</strong>
      <span>{stateLabel}</span>
      {autoCount !== null && <small>Last successful automatic refresh: {timestamp(progress?.lastSuccessfulCheckAt ?? null)}</small>}
      {reportedCount !== null && <small>Organizer CSV imported: {timestamp(progress?.unverifiedImportedAt ?? null)} · unverified</small>}
      {progress?.milestoneLabel && <small>{progress.milestoneLabel} (first observed by GDG ACEIT)</small>}
    </div>
    <div className="auto-progress-actions">
      <button type="button" className="button-primary" onClick={refresh} disabled={!canRefresh || pending} aria-busy={pending}>
        {pending ? <><LoaderCircle size={16} className="auth-spinner" aria-hidden="true" />Refreshing…</> : canRefresh ? <><RefreshCw size={15} aria-hidden="true" />Refresh Progress</> : "Refresh unavailable"}
      </button>
      {!linked && identityState === "signed_out" && <Link className="button-quiet" href="/admin/login?next=%2Fprogress">Sign in with your registration email</Link>}
      {!linked && identityState === "not_linked" && <span className="auto-progress-note">This account is not linked to a registered public profile.</span>}
      {!linked && identityState === "unconfigured" && <span className="auto-progress-note">Participant sign-in is not configured for this environment.</span>}
      {!linked && identityState === "unverified_email" && <span className="auto-progress-note">Confirm the account email used for your registration first.</span>}
      {!linked && identityState === "check_failed" && <span className="auto-progress-note">The linked profile could not be safely validated.</span>}
      {linked && <span className="auto-progress-note"><ShieldCheck size={14} aria-hidden="true" />Only your confirmed registration email can request a refresh.</span>}
      {!refreshAvailable && <span className="auto-progress-note">Live profile retrieval is unavailable. No profile fetch will be performed; only organizer-imported unverified counts may appear above.</span>}
    </div>
    <p className="auto-progress-result" role={message ? "status" : undefined} aria-live="polite">{message ?? (progress?.displayState === "stale" ? "Saved progress is stale. A successful refresh will update this snapshot." : "")}</p>
  </section>;
}

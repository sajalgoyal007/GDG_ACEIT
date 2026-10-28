"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useActionState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { Activity, ArrowDownToLine, ArrowLeft, BadgeCheck, ChevronRight, CircleHelp, ClipboardList, Database, FileUp, Filter, LayoutDashboard, LogOut, Medal, Search, ShieldCheck, Users, Menu, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { importParticipantsAction, setVerifiedBadgeCountAction, signOutAdmin } from "@/app/admin/actions";
import { initialAdminActionState } from "@/app/admin/action-state";
import { GoogleFormSync } from "@/components/google-form-sync";
import { ThemeControl } from "@/components/theme-control";

type AuditEventType = "participant_imported" | "participant_synced" | "badge_count_updated";
type AuditSource = "csv_import" | "admin_manual" | "google_sheets_sync";

export interface AdminParticipantOption {
  id: string;
  displayName: string;
  registrationStatus: "registered" | "pending";
  verifiedBadgeCount: number;
  lastVerifiedAt: string | null;
  audit: {
    id: string;
    eventType: AuditEventType;
    source: AuditSource;
    previousBadgeCount: number | null;
    newBadgeCount: number | null;
    note: string | null;
    actorUserId: string | null;
    createdAt: string;
    verifiedAt: string | null;
  }[];
}

type ParticipantFilter = "all" | "registered" | "pending";

const sidebarItems = [
  { href: "#overview", label: "Overview", icon: LayoutDashboard },
  { href: "#participants", label: "Participants", icon: Users },
  { href: "#google-form-sync", label: "Google Form Sync", icon: Database },
  { href: "#badge-verification", label: "Badge Verification", icon: BadgeCheck },
  { href: "#audit-history", label: "Audit History", icon: ClipboardList },
];

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Timestamp unavailable";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(date) + " IST";
}

function eventTitle(type: AuditEventType) {
  if (type === "participant_imported") return "Participant registered";
  if (type === "participant_synced") return "Registration details updated";
  return "Badge count verified";
}

function sourceTitle(source: AuditSource) {
  if (source === "google_sheets_sync") return "Google Form sync";
  if (source === "csv_import") return "CSV import";
  return "Manual admin update";
}

function ActionFeedback({ state }: { state: typeof initialAdminActionState }) {
  if (state.status === "idle") return null;
  return <div className={`admin-feedback ${state.status}`} role={state.status === "error" ? "alert" : "status"}>
    <p>{state.message}</p>
    {state.issues && state.issues.length > 0 && <ul>{state.issues.map((issue, index) => <li key={`${issue.rowNumber}-${index}`}><strong>Row {issue.rowNumber} · {issue.kind}:</strong> {issue.message}</li>)}</ul>}
  </div>;
}

export function AdminWorkspace({ participants }: { participants: AdminParticipantOption[] }) {
  const [importState, importAction, importPending] = useActionState(importParticipantsAction, initialAdminActionState);
  const [countState, countAction, countPending] = useActionState(setVerifiedBadgeCountAction, initialAdminActionState);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ParticipantFilter>("all");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("overview");
  const mobileMenuButton = useRef<HTMLButtonElement>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!mobileNavOpen) return;
    const menuButton = mobileMenuButton.current;
    document.querySelector<HTMLElement>(".admin-sidebar-nav a")?.focus();
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileNavOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => { window.removeEventListener("keydown", closeOnEscape); menuButton?.focus(); };
  }, [mobileNavOpen]);

  useEffect(() => {
    const sections = sidebarItems.map(({ href }) => document.getElementById(href.slice(1))).filter((section): section is HTMLElement => section instanceof HTMLElement);
    if (!("IntersectionObserver" in window) || sections.length === 0) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) setActiveSection(visible.target.id);
    }, { rootMargin: "-12% 0px -68% 0px", threshold: [0, 0.2, 0.5, 0.8] });
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  const { registeredCount, verifiedBadges, fiveBadgeCount, tenBadgeCount, pendingRegistrations } = useMemo(() => {
    let regCount = 0;
    let badges = 0;
    let fiveCount = 0;
    let tenCount = 0;
    for (const p of participants) {
      if (p.registrationStatus === "registered") {
        regCount += 1;
        badges += p.verifiedBadgeCount;
        if (p.verifiedBadgeCount >= 5) fiveCount += 1;
        if (p.verifiedBadgeCount >= 10) tenCount += 1;
      }
    }
    return {
      registeredCount: regCount,
      verifiedBadges: badges,
      fiveBadgeCount: fiveCount,
      tenBadgeCount: tenCount,
      pendingRegistrations: participants.length - regCount,
    };
  }, [participants]);

  const filteredParticipants = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return participants.filter((participant) => {
      const matchesName = !query || participant.displayName.toLocaleLowerCase().includes(query);
      const matchesStatus = filter === "all" || participant.registrationStatus === filter;
      return matchesName && matchesStatus;
    });
  }, [participants, search, filter]);

  const activities = useMemo(() => participants.flatMap((participant) => participant.audit.map((event) => ({ ...event, participantName: participant.displayName })))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)), [participants]);
  const latestSyncActivity = activities.find((event) => event.source === "google_sheets_sync");
  const metrics: { Icon: LucideIcon; tone: string; label: string; value: number; note: string }[] = [
    { Icon: Users, tone: "blue", label: "REGISTERED PARTICIPANTS", value: registeredCount, note: `${pendingRegistrations} pending` },
    { Icon: BadgeCheck, tone: "green", label: "VERIFIED BADGES", value: verifiedBadges, note: "Recorded progress" },
    { Icon: Medal, tone: "amber", label: "5+ BADGE MILESTONE", value: fiveBadgeCount, note: "Registered learners" },
    { Icon: Activity, tone: "violet", label: "10+ BADGE MILESTONE", value: tenBadgeCount, note: "Registered learners" },
  ];
  return <div className="admin-app dark-community">
    <header className="admin-app-topbar">
      <Link className="admin-brand" href="/" aria-label="GDG On Campus ACEIT public leaderboard">
        <Image src="/gdg-mark.png" alt="" width={34} height={34} priority />
        <span><strong>GDG On Campus ACEIT</strong><small>LEARN WITH COMMUNITIES 2026</small></span>
      </Link>
      <button ref={mobileMenuButton} className="admin-mobile-menu" type="button" aria-label={mobileNavOpen ? "Close workspace navigation" : "Open workspace navigation"} aria-expanded={mobileNavOpen} aria-controls="admin-workspace-navigation" onClick={() => setMobileNavOpen((open) => !open)}>{mobileNavOpen ? <X size={19} /> : <Menu size={19} />}</button>
      <ThemeControl />
      <div className="admin-session-chip"><span aria-hidden="true" /><span>Administrator verified</span></div>
      <form action={signOutAdmin}><button type="submit" className="admin-top-signout"><LogOut size={15} aria-hidden="true" /><span>Sign out</span></button></form>
    </header>

    <div className="admin-layout">
      <AnimatePresence>{mobileNavOpen && <motion.button className="admin-drawer-backdrop" type="button" aria-label="Close workspace navigation" onClick={() => setMobileNavOpen(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduceMotion ? 0 : .16 }} />}</AnimatePresence>
      <aside id="admin-workspace-navigation" className={`admin-sidebar${mobileNavOpen ? " is-open" : ""}`} aria-label="Administrator dashboard navigation">
        <p className="admin-sidebar-label">WORKSPACE</p>
        <nav className="admin-sidebar-nav">
          {sidebarItems.map(({ href, label, icon: Icon }) => <a key={href} href={href} onClick={() => setMobileNavOpen(false)} aria-current={activeSection === href.slice(1) ? "location" : undefined}><Icon size={16} aria-hidden="true" /><span>{label}</span><ChevronRight size={13} aria-hidden="true" />{activeSection === href.slice(1) && <motion.i layoutId="admin-nav-active" className="admin-nav-indicator" transition={{ duration: reduceMotion ? 0 : .2 }} />}</a>)}
        </nav>
        <div className="admin-sidebar-bottom">
          <div className="admin-sidebar-security"><ShieldCheck size={15} aria-hidden="true" /><span>Supabase Auth<br /><small>Role checked per request</small></span></div>
          <Link href="/" className="admin-sidebar-back"><ArrowLeft size={14} aria-hidden="true" />Back to public site</Link>
        </div>
      </aside>

      <main className="admin-main">
        <header className="admin-main-header" id="overview">
          <div><p className="admin-main-kicker"><span />COMMUNITY OPERATIONS <span className="admin-kicker-slash">/</span> ACEIT</p><h1>Admin workspace.</h1><p>Manage participant records, review registration syncs, and record badge verification.</p></div>
          <div className="admin-header-health"><ShieldCheck size={16} aria-hidden="true" /><span><strong>Access verified</strong><small>Authenticated admin session</small></span></div>
        </header>

        <section className="admin-stat-grid" aria-label="Community overview statistics">
          {metrics.map(({ Icon, tone, label, value, note }, index) => <motion.article key={label} className="admin-stat-card" initial={{ opacity: 0, y: reduceMotion ? 0 : 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? 0 : .3, delay: reduceMotion ? 0 : index * .055 }}><span className={`admin-stat-icon ${tone}`}><Icon size={17} aria-hidden="true" /></span><span className="admin-stat-copy"><small>{label}</small><strong>{value.toLocaleString("en-IN")}</strong></span><span className="admin-stat-note">{note}</span></motion.article>)}
        </section>

        <section className="admin-overview-grid" aria-label="Sync status and recent activity">
          <article className="admin-panel admin-sync-status-panel">
            <div className="admin-panel-heading"><span className="admin-panel-icon"><Database size={16} aria-hidden="true" /></span><div><p className="admin-panel-eyebrow">REGISTRATION SOURCE</p><h2>Google Form sync</h2></div><span className="admin-status-pill"><span />Manual</span></div>
            <p className="admin-panel-copy">Sheets are read only. Review a fresh preview before approving any participant changes.</p>
            <div className="admin-sync-meta"><span>Scheduling</span><strong>Not configured</strong></div>
            <div className="admin-sync-meta"><span>Last recorded sync activity</span><strong>{latestSyncActivity ? formatDate(latestSyncActivity.createdAt) : "No sync activity recorded"}</strong></div>
            <a className="admin-inline-link" href="#google-form-sync">Open sync review <ChevronRight size={14} aria-hidden="true" /></a>
          </article>
          <article className="admin-panel admin-recent-panel">
            <div className="admin-panel-heading"><span className="admin-panel-icon green"><Activity size={16} aria-hidden="true" /></span><div><p className="admin-panel-eyebrow">RECENT RECORDS</p><h2>Recent activity</h2></div><a className="admin-panel-viewall" href="#audit-history">View audit <ArrowDownToLine size={13} aria-hidden="true" /></a></div>
            {activities.length === 0 ? <div className="admin-panel-empty"><span><CircleHelp size={17} aria-hidden="true" /></span><p>No audit activity yet.</p><small>Recorded imports and verification updates will appear here.</small></div> : <ul className="admin-activity-list">{activities.slice(0, 4).map((event) => <li key={event.id}><span className="admin-activity-dot" /><span className="admin-activity-copy"><strong>{eventTitle(event.eventType)}</strong><small>{event.participantName} · {sourceTitle(event.source)}</small></span><time dateTime={event.createdAt}>{formatDate(event.createdAt)}</time></li>)}</ul>}
          </article>
        </section>

        <section id="participants" className="admin-section" aria-labelledby="participants-title">
          <div className="admin-section-heading"><div><p className="admin-panel-eyebrow">REGISTRATION</p><h2 id="participants-title">Participants</h2></div><span className="admin-section-count">{participants.length} records</span></div>
          <div className="admin-participant-tools">
            <article className="admin-panel admin-import-panel">
              <div className="admin-panel-heading"><span className="admin-panel-icon"><FileUp size={16} aria-hidden="true" /></span><div><p className="admin-panel-eyebrow">CSV WORKFLOW</p><h3>Import participants</h3></div></div>
              <div className="admin-import-guidance"><strong>Required columns</strong><code>participant_key, display_name, profile_url</code><p>Use an approved stable identifier. Email addresses are not accepted in this template.</p><a href="/participants-import-template.csv" download>Download CSV template <ArrowDownToLine size={13} aria-hidden="true" /></a></div>
              <form action={importAction} className="admin-form" onSubmit={(event) => {
                if (!window.confirm("Import valid participant rows from this CSV? Existing records and verified badge counts will remain unchanged.")) event.preventDefault();
              }}>
                <label htmlFor="participants-csv">Select participant CSV</label>
                <input id="participants-csv" type="file" name="participantsCsv" accept=".csv,text/csv" required disabled={importPending} />
                <label className="admin-confirm"><input type="checkbox" name="confirmImport" value="confirmed" required disabled={importPending} />I reviewed this CSV and confirm the import.</label>
                <button type="submit" disabled={importPending}>{importPending ? "Validating and importing…" : "Validate and import CSV"}</button>
              </form>
              <p className="admin-help">Duplicates and invalid rows are reported. Existing badge counts are preserved.</p>
              <ActionFeedback state={importState} />
            </article>

            <article className="admin-panel admin-people-panel">
              <div className="admin-panel-heading"><span className="admin-panel-icon"><Users size={16} aria-hidden="true" /></span><div><p className="admin-panel-eyebrow">DIRECTORY</p><h3>Participant records</h3></div></div>
              <div className="admin-directory-controls">
                <label className="admin-directory-search"><Search size={15} aria-hidden="true" /><span className="sr-only">Search participants by display name</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by display name" /></label>
                <label className="admin-directory-filter"><Filter size={14} aria-hidden="true" /><span className="sr-only">Filter by registration status</span><select value={filter} onChange={(event) => setFilter(event.target.value as ParticipantFilter)}><option value="all">All statuses</option><option value="registered">Registered</option><option value="pending">Pending</option></select></label>
              </div>
              {participants.length === 0 ? <div className="admin-panel-empty"><span><Users size={17} aria-hidden="true" /></span><p>No participant records</p><small>Import an approved registration CSV or review Google Form responses.</small></div> : filteredParticipants.length === 0 ? <div className="admin-panel-empty" role="status"><span><Search size={17} aria-hidden="true" /></span><p>No matching participants</p><small>Change the name or status filter to see more records.</small><button type="button" onClick={() => { setSearch(""); setFilter("all"); }}>Clear filters</button></div> : <>
                <div className="admin-directory-table-wrap"><table className="admin-directory-table"><thead><tr><th scope="col">PARTICIPANT</th><th scope="col">REGISTRATION</th><th scope="col">BADGES</th><th scope="col">LAST VERIFIED</th></tr></thead><tbody>{filteredParticipants.map((participant) => <tr key={participant.id}><td><strong>{participant.displayName}</strong></td><td><span className={`admin-registration-pill ${participant.registrationStatus}`}>{participant.registrationStatus}</span></td><td className="admin-badge-count">{participant.verifiedBadgeCount}</td><td>{participant.lastVerifiedAt ? formatDate(participant.lastVerifiedAt) : "Not recorded"}</td></tr>)}</tbody></table></div>
                <ul className="admin-directory-mobile" aria-label="Participant records">{filteredParticipants.map((participant) => <li key={participant.id}><div><strong>{participant.displayName}</strong><span className={`admin-registration-pill ${participant.registrationStatus}`}>{participant.registrationStatus}</span></div><p>{participant.verifiedBadgeCount} verified badges <span>·</span> {participant.lastVerifiedAt ? `Checked ${formatDate(participant.lastVerifiedAt)}` : "No verification recorded"}</p></li>)}</ul>
                <p className="admin-directory-result-count">Showing {filteredParticipants.length} of {participants.length} records</p>
              </>}
              <p className="admin-help">Private contact data and internal matching identifiers are not displayed.</p>
            </article>
          </div>
        </section>

        <section id="google-form-sync" className="admin-section" aria-labelledby="sync-section-title">
          <div className="admin-section-heading"><div><p className="admin-panel-eyebrow">READ ONLY SOURCE · MANUAL REVIEW</p><h2 id="sync-section-title">Google Form Sync</h2></div><span className="admin-section-count">Preview before applying</span></div>
          <GoogleFormSync />
        </section>

        <section id="badge-verification" className="admin-section" aria-labelledby="verification-section-title">
          <div className="admin-section-heading"><div><p className="admin-panel-eyebrow">AUDITED ADMIN ACTION</p><h2 id="verification-section-title">Badge Verification</h2></div><span className="admin-section-count">Manual review only</span></div>
          <article className="admin-panel admin-verification-panel">
            <div className="admin-panel-heading"><span className="admin-panel-icon green"><BadgeCheck size={16} aria-hidden="true" /></span><div><p className="admin-panel-eyebrow">VERIFIED PROGRESS</p><h3>Record badge count</h3></div></div>
            {participants.length === 0 ? <div className="admin-panel-empty"><span><BadgeCheck size={17} aria-hidden="true" /></span><p>No participants to verify yet.</p><small>Add a participant record before recording badge progress.</small></div> : <form action={countAction} className="admin-form admin-verification-form" onSubmit={(event) => {
              const participantSelect = event.currentTarget.elements.namedItem("participantId");
              const countInput = event.currentTarget.elements.namedItem("verifiedBadgeCount");
              const participantName = participantSelect instanceof HTMLSelectElement ? participantSelect.selectedOptions[0]?.textContent : "the selected participant";
              const count = countInput instanceof HTMLInputElement ? countInput.value : "";
              if (!window.confirm(`Record ${count} verified badges for ${participantName}? This action is added to the audit history.`)) event.preventDefault();
            }}>
              <label htmlFor="count-participant">Participant</label>
              <select id="count-participant" name="participantId" required defaultValue="" disabled={countPending}><option value="" disabled>Select a participant</option>{participants.map((participant) => <option key={participant.id} value={participant.id}>{participant.displayName} · current {participant.verifiedBadgeCount}</option>)}</select>
              <label htmlFor="verified-count">Verified badge count</label>
              <input id="verified-count" name="verifiedBadgeCount" type="number" min="0" max="10000" step="1" required disabled={countPending} />
              <label htmlFor="verification-note">Verification note</label>
              <textarea id="verification-note" name="verificationNote" minLength={1} maxLength={1000} rows={3} required disabled={countPending} placeholder="Record the approved evidence or review context." />
              <label className="admin-confirm"><input type="checkbox" name="confirmBadgeUpdate" value="confirmed" required disabled={countPending} />I reviewed the evidence and confirm this verified count.</label>
              <button type="submit" disabled={countPending}>{countPending ? "Recording verification…" : "Record verified count"}</button>
            </form>}
            <p className="admin-help">Updates preserve badge-earned dates, record the verification time and actor, and append an audit event.</p>
            <ActionFeedback state={countState} />
          </article>
        </section>

        <section id="audit-history" className="admin-section" aria-labelledby="audit-section-title">
          <div className="admin-section-heading"><div><p className="admin-panel-eyebrow">RECORD OF CHANGES</p><h2 id="audit-section-title">Audit History</h2></div><span className="admin-section-count">{activities.length} events</span></div>
          <article className="admin-panel admin-audit-panel">
            {activities.length === 0 ? <div className="admin-panel-empty"><span><ClipboardList size={17} aria-hidden="true" /></span><p>No audit events recorded.</p><small>Participant imports, sync changes, and badge verification updates will be listed here.</small></div> : <ol className="admin-audit-list">{activities.map((event) => <li key={event.id}><span className={`admin-audit-icon ${event.eventType === "badge_count_updated" ? "green" : event.source === "google_sheets_sync" ? "blue" : "amber"}`}>{event.eventType === "badge_count_updated" ? <BadgeCheck size={15} aria-hidden="true" /> : event.source === "google_sheets_sync" ? <Database size={15} aria-hidden="true" /> : <Users size={15} aria-hidden="true" />}</span><div className="admin-audit-event"><div><strong>{eventTitle(event.eventType)}</strong><span>{event.participantName}</span></div>{event.eventType === "badge_count_updated" && <p>{event.previousBadgeCount ?? "—"} → {event.newBadgeCount ?? "—"} verified badges</p>}{event.note && <p className="admin-audit-note">{event.note}</p>}<small>{sourceTitle(event.source)} · {event.actorUserId ? "Admin actor recorded" : "Actor unavailable"}{event.verifiedAt ? ` · verified ${formatDate(event.verifiedAt)}` : ""}</small></div><time dateTime={event.createdAt}>{formatDate(event.createdAt)}</time></li>)}</ol>}
          </article>
        </section>
        <footer className="admin-footer"><span>GDG On Campus ACEIT · Learn with Communities 2026</span><span>Admin actions are authenticated and audited.</span></footer>
      </main>
    </div>
  </div>;
}

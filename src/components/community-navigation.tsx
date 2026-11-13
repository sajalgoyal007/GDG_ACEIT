"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, Home, LockKeyhole, Menu, Trophy, Users, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { ThemeControl } from "@/components/theme-control";

const navLinks = [
  { href: "/", label: "Home", Icon: Home },
  { href: "/progress", label: "Leaderboard", Icon: Trophy },
  { href: "/about", label: "About", Icon: Users },
];

/** Crisp four-color "< >" chapter mark used in the sticky header. */
function GdgMark() {
  return (
    <svg className="g-brand-mark" viewBox="0 0 40 40" role="presentation" aria-hidden="true" focusable="false">
      <rect x="0.75" y="0.75" width="38.5" height="38.5" rx="10.5" className="g-brand-tile" />
      <g fill="none" strokeWidth="3.1" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16.4 12.6 9.6 20l6.8 7.4" stroke="#4285F4" />
        <path d="M9.6 20h3.4" stroke="#34A853" />
        <path d="M23.6 12.6 30.4 20l-6.8 7.4" stroke="#EA4335" />
        <path d="M30.4 20h-3.4" stroke="#FBBC04" />
      </g>
      <circle cx="20" cy="20" r="1.9" className="g-brand-spark" />
    </svg>
  );
}

export function CommunityNavigation({ dataMode }: { dataMode?: "demo" | "database" }) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (mobileMenuOpen) document.body.classList.add("mobile-menu-open");
    else document.body.classList.remove("mobile-menu-open");
    return () => document.body.classList.remove("mobile-menu-open");
  }, [mobileMenuOpen]);

  return (
    <header className="g-nav">
      <div className="g-nav-inner">
        <Link className="g-brand" href="/" aria-label="GDG On Campus ACEIT home" onClick={() => setMobileMenuOpen(false)}>
          <GdgMark />
          <span className="g-brand-copy">
            <strong>GDG On Campus</strong>
            <small>ACEIT · JAIPUR</small>
          </span>
        </Link>

        <nav className="g-nav-links" aria-label="Main navigation">
          {navLinks.map(({ href, label }) => {
            const active = pathname === href;
            return (
              <Link key={href} href={href} className={active ? "g-nav-link is-active" : "g-nav-link"} aria-current={active ? "page" : undefined}>
                {active && (
                  <motion.span
                    layoutId="g-nav-active-pill"
                    className="g-nav-pill"
                    transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }}
                  />
                )}
                <span className="g-nav-link-label">{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="g-nav-actions">
          <span className={dataMode === "demo" ? "g-live g-live-demo" : "g-live"} title={dataMode === "demo" ? "Synthetic demo records" : "Community-recorded data"}>
            <span className="g-live-dot" aria-hidden="true" />
            {dataMode === "demo" ? "DEMO" : "LIVE"}
          </span>
          <ThemeControl />
          <Link className="g-admin-link" href="/admin/login" aria-label="Admin sign in">
            <LockKeyhole size={14} aria-hidden="true" />
            <span>Admin</span>
          </Link>
        </div>

        <div className="g-mobile-actions">
          <ThemeControl />
          <button
            type="button"
            className="g-menu-toggle"
            aria-label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={mobileMenuOpen}
            aria-controls="community-mobile-nav"
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            {mobileMenuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>
        </div>
      </div>

      {mobileMenuOpen && <div className="g-drawer-backdrop" onClick={() => setMobileMenuOpen(false)} aria-hidden="true" />}

      <div
        id="community-mobile-nav"
        className={`g-drawer${mobileMenuOpen ? " is-open" : ""}`}
        aria-label="Mobile site navigation"
        aria-hidden={!mobileMenuOpen}
      >
        <div className="g-drawer-inner">
          <span className={dataMode === "demo" ? "g-live g-live-demo" : "g-live"}>
            <span className="g-live-dot" aria-hidden="true" />
            {dataMode === "demo" ? "DEMO SNAPSHOT" : "LIVE COMMUNITY RECORD"}
          </span>

          <nav className="g-drawer-links" aria-label="Mobile navigation links">
            {navLinks.map(({ href, label, Icon }) => {
              const active = pathname === href;
              return (
                <Link key={href} href={href} className={active ? "g-drawer-link is-active" : "g-drawer-link"} aria-current={active ? "page" : undefined} onClick={() => setMobileMenuOpen(false)}>
                  <span><Icon size={18} aria-hidden="true" />{label}</span>
                  {active ? <span className="g-drawer-current" aria-hidden="true">Here</span> : <ArrowUpRight size={16} aria-hidden="true" />}
                </Link>
              );
            })}
          </nav>

          <Link href="/admin/login" className="g-drawer-admin" onClick={() => setMobileMenuOpen(false)}>
            <span className="g-drawer-admin-icon"><LockKeyhole size={18} aria-hidden="true" /></span>
            <span><strong>Admin workspace</strong><small>Badge sync &amp; participant management</small></span>
            <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </header>
  );
}

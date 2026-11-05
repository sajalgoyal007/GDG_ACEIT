"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, LockKeyhole, Menu, TrendingUp, Users, X } from "lucide-react";
import { ThemeControl } from "@/components/theme-control";

export function CommunityNavigation({ dataMode }: { dataMode?: "demo" | "database" }) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Close mobile navigation drawer whenever pathname changes
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  // Close mobile menu on Escape key
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobileMenuOpen]);

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.classList.add("mobile-menu-open");
    } else {
      document.body.classList.remove("mobile-menu-open");
    }
    return () => {
      document.body.classList.remove("mobile-menu-open");
    };
  }, [mobileMenuOpen]);

  const navLinks = [
    { href: "/", label: "Dashboard", Icon: LayoutDashboard },
    { href: "/progress", label: "Progress", Icon: TrendingUp },
    { href: "/about", label: "About", Icon: Users },
  ];

  return (
    <header className="community-topbar">
      <div className="topbar-inner">
        <Link
          className="community-brand"
          href="/"
          aria-label="GDG On Campus ACEIT home"
          onClick={() => setMobileMenuOpen(false)}
        >
          <Image
            className="community-brand-mark"
            src="/gdg-mark.png"
            alt=""
            width={44}
            height={44}
            priority
          />
          <span className="community-brand-copy">
            <strong>GDG On Campus ACEIT</strong>
            <small>JAIPUR · RAJASTHAN</small>
          </span>
        </Link>

        {/* Desktop Navigation */}
        <nav className="reference-nav desktop-nav" aria-label="Main navigation">
          {navLinks.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              aria-current={pathname === href ? "page" : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>

        {/* Desktop Trailing Actions */}
        <div className="desktop-trailing-actions">
          {dataMode === "demo" ? (
            <span className="demo-label"><span aria-hidden="true" />DEMO DATA</span>
          ) : (
            <span className="demo-label live-label"><span aria-hidden="true" />LIVE</span>
          )}
          <ThemeControl />
          <Link className="header-admin" href="/admin/login" aria-label="Admin sign in">
            <LockKeyhole size={14} aria-hidden="true" />
            <span>Admin</span>
          </Link>
        </div>

        {/* Dedicated Mobile Header Controls */}
        <div className="mobile-header-actions">
          <ThemeControl />
          <button
            type="button"
            className="mobile-nav-toggle"
            aria-label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={mobileMenuOpen}
            aria-controls="community-mobile-nav"
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            {mobileMenuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer Backdrop */}
      {mobileMenuOpen && (
        <div
          className="mobile-nav-backdrop"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile Navigation Drawer */}
      <div
        id="community-mobile-nav"
        className={`mobile-nav-drawer${mobileMenuOpen ? " is-open" : ""}`}
        aria-label="Mobile site navigation"
        aria-hidden={!mobileMenuOpen}
      >
        <div className="mobile-nav-inner">
          <div className="mobile-nav-status">
            {dataMode === "demo" ? (
              <span className="demo-label"><span aria-hidden="true" />DEMO DATA SNAPSHOT</span>
            ) : (
              <span className="demo-label live-label"><span aria-hidden="true" />LIVE COMMUNITY RECORD</span>
            )}
          </div>

          <nav className="mobile-nav-list" aria-label="Mobile navigation links">
            {navLinks.map(({ href, label, Icon }) => {
              const isActive = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  className={`mobile-nav-link${isActive ? " is-active" : ""}`}
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <span className="mobile-nav-link-main">
                    <Icon size={17} aria-hidden="true" />
                    <span>{label}</span>
                  </span>
                  {isActive && <span className="mobile-nav-current-pill">Active</span>}
                </Link>
              );
            })}
          </nav>

          <div className="mobile-nav-admin-wrap">
            <Link
              href="/admin/login"
              className="mobile-nav-admin-card"
              onClick={() => setMobileMenuOpen(false)}
            >
              <div className="mobile-admin-icon">
                <LockKeyhole size={18} aria-hidden="true" />
              </div>
              <div className="mobile-admin-copy">
                <strong>Admin Workspace</strong>
                <small>Badge imports &amp; participant management</small>
              </div>
              <span className="mobile-admin-arrow" aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}

"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { ThemeControl } from "@/components/theme-control";

export function CommunityNavigation({ dataMode }: { dataMode?: "demo" | "database" }) {
  const pathname = usePathname();

  return (
    <header className="community-topbar">
      <div className="topbar-inner">
        <Link className="community-brand" href="/" aria-label="GDG On Campus ACEIT home">
          <Image className="community-brand-mark" src="/gdg-mark.png" alt="" width={36} height={36} priority />
          <span className="community-brand-copy"><strong>GDG On Campus ACEIT</strong><small>JAIPUR · RAJASTHAN</small></span>
        </Link>
        <nav className="reference-nav" aria-label="Main navigation">
          <Link href="/" aria-current={pathname === "/" ? "page" : undefined}>Dashboard</Link>
          <Link href="/progress" aria-current={pathname === "/progress" ? "page" : undefined}>Progress</Link>
          <Link href="/about" aria-current={pathname === "/about" ? "page" : undefined}>About</Link>
        </nav>
        {dataMode && <span className={dataMode === "demo" ? "demo-label" : "demo-label database-label"}><span aria-hidden="true" />{dataMode === "demo" ? "DEMO DATA" : "DATABASE"}</span>}
        <ThemeControl />
        <Link className="header-admin" href="/admin/login" aria-label="Admin sign in"><LockKeyhole size={14} aria-hidden="true" /><span>Admin</span></Link>
      </div>
    </header>
  );
}

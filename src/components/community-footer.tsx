import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

const internalLinks = [
  { href: "/", label: "Home" },
  { href: "/progress", label: "Leaderboard" },
  { href: "/about", label: "About" },
  { href: "/admin/login", label: "Admin" },
];

const externalLinks = [
  { href: "https://gdg.community.dev/", label: "GDG Community" },
  { href: "https://in.linkedin.com/company/gdg-aceit", label: "LinkedIn" },
  { href: "https://www.aryacollege.in/arya-event/arya-gdg-club", label: "Arya College" },
];

export function CommunityFooter() {
  return (
    <footer className="g-footer">
      <div className="g-footer-top">
        <div className="g-footer-brand">
          <Image className="g-footer-mark" src="/gdg-mark.png" alt="" width={40} height={40} />
          <span>
            <strong>GDG On Campus ACEIT</strong>
            <small>Cloud &amp; AI Campaign 2026 · Kukas, Jaipur</small>
          </span>
        </div>
        <div className="g-footer-columns no-scrollbar">
          <nav className="g-footer-links" aria-label="Footer navigation">
            <span>EXPLORE</span>
            {internalLinks.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}
          </nav>
          <div className="g-footer-links">
            <span>COMMUNITY</span>
            {externalLinks.map((link) => <a key={link.href} href={link.href} target="_blank" rel="noreferrer">{link.label}<ArrowUpRight size={12} aria-hidden="true" /></a>)}
          </div>
        </div>
      </div>
      <div className="g-footer-bottom">
        <span>Learn · Build · Connect</span>
        <span>Community-run chapter · Not an official Google product</span>
      </div>
    </footer>
  );
}

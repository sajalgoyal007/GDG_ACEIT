import Link from "next/link";

export function CommunityFooter() {
  return (
    <footer className="community-footer">
      <span className="footer-brand"><span className="footer-glyph" aria-hidden="true">A.</span><span><strong>GDG On Campus ACEIT</strong><small>Learn with Communities 2026 · Jaipur, Rajasthan</small></span></span>
      <div className="footer-links"><Link href="/">Dashboard</Link><Link href="/progress">Progress</Link><Link href="/about">About</Link><Link href="/admin/login">Admin sign in</Link></div>
      <span className="footer-note">Independent community project · Not an official Google product</span>
    </footer>
  );
}

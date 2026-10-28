import Link from "next/link";
import { ArrowLeft, Compass } from "lucide-react";

export default function NotFound() {
  return (
    <main className="error-page dark-community" role="status">
      <div className="error-card">
        <span className="error-mark" aria-hidden="true">
          <Compass size={24} />
        </span>
        <p className="eyebrow">404 · PAGE NOT FOUND</p>
        <h1>Page not found</h1>
        <p>The page you requested could not be found or may have moved.</p>
        <Link href="/" className="button-primary" style={{ display: "inline-flex", marginTop: "16px" }}>
          <ArrowLeft size={14} aria-hidden="true" />
          Back to leaderboard
        </Link>
      </div>
    </main>
  );
}


"use client";

import Link from "next/link";
import { AlertTriangle, RotateCw } from "lucide-react";

export default function AdminError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="admin-access-page dark-community"><section className="admin-access-card" role="alert">
    <span className="admin-access-icon admin-error-icon"><AlertTriangle size={20} aria-hidden="true" /></span>
    <p className="auth-eyebrow">WORKSPACE UNAVAILABLE</p>
    <h1>We couldn’t load admin tools.</h1>
    <p>Your participant data remains protected. Try again, or sign in again if your session has ended.</p>
    <div className="admin-error-actions"><button type="button" onClick={() => reset()}><RotateCw size={14} aria-hidden="true" />Try again</button><Link href="/admin/login">Return to sign in</Link></div>
  </section></main>;
}

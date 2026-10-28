import Link from "next/link";
import { ArrowLeft, LockKeyhole } from "lucide-react";
import { AdminLoginForm } from "@/components/admin-login-form";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getAuthLinkErrorMessage } from "@/lib/supabase/auth-link-error";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ auth?: string; setup?: string }> }) {
  const { auth, setup } = await searchParams;
  const notice = setup === "required"
    ? "Configure Supabase and environment settings before signing in."
    : auth === "sign-in-required"
      ? "Your session ended or is not available. Sign in with your administrator account to continue."
      : auth === "signed-out"
        ? "You have been signed out. Sign in again when you are ready."
        : auth === "reset-required"
          ? "Open a fresh password reset link to continue."
          : auth === "expired"
            ? getAuthLinkErrorMessage("expired")
            : auth === "failed"
              ? getAuthLinkErrorMessage("invalid")
              : undefined;
  if (!isSupabaseConfigured()) {
    return <main className="auth-page admin-auth-page dark-community"><section className="auth-card admin-auth-card"><span className="auth-icon"><LockKeyhole size={20} /></span><p className="auth-eyebrow">ADMIN SETUP REQUIRED</p><h1>Admin sign-in is unavailable.</h1><p className="auth-description">Configure Supabase Auth and the server environment variables before enabling management workflows. Demo mode has no admin actions.</p><Link href="/" className="auth-back"><ArrowLeft size={14} /> Back to leaderboard</Link></section></main>;
  }
  return <main className="auth-page admin-auth-page dark-community"><AdminLoginForm notice={notice} /></main>;
}

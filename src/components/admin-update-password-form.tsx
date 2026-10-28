"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Eye, EyeOff, KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function AdminUpdatePasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "error" | "success"; message: string } | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    if (password.length < 12) {
      setFeedback({ kind: "error", message: "Choose a password with at least 12 characters." });
      return;
    }
    if (password !== confirmation) {
      setFeedback({ kind: "error", message: "The passwords do not match." });
      return;
    }

    setPending(true);
    try {
      const { error } = await createSupabaseBrowserClient().auth.updateUser({ password });
      if (error) {
        setFeedback({ kind: "error", message: "We couldn’t update the password. The reset link may have expired; request a fresh one and try again." });
        return;
      }
      setFeedback({ kind: "success", message: "Password updated. Checking your administrator access…" });
      router.replace("/admin");
      router.refresh();
    } catch {
      setFeedback({ kind: "error", message: "We couldn’t update the password. Request a fresh reset link and try again." });
    } finally {
      setPending(false);
    }
  }

  return <section className="auth-card admin-auth-card" aria-labelledby="update-password-title">
    <div className="admin-auth-brand"><span className="auth-icon"><ShieldCheck size={20} aria-hidden="true" /></span><span><strong>GDG On Campus ACEIT</strong><small>ACCOUNT RECOVERY</small></span></div>
    <p className="auth-eyebrow">LEARN WITH COMMUNITIES 2026</p>
    <h1 id="update-password-title">Choose a new password.</h1>
    <p className="auth-description">This updates the password for the Supabase account that opened the reset link. It does not grant administrator access.</p>
    <form onSubmit={handleSubmit} className="auth-form admin-auth-form">
      <label htmlFor="new-admin-password">New password</label>
      <div className="auth-password-wrap"><input id="new-admin-password" type={showPassword ? "text" : "password"} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} maxLength={1024} required disabled={pending} /><button className="auth-password-toggle" type="button" aria-label={showPassword ? "Hide new password" : "Show new password"} aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)} disabled={pending}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>
      <label htmlFor="confirm-admin-password">Confirm new password</label>
      <div className="auth-password-wrap"><input id="confirm-admin-password" type={showConfirmation ? "text" : "password"} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} minLength={12} maxLength={1024} required disabled={pending} /><button className="auth-password-toggle" type="button" aria-label={showConfirmation ? "Hide confirmation" : "Show confirmation"} aria-pressed={showConfirmation} onClick={() => setShowConfirmation((visible) => !visible)} disabled={pending}>{showConfirmation ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>
      <button className="admin-auth-submit" type="submit" disabled={pending}>{pending ? <><LoaderCircle size={16} className="auth-spinner" aria-hidden="true" />Updating…</> : <><KeyRound size={16} aria-hidden="true" />Update password</>}</button>
    </form>
    {feedback && <p className={`auth-message admin-auth-message ${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"}>{feedback.message}</p>}
    <Link href="/admin/login" className="auth-back"><ArrowLeft size={14} aria-hidden="true" /> Back to sign in</Link>
  </section>;
}

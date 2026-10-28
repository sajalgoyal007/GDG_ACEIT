"use client";

import { useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Eye, EyeOff, KeyRound, LoaderCircle, Mail, ShieldCheck } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type LoginMode = "password" | "magic-link" | "reset";
type Feedback = { kind: "error" | "success"; message: string } | null;

export function AdminLoginForm({ notice }: { notice?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [mode, setMode] = useState<LoginMode>("password");
  const [feedback, setFeedback] = useState<Feedback>(notice ? { kind: "error", message: notice } : null);
  const [pending, setPending] = useState(false);

  function changeMode(nextMode: LoginMode) {
    setMode(nextMode);
    setFeedback(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setFeedback(null);
    const normalizedEmail = email.trim();

    try {
      const supabase = createSupabaseBrowserClient();
      if (mode === "password") {
        const { error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
        if (error) {
          setFeedback({ kind: "error", message: "We couldn’t sign you in. Check your email and password, then try again." });
          return;
        }
        router.replace("/admin");
        router.refresh();
        return;
      }

      if (mode === "magic-link") {
        const { error } = await supabase.auth.signInWithOtp({
          email: normalizedEmail,
          options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        setFeedback(error
          ? { kind: "error", message: "We couldn’t send a sign-in link. Check your account setup and try again." }
          : { kind: "success", message: "If this is a provisioned account, a sign-in link has been sent." });
        return;
      }

      const redirectTo = `${window.location.origin}/auth/callback?next=%2Fadmin%2Fupdate-password`;
      const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, { redirectTo });
      setFeedback(error
        ? { kind: "error", message: "We couldn’t request a password reset. Check Supabase Auth settings and try again." }
        : { kind: "success", message: "If an account exists for this email, password reset instructions have been sent." });
    } catch {
      setFeedback({ kind: "error", message: "Authentication is temporarily unavailable. Please try again." });
    } finally {
      setPending(false);
    }
  }

  const isReset = mode === "reset";
  const isMagic = mode === "magic-link";
  const title = isReset ? "Reset your password" : isMagic ? "Sign in with a link" : "Welcome back.";
  const submitText = isReset ? "Send reset instructions" : isMagic ? "Email me a sign-in link" : "Sign in securely";

  return <section className="auth-card admin-auth-card" aria-labelledby="admin-login-title">
    <div className="admin-auth-brand"><Image src="/gdg-mark.png" alt="" width={38} height={38} priority /><span><strong>GDG On Campus ACEIT</strong><small>ADMINISTRATOR ACCESS</small></span></div>
    <p className="auth-eyebrow">LEARN WITH COMMUNITIES 2026</p>
    <h1 id="admin-login-title">{title}</h1>
    <p className="auth-description">Sign in with an existing Supabase account. Administrator access is checked separately; signing in does not grant an admin role.</p>

    <form onSubmit={handleSubmit} className="auth-form admin-auth-form">
      <label htmlFor="admin-email">Email address</label>
      <input id="admin-email" type="email" name="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} disabled={pending} />
      {mode === "password" && <>
        <label htmlFor="admin-password">Password</label>
        <div className="auth-password-wrap"><input id="admin-password" type={showPassword ? "text" : "password"} name="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required maxLength={1024} disabled={pending} /><button className="auth-password-toggle" type="button" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)} disabled={pending}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>
      </>}
      <button className="admin-auth-submit" type="submit" disabled={pending}>{pending ? <><LoaderCircle size={16} className="auth-spinner" aria-hidden="true" />Working…</> : <><KeyRound size={16} aria-hidden="true" />{submitText}</>}</button>
    </form>

    {feedback && <p className={`auth-message admin-auth-message ${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"}>{feedback.message}</p>}

    <div className="admin-auth-alternates">
      {mode === "password" && <><button type="button" className="auth-text-button" onClick={() => changeMode("reset")}><Mail size={14} aria-hidden="true" />Forgot password?</button><button type="button" className="auth-text-button" onClick={() => changeMode("magic-link")}>Use a magic link instead</button></>}
      {mode === "magic-link" && <button type="button" className="auth-text-button" onClick={() => changeMode("password")}>Back to password sign-in</button>}
      {mode === "reset" && <button type="button" className="auth-text-button" onClick={() => changeMode("password")}>Back to sign in</button>}
    </div>
    <div className="admin-auth-security"><ShieldCheck size={14} aria-hidden="true" /><span>Protected by Supabase Auth and the ACEIT administrator allowlist.</span></div>
    <Link href="/" className="auth-back"><ArrowLeft size={14} aria-hidden="true" /> Back to public leaderboard</Link>
  </section>;
}

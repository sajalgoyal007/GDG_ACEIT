"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CircleAlert, X } from "lucide-react";
import { getAuthLinkErrorKind, getAuthLinkErrorMessage, type AuthLinkErrorKind } from "@/lib/supabase/auth-link-error";

export function AuthLinkNotice() {
  const [kind, setKind] = useState<AuthLinkErrorKind | null>(null);

  useEffect(() => {
    const readLocationError = () => {
      const url = new URL(window.location.href);
      const fragment = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
      const fragmentCode = fragment.get("error_code");
      const hasFragmentError = fragment.has("error") || fragmentCode !== null;
      const queryStatus = url.searchParams.get("auth");

      if (hasFragmentError) {
        setKind(getAuthLinkErrorKind(fragmentCode));
        url.hash = "";
        window.history.replaceState(null, "", `${url.pathname}${url.search}`);
      } else if (queryStatus === "expired" || queryStatus === "failed") {
        setKind(queryStatus === "expired" ? "expired" : "invalid");
        url.searchParams.delete("auth");
        window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      }
    };

    readLocationError();
    window.addEventListener("hashchange", readLocationError);
    window.addEventListener("popstate", readLocationError);
    return () => {
      window.removeEventListener("hashchange", readLocationError);
      window.removeEventListener("popstate", readLocationError);
    };
  }, []);

  if (!kind) return null;

  return <aside className="auth-link-notice" role="alert" aria-live="assertive">
    <span className="auth-link-notice-icon"><CircleAlert size={18} aria-hidden="true" /></span>
    <div className="auth-link-notice-copy"><strong>Sign-in link not accepted</strong><p>{getAuthLinkErrorMessage(kind)}</p></div>
    <Link href="/admin/login" className="auth-link-notice-action">Return to admin sign-in</Link>
    <button type="button" className="auth-link-notice-close" onClick={() => setKind(null)} aria-label="Dismiss sign-in error"><X size={17} aria-hidden="true" /></button>
  </aside>;
}

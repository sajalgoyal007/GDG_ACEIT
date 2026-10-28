import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, LockKeyhole } from "lucide-react";
import { AdminWorkspace } from "@/components/admin-workspace";
import { getAdminParticipants } from "@/lib/supabase/admin-data";
import { getAdminAuthorization } from "@/lib/supabase/admin-auth";
import { signOutAdmin } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const authorization = await getAdminAuthorization();
  if (authorization.status === "unconfigured") {
    return <main className="admin-access-page dark-community"><section className="admin-access-card"><span className="admin-access-icon"><LockKeyhole size={20} /></span><p className="auth-eyebrow">SUPABASE SETUP REQUIRED</p><h1>Admin tools are unavailable.</h1><p>Configure Supabase, apply the migration, and provision an authenticated admin role before using imports or badge verification. Demo mode has no management actions.</p><Link href="/" className="auth-back"><ArrowLeft size={14} /> Back to leaderboard</Link></section></main>;
  }
  if (authorization.status === "signed_out") redirect("/admin/login?auth=sign-in-required");
  if (authorization.status === "not_admin") {
    return <main className="admin-access-page dark-community"><section className="admin-access-card"><span className="admin-access-icon"><LockKeyhole size={20} /></span><p className="auth-eyebrow">ACCESS NOT GRANTED</p><h1>This account has no admin role.</h1><p>Management actions are hidden unless the authenticated Supabase user has an entry in the admin role table.</p><div className="admin-access-actions"><form action={signOutAdmin}><button type="submit">Sign out</button></form><Link href="/">Back to leaderboard</Link></div></section></main>;
  }
  if (authorization.status === "check_failed") {
    return <main className="admin-access-page dark-community"><section className="admin-access-card"><span className="admin-access-icon"><LockKeyhole size={20} /></span><p className="auth-eyebrow">ADMIN CHECK FAILED</p><h1>Management tools are unavailable.</h1><p>The session or role check failed, so participant controls remain hidden. Check the migration, Supabase configuration, and database policies.</p><Link href="/admin/login" className="auth-back"><ArrowLeft size={14} /> Return to sign-in</Link></section></main>;
  }

  const rows = await getAdminParticipants();
  const participants = rows.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    registrationStatus: row.registration_status,
    verifiedBadgeCount: row.verified_badge_count,
    lastVerifiedAt: row.last_verified_at,
    audit: row.audit,
  }));
  return <AdminWorkspace participants={participants} />;
}

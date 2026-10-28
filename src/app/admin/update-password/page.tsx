import { redirect } from "next/navigation";
import { AdminUpdatePasswordForm } from "@/components/admin-update-password-form";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminUpdatePasswordPage() {
  if (!isSupabaseConfigured()) redirect("/admin/login?setup=required");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/admin/login?auth=reset-required");

  return <main className="auth-page admin-auth-page dark-community"><AdminUpdatePasswordForm /></main>;
}

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseConfigured } from "./config";
import { createSupabaseServerClient } from "./server";

export type AdminAuthorization =
  | { status: "unconfigured" }
  | { status: "signed_out" }
  | { status: "not_admin" }
  | { status: "check_failed" }
  | { status: "admin"; client: SupabaseClient; userId: string };

export async function getAdminAuthorization(): Promise<AdminAuthorization> {
  if (!isSupabaseConfigured()) return { status: "unconfigured" };
  const client = await createSupabaseServerClient();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError) {
    if (
      userError.name === "AuthSessionMissingError" ||
      userError.status === 400 ||
      userError.message?.toLowerCase().includes("session missing")
    ) {
      return { status: "signed_out" };
    }
    return { status: "check_failed" };
  }
  if (!userData?.user) return { status: "signed_out" };

  const { data: membership, error: membershipError } = await client
    .from("admin_users")
    .select("user_id")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (membershipError) return { status: "check_failed" };
  if (!membership) return { status: "not_admin" };
  return { status: "admin", client, userId: userData.user.id };
}

import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getSupabasePublicConfig } from "./config";

/** Anonymous public reads intentionally do not forward an authenticated user's cookies. */
export function createSupabasePublicClient() {
  const { url, publishableKey } = getSupabasePublicConfig();
  return createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

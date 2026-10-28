import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAuthLinkErrorKind } from "@/lib/supabase/auth-link-error";
import { getSafeAuthDestination } from "@/lib/supabase/auth-destination";

function loginErrorRedirect(request: NextRequest, kind: "expired" | "invalid") {
  const status = kind === "expired" ? "expired" : "failed";
  return NextResponse.redirect(new URL(`/admin/login?auth=${status}`, request.url));
}

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured()) return NextResponse.redirect(new URL("/admin/login?setup=required", request.url));
  const suppliedErrorCode = request.nextUrl.searchParams.get("error_code");
  if (request.nextUrl.searchParams.has("error") || suppliedErrorCode) {
    return loginErrorRedirect(request, getAuthLinkErrorKind(suppliedErrorCode));
  }
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return loginErrorRedirect(request, "invalid");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return loginErrorRedirect(request, getAuthLinkErrorKind(error.code));
  const destination = getSafeAuthDestination(request.nextUrl.searchParams.get("next"));
  return NextResponse.redirect(new URL(destination, request.url));
}

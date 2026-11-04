import { getAdminAuthorization } from "@/lib/supabase/admin-auth";

export const dynamic = "force-dynamic";

function csv(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export async function GET() {
  let authorization;
  try { authorization = await getAdminAuthorization(); }
  catch { return new Response("Admin authorization could not be checked.", { status: 503, headers: { "Cache-Control": "no-store" } }); }
  if (authorization.status !== "admin") {
    return new Response("Admin access is required.", { status: authorization.status === "signed_out" ? 401 : 403, headers: { "Cache-Control": "no-store" } });
  }

  const rows: { id: string; profile_url: string | null }[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await authorization.client.from("participants")
      .select("id,profile_url")
      .order("id", { ascending: true })
      .range(from, from + 499);
    if (error || !data) return new Response("Roster export is unavailable.", { status: 503, headers: { "Cache-Control": "no-store" } });
    rows.push(...data);
    if (data.length < 500) break;
  }

  const body = ["participant_id,profile_url", ...rows.map((row) => `${csv(row.id)},${csv(row.profile_url ?? "")}`)].join("\r\n") + "\r\n";
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="verified-badge-roster.csv"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

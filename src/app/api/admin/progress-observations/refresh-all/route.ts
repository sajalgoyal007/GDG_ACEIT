import { NextResponse, type NextRequest } from "next/server";
import { isAutoProgressEnabled } from "@/lib/auto-progress/config";
import { claimRefreshJob, releaseRefreshJob, renewRefreshJob } from "@/lib/auto-progress/refresh-job-lock";
import { claimObservationBatch, executeObservationBatch, startOrResumeObservationJob } from "@/lib/auto-progress/progress-observation-job";
import { getAdminAuthorization } from "@/lib/supabase/admin-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { isWorkerKeyConfigured } from "@/lib/supabase/worker-config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function response(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (!request.headers.get("origin") || request.headers.get("origin") !== request.nextUrl.origin) {
    return response(403, { status: "invalid_origin", message: "This progress refresh request was rejected." });
  }
  const authorization = await getAdminAuthorization();
  if (authorization.status !== "admin") {
    return response(authorization.status === "signed_out" ? 401 : authorization.status === "not_admin" ? 403 : 503, {
      status: authorization.status, message: "Administrator access could not be verified. No profiles were fetched.",
    });
  }
  if (!isAutoProgressEnabled()) {
    return response(503, { status: "disabled", message: "Public-profile observation is disabled. No profiles were fetched." });
  }
  if (!isWorkerKeyConfigured(process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    return response(503, {
      status: "worker_unconfigured",
      message: "Refresh All is unavailable until the local worker configuration is completed. No profiles were fetched.",
    });
  }

  let service: ReturnType<typeof createSupabaseServiceClient>;
  try {
    service = createSupabaseServiceClient();
  } catch {
    return response(503, {
      status: "worker_unconfigured",
      message: "Refresh All is unavailable until the local worker configuration is completed. No profiles were fetched.",
    });
  }

  let lock;
  try {
    lock = await claimRefreshJob(service);
  } catch {
    return response(503, {
      status: "temporarily_unavailable",
      message: "The local progress worker could not be reached. No profiles were fetched.",
    });
  }
  if (lock.status !== "claimed") {
    return response(lock.status === "busy" ? 409 : 503, {
      status: lock.status === "busy" ? "busy" : "temporarily_unavailable",
      message: lock.status === "busy" ? "Another progress refresh is running. Retry when it finishes." : "A refresh lease could not be acquired.",
      ...(lock.status === "busy" ? { retryAfterSeconds: lock.retryAfterSeconds } : {}),
    });
  }

  try {
    const suppliedKey = request.headers.get("idempotency-key") ?? "";
    const key = /^[0-9a-f-]{36}$/i.test(suppliedKey) ? suppliedKey : crypto.randomUUID();
    const dedupeKey = `admin:${authorization.userId}:${key}`;
    const current = await startOrResumeObservationJob(service, lock.token, authorization.userId, dedupeKey);
    if (current.status === "busy") return response(409, { status: "busy", message: "Another administrator owns the active observation run." });
    if (current.status === "stale_lease" || !current.id) return response(409, { status: "lock_lost", message: "The refresh lease expired before work began." });
    if (current.status !== "running") return response(current.status === "partial" ? 207 : 200, {
      status: current.status, message: current.total === 0 ? "No registered profiles were available." : "This observation run is already complete.",
      jobId: current.id, total: current.total, observed: current.observed, failed: current.failed, skipped: current.skipped,
      processed: current.observed + current.failed + current.skipped, results: [],
    });

    const items = await claimObservationBatch(service, current.id, lock.token, 8);
    const results = await executeObservationBatch({
      writer: service,
      adminClient: authorization.client,
      actorUserId: authorization.userId,
      jobId: current.id,
      lockToken: lock.token,
      items,
      renewLease: () => renewRefreshJob(service, lock.token),
      concurrency: 4,
      timeoutMs: 12_000,
    });
    const latest = await startOrResumeObservationJob(service, lock.token, authorization.userId, dedupeKey);
    const status = latest.status === "completed" ? "completed" : latest.status === "partial" ? "partial" : results.length ? "running" : "waiting";
    return response(status === "completed" ? 200 : status === "partial" ? 207 : 202, {
      status,
      message: status === "waiting" ? "Remaining profiles are waiting for a safe retry or lease recovery."
        : status === "partial" ? "The run completed with failed or skipped profiles."
          : status === "completed" ? "All registered profiles were processed as unverified observations."
            : "The next registered-profile batch is ready.",
      jobId: latest.id,
      total: latest.total,
      observed: latest.observed,
      failed: latest.failed,
      skipped: latest.skipped,
      processed: latest.observed + latest.failed + latest.skipped,
      results,
      ...(status === "waiting" ? { retryAfterSeconds: 60 } : {}),
    });
  } catch {
    return response(503, { status: "temporarily_unavailable", message: "The observation batch could not complete. Previously recorded observations remain unchanged." });
  } finally {
    await releaseRefreshJob(service, lock.token);
  }
}

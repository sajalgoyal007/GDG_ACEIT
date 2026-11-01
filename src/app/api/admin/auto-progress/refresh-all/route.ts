import { NextResponse, type NextRequest } from "next/server";
import { handleRefreshAllRequest } from "@/lib/auto-progress/refresh-all-handler";
import { claimRefreshJob, releaseRefreshJob } from "@/lib/auto-progress/refresh-job-lock";
import { googleSkillsAutoProgressProvider } from "@/lib/auto-progress/provider";
import { isAutoProgressEnabled } from "@/lib/auto-progress/config";
import { getAdminAuthorization } from "@/lib/supabase/admin-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { startOrResumeDurableJob } from "@/lib/auto-progress/durable-job";
import { executeDurableRefreshBatch } from "@/lib/auto-progress/refresh-job-executor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function response(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  try {
    const authorization = await getAdminAuthorization();
    const result = await handleRefreshAllRequest({
      origin: request.headers.get("origin"),
      requestOrigin: request.nextUrl.origin,
      authorize: async () => authorization.status,
      enabled: isAutoProgressEnabled(),
      providerAvailable: googleSkillsAutoProgressProvider.availability === "available",
      execute: async () => {
        if (authorization.status !== "admin") throw new Error("Admin authorization unavailable.");
        const service = createSupabaseServiceClient();
        const lock = await claimRefreshJob(service);
        if (lock.status !== "claimed") {
          if (lock.status === "busy") throw Object.assign(new Error("refresh_job_busy"), { retryAfterSeconds: lock.retryAfterSeconds });
          throw new Error("refresh_job_lock_failed");
        }
        try {
          const requestKey = request.headers.get("idempotency-key") ?? crypto.randomUUID();
          const dedupeKey = `admin:${authorization.userId}:${/^[0-9a-f-]{36}$/i.test(requestKey) ? requestKey : crypto.randomUUID()}`;
          const current = await startOrResumeDurableJob(service, lock.token, "admin", dedupeKey);
          if (!current.id) return {
            status: "lock_lost" as const, total: 0, fetched: 0, validated: 0, updated: 0, unchanged: 0,
            refreshed: 0, failed: 0, skipped: 0, results: [], processed: 0,
          };
          if (current.complete) return {
            status: current.status === "partial" ? "partial" as const : "completed" as const,
            total: current.total, fetched: current.fetched, validated: current.validated,
            updated: current.saved, unchanged: current.unchanged, refreshed: current.saved + current.unchanged,
            failed: current.failed, skipped: current.skipped, results: [], jobId: current.id,
            processed: current.saved + current.unchanged + current.failed + current.skipped,
          };

          const batch = await executeDurableRefreshBatch({ writer: service, jobId: current.id, lockToken: lock.token, concurrency: 4, timeoutMs: 15_000 });
          const latest = await startOrResumeDurableJob(service, lock.token, "admin", dedupeKey);
          const jobStatus = !latest.id ? "lock_lost" as const
            : latest.complete ? latest.status === "partial" ? "partial" as const : "completed" as const
              : batch.items.length === 0 ? "waiting" as const : "running" as const;
          return {
            status: jobStatus,
            total: latest.total,
            fetched: latest.fetched,
            validated: latest.validated,
            updated: latest.saved,
            unchanged: latest.unchanged,
            refreshed: latest.saved + latest.unchanged,
            failed: latest.failed,
            skipped: latest.skipped,
            results: batch.results.map((item) => ({
              participantId: item.participantId,
              status: item.status === "saved" ? "refreshed" as const : item.status,
              message: item.message,
              fetched: item.fetched,
              updated: item.status === "saved",
            })),
            jobId: latest.id ?? current.id,
            processed: latest.saved + latest.unchanged + latest.failed + latest.skipped,
            ...(jobStatus === "waiting" ? { retryAfterSeconds: 15 } : {}),
          };
        } finally {
          await releaseRefreshJob(service, lock.token);
        }
      },
    });
    return response(result.status, result.body);
  } catch (error) {
    const retryAfterSeconds = error && typeof error === "object" && "retryAfterSeconds" in error
      ? Number(error.retryAfterSeconds)
      : undefined;
    return response(error instanceof Error && error.message === "refresh_job_busy" ? 409 : 503, {
      status: error instanceof Error && error.message === "refresh_job_busy" ? "busy" : "temporarily_unavailable",
      message: error instanceof Error && error.message === "refresh_job_busy"
        ? "Another Refresh All job is running. Retry after the current job lease expires."
        : "Refresh All could not complete. Any previous successful snapshots remain unchanged.",
      ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
    });
  }
}

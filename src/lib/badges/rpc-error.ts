/**
 * Clean admin-facing text for badge sync RPC failures.
 *
 * Raw PostgREST/SQLSTATE messages are never shown. A stale preview/rollback and
 * a reused request id are domain conflicts, not opaque database errors.
 */
export function badgeSyncRpcErrorMessage(
  error: { code?: string | null; message?: string | null } | null,
  fallback: string,
): string {
  const code = error?.code ?? "";
  const message = error?.message ?? "";
  if (code === "40001" || /changed after preview|preview changed|rollback is blocked|stale/i.test(message)) {
    return "This preview is stale: participant state changed after approval. Preview the run again; nothing was changed.";
  }
  if (code === "22023" && /request id/i.test(message)) {
    return "This operation request was already used. Preview the run again; nothing was changed.";
  }
  if (code === "42501") {
    return "Admin access could not be verified. Nothing was changed.";
  }
  return fallback;
}

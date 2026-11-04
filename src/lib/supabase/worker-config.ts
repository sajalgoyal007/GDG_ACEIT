/** Checks availability without returning or exposing the server-only key. */
export function isWorkerKeyConfigured(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** The UI gate mirrors the route's independent feature and worker-key checks. */
export function isRefreshAllAvailable(autoProgressEnabled: boolean, workerKey: string | undefined): boolean {
  return autoProgressEnabled && isWorkerKeyConfigured(workerKey);
}

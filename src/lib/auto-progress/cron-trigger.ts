import { timingSafeEqual } from "node:crypto";

export type CronAuthorization = "authorized" | "unconfigured" | "unauthorized";
export type CronProviderGate = "ready" | "disabled" | "provider_unavailable";

export function cronProviderGate(enabled: boolean, providerAvailable: boolean): CronProviderGate {
  if (!enabled) return "disabled";
  return providerAvailable ? "ready" : "provider_unavailable";
}

/** Compare Vercel's bearer token without logging or reflecting its value. */
export function authorizeCronRequest(authorization: string | null, configuredSecret: string | undefined): CronAuthorization {
  if (!configuredSecret || Buffer.byteLength(configuredSecret, "utf8") < 16) return "unconfigured";
  if (!authorization || authorization.length > 1024) return "unauthorized";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match) return "unauthorized";
  const supplied = Buffer.from(match[1], "utf8");
  const expected = Buffer.from(configuredSecret, "utf8");
  if (supplied.length !== expected.length) return "unauthorized";
  return timingSafeEqual(supplied, expected) ? "authorized" : "unauthorized";
}

/** Stable key makes duplicate Cron deliveries in one six-hour UTC window idempotent. */
export function scheduledRefreshDedupeKey(now: number | Date = Date.now()): string {
  const timestamp = now instanceof Date ? now.getTime() : now;
  if (!Number.isFinite(timestamp)) throw new Error("Invalid schedule timestamp.");
  const windowMs = 6 * 60 * 60 * 1000;
  return `scheduled:${new Date(Math.floor(timestamp / windowMs) * windowMs).toISOString()}`;
}

import { isAutoProgressEnabled } from "./config.ts";
import { validateGoogleSkillsProfileUrl } from "./profile-url.ts";

export type FetchFailure =
  | "disabled"
  | "invalid_url"
  | "unsafe_redirect"
  | "too_many_redirects"
  | "provider_unavailable"
  | "timeout"
  | "too_large"
  | "private"
  | "not_found"
  | "rate_limited"
  | "blocked"
  | "upstream_error";
export type ProfileFetchResult =
  | { status: "ok"; html: string; normalizedProfileUrl: string }
  | { status: FetchFailure; retryAfter?: string };

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const HARD_MAX_BYTES = 1_000_000;
const HARD_MAX_TIMEOUT_MS = 15_000;
const HARD_MAX_REDIRECTS = 3;

function boundedNumber(value: number | undefined, fallback: number, minimum: number, maximum: number, integer = false) {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  const normalized = integer ? Math.trunc(value) : value;
  return Math.min(maximum, Math.max(minimum, normalized));
}

export async function fetchPublicProfileHtml(
  input: string,
  options: {
    fetchImpl?: FetchLike;
    timeoutMs?: number;
    maxBytes?: number;
    maxRedirects?: number;
    signal?: AbortSignal;
  } = {},
): Promise<ProfileFetchResult> {
  if (!isAutoProgressEnabled()) return { status: "disabled" };
  const initial = validateGoogleSkillsProfileUrl(input);
  if (!initial.ok) return { status: "invalid_url" };

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = boundedNumber(options.timeoutMs, 10_000, 1, HARD_MAX_TIMEOUT_MS);
  const maxBytes = boundedNumber(options.maxBytes, HARD_MAX_BYTES, 1, HARD_MAX_BYTES, true);
  const maxRedirects = boundedNumber(options.maxRedirects, HARD_MAX_REDIRECTS, 0, HARD_MAX_REDIRECTS, true);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromCaller = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  let current = initial.value.href;

  try {
    for (let redirects = 0; ; redirects += 1) {
      const response = await fetchImpl(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { accept: "text/html" },
      });
      if (REDIRECT_STATUSES.has(response.status)) {
        await response.body?.cancel();
        if (redirects >= maxRedirects) return { status: "too_many_redirects" };
        const location = response.headers.get("location");
        if (!location) return { status: "unsafe_redirect" };
        let destination: URL;
        try {
          destination = new URL(location, current);
        } catch {
          return { status: "unsafe_redirect" };
        }
        const checked = validateGoogleSkillsProfileUrl(destination.href);
        if (!checked.ok || checked.value.normalizedUrl !== initial.value.normalizedUrl) {
          return { status: "unsafe_redirect" };
        }
        current = checked.value.href;
        continue;
      }
      if (response.status === 401) { await response.body?.cancel(); return { status: "private" }; }
      if (response.status === 403) { await response.body?.cancel(); return { status: "blocked" }; }
      if (response.status === 404) { await response.body?.cancel(); return { status: "not_found" }; }
      if (response.status === 429) {
        const retryAfter = response.headers.get("retry-after");
        await response.body?.cancel();
        return retryAfter ? { status: "rate_limited", retryAfter } : { status: "rate_limited" };
      }
      if (!response.ok) { await response.body?.cancel(); return { status: "upstream_error" }; }
      if (!(response.headers.get("content-type") ?? "").toLowerCase().includes("text/html")) {
        await response.body?.cancel();
        return { status: "upstream_error" };
      }
      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        await response.body?.cancel();
        return { status: "too_large" };
      }
      if (!response.body) return { status: "upstream_error" };

      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > maxBytes) {
          await reader.cancel();
          return { status: "too_large" };
        }
        chunks.push(part.value);
      }
      const combined = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return {
        status: "ok",
        html: new TextDecoder("utf-8", { fatal: false }).decode(combined),
        normalizedProfileUrl: initial.value.normalizedUrl,
      };
    }
  } catch {
    return { status: controller.signal.aborted ? "timeout" : "upstream_error" };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

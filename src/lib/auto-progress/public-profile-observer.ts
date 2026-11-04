import { parseObservedGoogleSkillsProfileHtml, type ObservedGoogleProfileParse } from "./parser.ts";
import { fetchPublicProfileHtml, type FetchFailure, type FetchLike } from "./safe-fetch.ts";

export type PublicProfileDiagnosticResult =
  | { status: "incomplete"; observation: ObservedGoogleProfileParse; httpStatus: number; retrievedAt: string; normalizedProfileUrl: string }
  | { status: FetchFailure; retryAfter?: string };

/**
 * Safe, diagnostic-only acquisition through the existing URL/redirect/size/
 * timeout guard. It can never return an AutoProgressProvider snapshot.
 */
export async function inspectGoogleSkillsPublicProfile(
  profileUrl: string,
  options: { fetchImpl?: FetchLike; timeoutMs?: number; maxBytes?: number; maxRedirects?: number; signal?: AbortSignal } = {},
): Promise<PublicProfileDiagnosticResult> {
  const result = await fetchPublicProfileHtml(profileUrl, options);
  if (result.status !== "ok") return result;
  return {
    status: "incomplete",
    observation: parseObservedGoogleSkillsProfileHtml(result.html, profileUrl),
    httpStatus: result.httpStatus,
    retrievedAt: new Date().toISOString(),
    normalizedProfileUrl: result.normalizedProfileUrl,
  };
}

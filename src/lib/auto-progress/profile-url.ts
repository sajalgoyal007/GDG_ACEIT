const PROFILE_PATH = /^\/public_profiles\/([A-Za-z0-9_-]+)\/?$/;
const ALLOWED_HOSTS = new Set([
  "skills.google",
  "www.skills.google",
  "cloudskillsboost.google",
  "www.cloudskillsboost.google",
]);

export type ProfileUrlError =
  | "invalid_url"
  | "unsupported_protocol"
  | "unsupported_host"
  | "credentials_not_allowed"
  | "port_not_allowed"
  | "query_or_fragment_not_allowed"
  | "invalid_profile_path";

export type ValidatedProfileUrl = {
  href: string;
  normalizedUrl: string;
  profileId: string;
};

export type ProfileUrlResult =
  | { ok: true; value: ValidatedProfileUrl }
  | { ok: false; error: ProfileUrlError };

/** Strict allowlist validation; normalizes the two supported domains to one identity. */
export function validateGoogleSkillsProfileUrl(input: string): ProfileUrlResult {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, error: "invalid_url" };
  }
  if (url.protocol !== "https:") return { ok: false, error: "unsupported_protocol" };
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) return { ok: false, error: "unsupported_host" };
  if (url.username || url.password || /\/\/[^/?#]*@/.test(input)) return { ok: false, error: "credentials_not_allowed" };
  if (url.port) return { ok: false, error: "port_not_allowed" };
  if (url.search || url.hash || /[?#]/.test(input)) return { ok: false, error: "query_or_fragment_not_allowed" };
  const match = PROFILE_PATH.exec(url.pathname);
  if (!match) return { ok: false, error: "invalid_profile_path" };

  const profileId = match[1];
  return {
    ok: true,
    value: {
      href: url.href,
      profileId,
      normalizedUrl: `https://skills.google/public_profiles/${profileId}`,
    },
  };
}

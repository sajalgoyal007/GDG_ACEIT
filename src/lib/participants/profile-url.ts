export function normalizeSkillsProfileUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Profile URL must be a valid HTTPS Google Skills public profile URL.");
  }
  const allowedHost = url.hostname === "cloudskillsboost.google" || url.hostname === "www.cloudskillsboost.google";
  const allowedPath = /^\/public_profiles\/[A-Za-z0-9_-]+\/?$/.test(url.pathname);
  if (url.protocol !== "https:" || !allowedHost || !allowedPath || url.search || url.hash || url.port) {
    throw new Error("Profile URL must use https://www.cloudskillsboost.google/public_profiles/… .");
  }
  return `https://www.cloudskillsboost.google${url.pathname.replace(/\/$/, "")}`;
}

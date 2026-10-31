export function normalizeSkillsProfileUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Profile URL must be a valid HTTPS Google Skills public profile URL.");
  }
  const isCloudSkillsBoost = url.hostname === "cloudskillsboost.google" || url.hostname === "www.cloudskillsboost.google";
  const isSkills = url.hostname === "skills.google" || url.hostname === "www.skills.google";
  const allowedPath = /^\/public_profiles\/[A-Za-z0-9_-]+\/?$/.test(url.pathname);
  if (url.protocol !== "https:" || (!isCloudSkillsBoost && !isSkills) || !allowedPath || url.search || url.hash || url.port) {
    throw new Error("Profile URL must use https://www.cloudskillsboost.google/public_profiles/… or https://www.skills.google/public_profiles/… .");
  }
  const host = isSkills ? "www.skills.google" : "www.cloudskillsboost.google";
  return `https://${host}${url.pathname.replace(/\/$/, "")}`;
}

/** Fetching stays off unless explicitly enabled and source authorization is documented. */
export function isAutoProgressEnabled() {
  return process.env.AUTO_PROGRESS_ENABLED === "true"
    && process.env.GOOGLE_SKILLS_PROFILE_FETCH_AUTHORIZED === "true";
}

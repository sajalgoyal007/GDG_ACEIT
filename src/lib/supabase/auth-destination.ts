/** Only destinations used by the app's own Auth flows are accepted. */
export function getSafeAuthDestination(value: string | null) {
  return value === "/admin/update-password" ? value : "/admin";
}

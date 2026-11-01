/** False unless an operator deliberately enables the isolated worker. */
export function isAutoProgressEnabled() {
  return process.env.AUTO_PROGRESS_ENABLED === "true";
}

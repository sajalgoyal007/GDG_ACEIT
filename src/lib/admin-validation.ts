export function parseVerifiedBadgeCount(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{1,5}$/.test(value)) return null;
  const count = Number(value);
  return count <= 10000 ? count : null;
}

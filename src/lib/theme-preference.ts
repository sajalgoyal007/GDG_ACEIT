export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

/**
 * Reads a persisted preference. Anything missing or unrecognized is treated as
 * the first-visit default: follow the operating system.
 */
export function normalizeThemePreference(value: string | null | undefined): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

/**
 * Resolves the applied theme. System mode always reads the current OS setting,
 * so the same stored preference can produce different themes over time.
 */
export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

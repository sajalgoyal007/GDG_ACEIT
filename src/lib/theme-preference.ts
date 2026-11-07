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

/**
 * The document state that drives the stylesheet. `data-theme` selects the
 * light/dark appearance while `data-theme-preference` keeps manual Dark and
 * System-on-a-dark-OS visually distinct even though both resolve to dark.
 */
export type ThemeAttributes = {
  theme: ResolvedTheme;
  themePreference: ThemePreference;
};

export function resolveThemeAttributes(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ThemeAttributes {
  return { theme: resolveTheme(preference, systemPrefersDark), themePreference: preference };
}

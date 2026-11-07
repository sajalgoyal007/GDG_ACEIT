"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { normalizeThemePreference, resolveThemeAttributes, type ThemePreference } from "@/lib/theme-preference";

export type { ThemePreference };
type ThemeContextValue = { preference: ThemePreference; setPreference: (value: ThemePreference) => void };

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = "gdg-aceit-theme";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>("system");

  const apply = useCallback((value: ThemePreference) => {
    const { theme, themePreference } = resolveThemeAttributes(
      value,
      window.matchMedia("(prefers-color-scheme: dark)").matches,
    );
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.themePreference = themePreference;
  }, []);

  useEffect(() => {
    const initial = normalizeThemePreference(window.localStorage.getItem(STORAGE_KEY));
    setPreferenceState(initial);
    apply(initial);
  }, [apply]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const followSystem = () => { if (preference === "system") apply("system"); };
    media.addEventListener("change", followSystem);
    return () => media.removeEventListener("change", followSystem);
  }, [apply, preference]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      const next = normalizeThemePreference(event.newValue);
      setPreferenceState(next);
      apply(next);
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [apply]);

  const setPreference = useCallback((value: ThemePreference) => {
    setPreferenceState(value);
    window.localStorage.setItem(STORAGE_KEY, value);
    apply(value);
  }, [apply]);

  return <ThemeContext.Provider value={{ preference, setPreference }}>{children}</ThemeContext.Provider>;
}

export function useThemePreference() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useThemePreference must be used within ThemeProvider");
  return context;
}

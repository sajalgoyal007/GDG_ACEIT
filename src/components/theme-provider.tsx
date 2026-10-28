"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type ThemePreference = "light" | "dark" | "system";
type ThemeContextValue = { preference: ThemePreference; setPreference: (value: ThemePreference) => void };

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = "gdg-aceit-theme";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>("system");

  const apply = useCallback((value: ThemePreference) => {
    const resolved = value === "system"
      ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : value;
    document.documentElement.dataset.theme = resolved;
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    const initial: ThemePreference = saved === "light" || saved === "dark" ? saved : "system";
    setPreferenceState(initial);
    apply(initial);
  }, [apply]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const followSystem = () => { if (preference === "system") apply("system"); };
    media.addEventListener("change", followSystem);
    return () => media.removeEventListener("change", followSystem);
  }, [apply, preference]);

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

"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useThemePreference, type ThemePreference } from "@/components/theme-provider";

const options: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
];

export function ThemeControl() {
  const { preference, setPreference } = useThemePreference();
  const Icon = options.find((option) => option.value === preference)?.Icon ?? Monitor;
  return <label className="theme-control">
    <Icon size={15} aria-hidden="true" />
    <span className="sr-only">Color theme</span>
    <select aria-label="Color theme" value={preference} onChange={(event) => setPreference(event.target.value as ThemePreference)}>
      {options.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
    </select>
  </label>;
}

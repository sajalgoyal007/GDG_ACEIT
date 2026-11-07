import assert from "node:assert/strict";
import test from "node:test";
import { normalizeThemePreference, resolveTheme, resolveThemeAttributes } from "./theme-preference.ts";

test("a first visit with no saved value defaults to System", () => {
  assert.equal(normalizeThemePreference(null), "system");
  assert.equal(normalizeThemePreference(undefined), "system");
  assert.equal(normalizeThemePreference(""), "system");
});

test("only explicit light and dark preferences are restored", () => {
  assert.equal(normalizeThemePreference("light"), "light");
  assert.equal(normalizeThemePreference("dark"), "dark");
  assert.equal(normalizeThemePreference("sepia"), "system");
});

test("System follows the operating system in both directions", () => {
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
});

test("explicit modes ignore the operating system setting", () => {
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("dark", false), "dark");
});

test("the same stored preference resolves differently when the OS changes", () => {
  const preference = normalizeThemePreference("system");
  assert.equal(resolveTheme(preference, false), "light");
  assert.equal(resolveTheme(preference, true), "dark");
});

test("System on a dark OS is marked differently from manually selected Dark", () => {
  const manualDark = resolveThemeAttributes("dark", true);
  const systemDark = resolveThemeAttributes("system", true);

  // Both render the dark appearance, but the preference attribute keeps the
  // System palette distinct in CSS.
  assert.deepEqual(manualDark, { theme: "dark", themePreference: "dark" });
  assert.deepEqual(systemDark, { theme: "dark", themePreference: "system" });
  assert.notDeepEqual(manualDark, systemDark);
});

test("System on a light OS is visually identified as System, not Light", () => {
  assert.deepEqual(resolveThemeAttributes("system", false), {
    theme: "light",
    themePreference: "system",
  });
  assert.deepEqual(resolveThemeAttributes("light", false), {
    theme: "light",
    themePreference: "light",
  });
});

test("manual modes keep their preference attribute when the OS disagrees", () => {
  assert.deepEqual(resolveThemeAttributes("light", true), {
    theme: "light",
    themePreference: "light",
  });
  assert.deepEqual(resolveThemeAttributes("dark", false), {
    theme: "dark",
    themePreference: "dark",
  });
});

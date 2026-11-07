import assert from "node:assert/strict";
import test from "node:test";
import { normalizeThemePreference, resolveTheme } from "./theme-preference.ts";

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

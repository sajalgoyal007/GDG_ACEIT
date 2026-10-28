import assert from "node:assert/strict";
import test from "node:test";
import { getSafeAuthDestination } from "./auth-destination.ts";

test("Auth callback allows the fixed password recovery destination", () => {
  assert.equal(getSafeAuthDestination("/admin/update-password"), "/admin/update-password");
});

test("Auth callback sends every other destination to the admin route", () => {
  for (const value of [null, "/", "/admin/other", "https://example.invalid", "//example.invalid", "\\\\example.invalid"]) {
    assert.equal(getSafeAuthDestination(value), "/admin");
  }
});

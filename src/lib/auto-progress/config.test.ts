import assert from "node:assert/strict";
import test from "node:test";
import { isAutoProgressEnabled } from "./config.ts";

test("live profile fetching requires both explicit enablement and source authorization", () => {
  const previousEnabled = process.env.AUTO_PROGRESS_ENABLED;
  const previousAuthorized = process.env.GOOGLE_SKILLS_PROFILE_FETCH_AUTHORIZED;
  try {
    process.env.AUTO_PROGRESS_ENABLED = "true";
    delete process.env.GOOGLE_SKILLS_PROFILE_FETCH_AUTHORIZED;
    assert.equal(isAutoProgressEnabled(), false);
    process.env.GOOGLE_SKILLS_PROFILE_FETCH_AUTHORIZED = "true";
    assert.equal(isAutoProgressEnabled(), true);
    process.env.AUTO_PROGRESS_ENABLED = "false";
    assert.equal(isAutoProgressEnabled(), false);
  } finally {
    if (previousEnabled === undefined) delete process.env.AUTO_PROGRESS_ENABLED;
    else process.env.AUTO_PROGRESS_ENABLED = previousEnabled;
    if (previousAuthorized === undefined) delete process.env.GOOGLE_SKILLS_PROFILE_FETCH_AUTHORIZED;
    else process.env.GOOGLE_SKILLS_PROFILE_FETCH_AUTHORIZED = previousAuthorized;
  }
});

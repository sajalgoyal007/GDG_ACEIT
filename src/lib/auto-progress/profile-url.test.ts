import assert from "node:assert/strict";
import test from "node:test";
import { validateGoogleSkillsProfileUrl } from "./profile-url.ts";

for (const host of ["skills.google", "www.skills.google", "cloudskillsboost.google", "www.cloudskillsboost.google"]) {
  test(`accepts a canonical HTTPS profile on ${host}`, () => {
    const result = validateGoogleSkillsProfileUrl(`https://${host}/public_profiles/Profile_123`);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value.normalizedUrl, "https://skills.google/public_profiles/Profile_123");
  });
}

for (const [url, expected] of [
  ["http://skills.google/public_profiles/id", "unsupported_protocol"],
  ["https://example.com/public_profiles/id", "unsupported_host"],
  ["https://user:pass@skills.google/public_profiles/id", "credentials_not_allowed"],
  ["https://@skills.google/public_profiles/id", "credentials_not_allowed"],
  ["https://skills.google:8443/public_profiles/id", "port_not_allowed"],
  ["https://skills.google/public_profiles/id?next=x", "query_or_fragment_not_allowed"],
  ["https://skills.google/public_profiles/id?", "query_or_fragment_not_allowed"],
  ["https://skills.google/public_profiles/id/extra", "invalid_profile_path"],
  ["https://skills.google/public_profiles/%2e%2e", "invalid_profile_path"],
] as const) {
  test(`rejects unsafe or non-canonical URL: ${expected}`, () => {
    const result = validateGoogleSkillsProfileUrl(url);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, expected);
  });
}

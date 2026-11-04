import assert from "node:assert/strict";
import test from "node:test";
import { getObservationFailureMessage } from "./observation-message.ts";

test("an empty badge container remains unknown and is not reported as zero", () => {
  const message = getObservationFailureMessage("empty_unconfirmed");
  assert.match(message, /count (?:is )?unknown/i);
  assert.match(message, /nothing was recorded/i);
  assert.doesNotMatch(message, /zero badges/i);
});

test("blocked and incomplete source results never describe a badge count", () => {
  for (const status of ["blocked", "private", "not_found", "timeout", "upstream_error", "incomplete_relevant_markup"] as const) {
    const message = getObservationFailureMessage(status);
    assert.match(message, /nothing was recorded/i);
    assert.doesNotMatch(message, /zero badges|confirmed total/i);
  }
});

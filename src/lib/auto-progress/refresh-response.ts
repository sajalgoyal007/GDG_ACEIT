import type { ClaimResult, PersistResult } from "./service.ts";

export type RefreshHttpResult = {
  status: number;
  body: { status: string; message: string; retryAfterSeconds?: number };
};

/** Converts internal worker outcomes into a small, non-sensitive API contract. */
export function toRefreshHttpResult(result: ClaimResult | PersistResult): RefreshHttpResult {
  switch (result.status) {
    case "disabled":
      return { status: 503, body: { status: "disabled", message: "Automatic progress refresh is not enabled. No data was changed." } };
    case "provider_unavailable":
      return { status: 503, body: { status: "provider_unavailable", message: "A supported profile data provider is not available. Your last successful progress remains unchanged." } };
    case "busy":
      return { status: 409, body: { status: "busy", message: `A refresh is already in progress. Retry in ${result.retryAfterSeconds} seconds.`, retryAfterSeconds: result.retryAfterSeconds } };
    case "cooldown":
      return { status: 429, body: { status: "cooldown", message: `Please wait ${result.retryAfterSeconds} seconds before trying again.`, retryAfterSeconds: result.retryAfterSeconds } };
    case "duplicate_profile":
      return { status: 409, body: { status: "duplicate_profile", message: "This profile is linked to more than one registration and cannot be refreshed safely." } };
    case "no_profile":
      return { status: 409, body: { status: "no_profile", message: "There is no validated public profile linked to this registration." } };
    case "no_participant":
      return { status: 404, body: { status: "not_linked", message: "No registered participant is linked to this account." } };
    case "claim_failed":
    case "write_failed":
      return { status: 503, body: { status: "temporarily_unavailable", message: "The refresh could not be completed. Any previous successful progress is unchanged." } };
    case "cancelled":
      return { status: 503, body: { status: "timeout", message: "The refresh timed out. Any previous successful progress is unchanged." } };
    case "not_recorded":
      return { status: 409, body: { status: "not_recorded", message: "The profile changed or did not match the saved registration. No progress was updated." } };
    case "recorded": {
      const data = Array.isArray(result.result) ? result.result[0] : result.result;
      if (typeof data === "object" && data !== null && "result_status" in data && data.result_status === "ok") {
        return { status: 200, body: { status: "refreshed", message: "Progress was refreshed successfully." } };
      }
      return { status: 409, body: { status: "not_recorded", message: "The refresh became stale before it could be saved. Previous progress is unchanged." } };
    }
    case "claimed":
      return { status: 503, body: { status: "temporarily_unavailable", message: "The refresh could not be completed." } };
  }
}

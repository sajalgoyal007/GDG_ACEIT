import { validateGoogleSkillsProfileUrl } from "../auto-progress/profile-url.ts";

export const PROGRESS_OBSERVATION_SOURCES = ["arcadecalc_frontend", "google_skills_public_html"] as const;
export const PROGRESS_OBSERVATION_STATUSES = ["unverified", "partial", "failed", "blocked"] as const;

export type ProgressObservationSource = (typeof PROGRESS_OBSERVATION_SOURCES)[number];
export type ProgressObservationStatus = (typeof PROGRESS_OBSERVATION_STATUSES)[number];

export interface ProgressObservationDraft {
  participantKey: string;
  profileUrl: string;
  normalizedProfileUrl: string;
  sourceName: ProgressObservationSource;
  retrievedAt: string;
  httpStatus: number;
  reportedTotal: number | null;
  detailCount: number | null;
  uniqueBadgeCount: number | null;
  completenessStatus: ProgressObservationStatus;
  summaryNote: string | null;
}

export type ProgressObservationParseResult =
  | { ok: true; value: ProgressObservationDraft }
  | { ok: false; message: string };

function optionalCount(value: string): number | null | undefined {
  if (value.trim() === "") return null;
  if (!/^(0|[1-9][0-9]*)$/.test(value.trim())) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= 10000 ? parsed : undefined;
}

/** Validates one organizer-entered source observation. It can never be a verified badge snapshot. */
export function parseProgressObservationDraft(input: Record<string, string>): ProgressObservationParseResult {
  const participantKey = (input.participantKey ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._:-]{0,119}$/.test(participantKey)) {
    return { ok: false, message: "Select a valid registered participant key." };
  }

  const profileUrl = (input.profileUrl ?? "").trim();
  const validatedUrl = validateGoogleSkillsProfileUrl(profileUrl);
  if (!validatedUrl.ok) return { ok: false, message: "Enter the participant’s current HTTPS Google Skills public profile URL." };

  const sourceName = input.sourceName as ProgressObservationSource;
  if (!(PROGRESS_OBSERVATION_SOURCES as readonly string[]).includes(sourceName)) {
    return { ok: false, message: "Choose a supported diagnostic source." };
  }

  const retrievedTimestamp = Date.parse(input.retrievedAt ?? "");
  if (!Number.isFinite(retrievedTimestamp) || retrievedTimestamp > Date.now() + 5 * 60 * 1000) {
    return { ok: false, message: "Enter a valid source retrieval time no more than five minutes in the future." };
  }

  const httpStatusText = (input.httpStatus ?? "").trim();
  if (!/^\d{3}$/.test(httpStatusText) || Number(httpStatusText) < 100 || Number(httpStatusText) > 599) {
    return { ok: false, message: "HTTP status must be a number from 100 to 599." };
  }

  const completenessStatus = input.completenessStatus as ProgressObservationStatus;
  if (!(PROGRESS_OBSERVATION_STATUSES as readonly string[]).includes(completenessStatus)) {
    return { ok: false, message: "Choose unverified, partial, failed, or blocked status." };
  }

  const reportedTotal = optionalCount(input.reportedTotal ?? "");
  const detailCount = optionalCount(input.detailCount ?? "");
  const uniqueBadgeCount = optionalCount(input.uniqueBadgeCount ?? "");
  if (reportedTotal === undefined || detailCount === undefined || uniqueBadgeCount === undefined) {
    return { ok: false, message: "Badge values must be whole numbers from 0 to 10000." };
  }
  if (uniqueBadgeCount !== null && (detailCount === null || uniqueBadgeCount > detailCount)) {
    return { ok: false, message: "Unique badge count cannot exceed the returned detail count." };
  }
  if (completenessStatus === "failed" || completenessStatus === "blocked") {
    if (reportedTotal !== null || detailCount !== null || uniqueBadgeCount !== null) {
      return { ok: false, message: "Failed or blocked results cannot include badge counts." };
    }
  } else if (reportedTotal === null || detailCount === null || Number(httpStatusText) < 200 || Number(httpStatusText) >= 300) {
    return { ok: false, message: "Unverified or partial results require a successful HTTP response and both reported total and detail count." };
  }

  const summaryNote = (input.summaryNote ?? "").trim();
  if (summaryNote.length > 500 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(summaryNote)) {
    return { ok: false, message: "Summary note must be 500 characters or fewer and contain no control characters." };
  }

  return {
    ok: true,
    value: {
      participantKey,
      profileUrl: validatedUrl.value.href,
      normalizedProfileUrl: validatedUrl.value.normalizedUrl,
      sourceName,
      retrievedAt: new Date(retrievedTimestamp).toISOString(),
      httpStatus: Number(httpStatusText),
      reportedTotal,
      detailCount,
      uniqueBadgeCount,
      completenessStatus,
      summaryNote: summaryNote || null,
    },
  };
}

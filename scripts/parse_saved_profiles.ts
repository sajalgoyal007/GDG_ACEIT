/**
 * Parse saved Google Skills Boost raw HTML profiles using the repository's
 * official diagnostic parser (src/lib/auto-progress/parser.ts).
 *
 * Reads fetch_manifest.json and raw HTML files, extracts unique stable badge IDs,
 * detects genuine zero profiles vs inaccessible/failed ones, and writes parse_results.json.
 */

import fs from "node:fs";
import path from "node:path";
import { parseObservedGoogleSkillsProfileHtml, type ObservedGoogleProfileParse } from "../src/lib/auto-progress/parser.ts";

export interface ParsedProfileRecord {
  participantUuid: string;
  participantName: string;
  profileUrl: string;
  httpStatus: number;
  fetchError: string | null;
  parseStatus: "verified_nonzero" | "verified_zero" | "inaccessible" | "invalid_html" | "failed_fetch" | "identity_mismatch" | "incomplete";
  badgeCount: number;
  badgeCandidateCount: number;
  uniqueBadgeIds: string[];
  duplicateCount: number;
  identityStatus: "matched" | "mismatch" | "unverified";
  qualityWarnings: string[];
  details: {
    titles: string[];
    earnedDates: (string | null)[];
    reasons: string[];
  };
}

export interface ParseSummary {
  inspectedAt: string;
  manifestPath: string;
  totalProfiles: number;
  statusCounts: Record<string, number>;
  totalUniqueBadgesRecorded: number;
  results: Record<string, ParsedProfileRecord>;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let manifestPath = path.resolve("data/raw_profiles/fetch_manifest.json");
  let outputPath = path.resolve("data/raw_profiles/parse_results.json");

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--manifest" && args[i + 1]) {
      manifestPath = path.resolve(args[++i]);
    } else if (args[i] === "--output" && args[i + 1]) {
      outputPath = path.resolve(args[++i]);
    }
  }
  return { manifestPath, outputPath };
}

export function evaluateProfileHtml(
  uuid: string,
  name: string,
  profileUrl: string,
  httpStatus: number,
  htmlContent: string | null,
  fetchError: string | null
): ParsedProfileRecord {
  // 1. Handle HTTP / Network failures
  if (httpStatus !== 200 || !htmlContent) {
    const is404 = httpStatus === 404;
    const is403 = httpStatus === 403;
    return {
      participantUuid: uuid,
      participantName: name,
      profileUrl,
      httpStatus,
      fetchError: fetchError ?? `HTTP_${httpStatus}`,
      parseStatus: is404 || is403 ? "inaccessible" : "failed_fetch",
      badgeCount: 0,
      badgeCandidateCount: 0,
      uniqueBadgeIds: [],
      duplicateCount: 0,
      identityStatus: "unverified",
      qualityWarnings: [is404 ? "profile_not_found" : is403 ? "access_denied" : "fetch_failed"],
      details: { titles: [], earnedDates: [], reasons: [fetchError ?? `HTTP_${httpStatus}`] },
    };
  }

  // 2. Parse using official TypeScript parser
  const parse: ObservedGoogleProfileParse = parseObservedGoogleSkillsProfileHtml(htmlContent, profileUrl);

  const warnings = parse.qualityWarnings.map(String);
  const reasons: string[] = [parse.reason];

  // Check identity
  if (parse.identityStatus === "mismatch") {
    return {
      participantUuid: uuid,
      participantName: name,
      profileUrl,
      httpStatus,
      fetchError: null,
      parseStatus: "identity_mismatch",
      badgeCount: 0,
      badgeCandidateCount: parse.badgeCandidates,
      uniqueBadgeIds: [],
      duplicateCount: 0,
      identityStatus: "mismatch",
      qualityWarnings: warnings,
      details: { titles: [], earnedDates: [], reasons: ["Canonical URL mismatch in HTML"] },
    };
  }

  // Check security challenges or access restrictions
  if (warnings.includes("challenge_indicator") || warnings.includes("access_denied_indicator")) {
    return {
      participantUuid: uuid,
      participantName: name,
      profileUrl,
      httpStatus,
      fetchError: null,
      parseStatus: "inaccessible",
      badgeCount: 0,
      badgeCandidateCount: parse.badgeCandidates,
      uniqueBadgeIds: [],
      duplicateCount: 0,
      identityStatus: parse.identityStatus,
      qualityWarnings: warnings,
      details: { titles: [], earnedDates: [], reasons: warnings },
    };
  }

  // Check invalid/corrupted HTML
  if (parse.reason === "unexpected_html" || warnings.includes("incomplete_document_markup")) {
    return {
      participantUuid: uuid,
      participantName: name,
      profileUrl,
      httpStatus,
      fetchError: null,
      parseStatus: "invalid_html",
      badgeCount: 0,
      badgeCandidateCount: parse.badgeCandidates,
      uniqueBadgeIds: [],
      duplicateCount: 0,
      identityStatus: parse.identityStatus,
      qualityWarnings: warnings,
      details: { titles: [], earnedDates: [], reasons },
    };
  }

  // 3. Genuine zero badges check:
  // Profile loads 200, identity matched or verified, document complete, but no badges container or 0 candidates
  const isZeroContainer = parse.reason === "badge_container_missing" || parse.reason === "empty_unconfirmed";
  if (isZeroContainer && parse.badgeCandidates === 0 && !warnings.includes("incomplete_relevant_markup")) {
    return {
      participantUuid: uuid,
      participantName: name,
      profileUrl,
      httpStatus,
      fetchError: null,
      parseStatus: "verified_zero",
      badgeCount: 0,
      badgeCandidateCount: 0,
      uniqueBadgeIds: [],
      duplicateCount: 0,
      identityStatus: parse.identityStatus,
      qualityWarnings: warnings,
      details: { titles: [], earnedDates: [], reasons: ["Confirmed 0 badges: no badge container or empty list"] },
    };
  }

  // 4. Non-zero visible badges extraction & deduplication
  const validEntries = parse.entries.filter((entry) => !entry.explicitlyHidden);
  const titles = validEntries.map((e) => e.title ?? "Unknown Title");
  const earnedDates = validEntries.map((e) => e.earnedOn);

  // Extract stable IDs where available, or fallback to normalized title signatures
  const stableIds: string[] = [];
  const seenSignatures = new Set<string>();
  let duplicateCount = 0;

  for (const entry of validEntries) {
    if (entry.stableId) {
      if (stableIds.includes(entry.stableId)) {
        duplicateCount++;
      } else {
        stableIds.push(entry.stableId);
      }
    } else {
      // Fallback unique key for legacy badges lacking numeric URL IDs
      const signature = entry.title?.trim().toLowerCase() ?? `idx_${stableIds.length}`;
      if (seenSignatures.has(signature)) {
        duplicateCount++;
      } else {
        seenSignatures.add(signature);
        stableIds.push(`title:${signature}`);
      }
    }
  }

  const badgeCount = stableIds.length;

  return {
    participantUuid: uuid,
    participantName: name,
    profileUrl,
    httpStatus,
    fetchError: null,
    parseStatus: badgeCount > 0 ? "verified_nonzero" : "verified_zero",
    badgeCount,
    badgeCandidateCount: parse.badgeCandidates,
    uniqueBadgeIds: stableIds,
    duplicateCount,
    identityStatus: parse.identityStatus,
    qualityWarnings: warnings,
    details: {
      titles,
      earnedDates,
      reasons,
    },
  };
}

export function runParsing(manifestPath: string, outputPath: string): ParseSummary {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found at: ${manifestPath}`);
  }

  const manifestRaw = fs.readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(manifestRaw) as { profiles: Record<string, any> };
  const profiles = manifest.profiles ?? {};

  const results: Record<string, ParsedProfileRecord> = {};
  const statusCounts: Record<string, number> = {};
  let totalBadges = 0;

  for (const [uuid, item] of Object.entries(profiles)) {
    const name = item.participant_name ?? "Unknown";
    const url = item.profile_url ?? "";
    const status = Number(item.status ?? 0);
    const htmlPath = item.html_path as string | null;
    const fetchError = item.error as string | null;

    let htmlContent: string | null = null;
    if (htmlPath && fs.existsSync(htmlPath)) {
      htmlContent = fs.readFileSync(htmlPath, "utf8");
    }

    const record = evaluateProfileHtml(uuid, name, url, status, htmlContent, fetchError);
    results[uuid] = record;

    statusCounts[record.parseStatus] = (statusCounts[record.parseStatus] ?? 0) + 1;
    totalBadges += record.badgeCount;
  }

  const summary: ParseSummary = {
    inspectedAt: new Date().toISOString(),
    manifestPath,
    totalProfiles: Object.keys(results).length,
    statusCounts,
    totalUniqueBadgesRecorded: totalBadges,
    results,
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2) + "\n", "utf8");
  return summary;
}

// Run CLI if invoked directly
const { manifestPath, outputPath } = parseArgs();
try {
  const summary = runParsing(manifestPath, outputPath);
  console.log(`Successfully parsed ${summary.totalProfiles} profiles.`);
  console.log("Status distribution:", summary.statusCounts);
  console.log(`Total unique badges recorded: ${summary.totalUniqueBadgesRecorded}`);
  console.log(`Results saved to: ${outputPath}`);
} catch (err: any) {
  console.error("PARSE_ERROR:", err.message);
  process.exit(1);
}


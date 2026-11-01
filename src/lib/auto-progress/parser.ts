/**
 * Fixture-contract parser only. This is deliberately not a parser for the live
 * Google Skills page: no current upstream HTML structure is treated as stable.
 */
export type ParsedBadge = { key: string };
export type ParseResult =
  | { status: "complete"; badges: ParsedBadge[]; eligibleBadgeCount: number }
  | { status: "incomplete"; reason: "completion_marker_missing" | "malformed_badge_marker" };

function attributes(tag: string) {
  const result = new Map<string, string>();
  const pattern = /([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of tag.matchAll(pattern)) result.set(match[1].toLowerCase(), match[2] ?? match[3] ?? "");
  return result;
}

/**
 * Reads the explicit local-fixture contract: a complete marker and badge
 * articles with stable ids, earned=true, and eligible=true. Text, typography,
 * marketing content, and generic links can never be interpreted as badges.
 */
export function parseProfileFixture(html: string): ParseResult {
  const mainOpenings = [...html.matchAll(/<main\b[^>]*>/gi)];
  if (mainOpenings.length !== 1
    || !/data-auto-progress-complete\s*=\s*["']true["']/i.test(mainOpenings[0][0])
    || !/<\/main\s*>/i.test(html.slice((mainOpenings[0].index ?? 0) + mainOpenings[0][0].length))) {
    return { status: "incomplete", reason: "completion_marker_missing" };
  }
  const badges = new Map<string, ParsedBadge>();
  const markedBadges = [...html.matchAll(/<article\b[^>]*data-auto-badge(?:\s|=|>)[^>]*>/gi)];
  const completeBadges = [...html.matchAll(/<article\b[^>]*data-auto-badge(?:\s|=|>)[^>]*>[\s\S]*?<\/article\s*>/gi)];
  if (markedBadges.length !== completeBadges.length) return { status: "incomplete", reason: "malformed_badge_marker" };
  for (const match of completeBadges) {
    const openingTag = match[0].match(/^<article\b[^>]*>/i)?.[0] ?? "";
    const attrs = attributes(openingTag);
    const key = attrs.get("data-badge-id");
    if (!key || !/^[A-Za-z0-9._:-]{1,200}$/.test(key)) {
      return { status: "incomplete", reason: "malformed_badge_marker" };
    }
    if (attrs.get("data-earned") === "true" && attrs.get("data-eligible") === "true") {
      badges.set(key, { key });
    }
  }
  const result = [...badges.values()].sort((a, b) => a.key.localeCompare(b.key));
  return { status: "complete", badges: result, eligibleBadgeCount: result.length };
}

export type ObservedProfileInspection = {
  status: "incomplete";
  reason:
    | "unexpected_html"
    | "badge_container_missing"
    | "badge_container_ambiguous"
    | "empty_unconfirmed"
    | "badge_marker_mismatch"
    | "completeness_unverified";
  /** Diagnostic DOM-marker count only. Never persist or display as earned progress. */
  badgeCandidates: number;
  badgeImageMarkers: number;
};

const HTML_VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
  "meta", "param", "source", "track", "wbr",
]);

/**
 * Inspects only the class markers observed in one authorized public-profile
 * response. The response did not establish earned-state or pagination
 * completeness, so this function deliberately has no successful/zero state.
 * Candidate totals are diagnostic only and are not provider snapshots.
 */
export function inspectObservedGoogleProfileHtml(html: string): ObservedProfileInspection {
  if (typeof html !== "string" || html.length === 0 || html.length > 1_000_000
    || !/<(?:!doctype\s+html|html|body|div)\b/i.test(html)) {
    return { status: "incomplete", reason: "unexpected_html", badgeCandidates: 0, badgeImageMarkers: 0 };
  }

  const markup = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  const stack: { name: string; badgeContainer: boolean; badgeCandidate: boolean }[] = [];
  let badgeContainers = 0;
  let badgeCandidates = 0;
  let badgeImageMarkers = 0;
  let malformed = false;

  for (const match of markup.matchAll(/<\/?[a-z][a-z0-9:-]*\b[^>]*>/gi)) {
    const token = match[0];
    const parsed = token.match(/^<\s*(\/)?\s*([a-z][a-z0-9:-]*)\b([^>]*)>$/i);
    if (!parsed) {
      malformed = true;
      break;
    }
    const closing = Boolean(parsed[1]);
    const name = parsed[2].toLowerCase();
    if (closing) {
      let index = stack.length - 1;
      while (index >= 0 && stack[index].name !== name) index -= 1;
      if (index >= 0) stack.splice(index);
      continue;
    }

    const attrs = attributes(token);
    const classes = new Set((attrs.get("class") ?? "").split(/\s+/).filter(Boolean));
    const insideBadgeContainer = stack.some((entry) => entry.badgeContainer);
    const badgeContainer = name === "div" && classes.has("profile-badges");
    const badgeCandidate = insideBadgeContainer && name === "div" && classes.has("profile-badge");
    if (badgeContainer) badgeContainers += 1;
    if (badgeCandidate) badgeCandidates += 1;
    if (insideBadgeContainer && name === "a" && classes.has("badge-image")) badgeImageMarkers += 1;

    if (!HTML_VOID_ELEMENTS.has(name) && !/\/\s*>$/.test(token)) {
      stack.push({ name, badgeContainer, badgeCandidate });
    }
  }

  const base = { status: "incomplete" as const, badgeCandidates, badgeImageMarkers };
  if (malformed || stack.some((entry) => entry.badgeContainer || entry.badgeCandidate)) {
    return { ...base, reason: "unexpected_html" };
  }
  if (badgeContainers === 0) return { ...base, reason: "badge_container_missing" };
  if (badgeContainers !== 1) return { ...base, reason: "badge_container_ambiguous" };
  if (badgeCandidates === 0 && badgeImageMarkers === 0) return { ...base, reason: "empty_unconfirmed" };
  if (badgeCandidates !== badgeImageMarkers) return { ...base, reason: "badge_marker_mismatch" };
  return { ...base, reason: "completeness_unverified" };
}

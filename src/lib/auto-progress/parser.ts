import { validateGoogleSkillsProfileUrl } from "./profile-url.ts";

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
  const pattern = /([a-zA-Z_:][a-zA-Z0-9_:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of tag.matchAll(pattern)) {
    const name = match[1].toLowerCase();
    if (!result.has(name)) result.set(name, match[2] ?? match[3] ?? match[4] ?? "");
  }
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

export type ObservedProfileQualityWarning =
  | "ambiguous_card_structure"
  | "explicit_hidden_markup"
  | "incomplete_relevant_markup"
  | "incomplete_document_markup"
  | "loading_indicator"
  | "challenge_indicator"
  | "access_denied_indicator";

export type ObservedGoogleBadgeEntry = {
  title: string | null;
  canonicalBadgeUrl: string | null;
  imageUrl: string | null;
  earnedOn: string | null;
  earnedTimezoneLabel: string | null;
  /** True only when this element or an ancestor has explicit hidden markup. */
  explicitlyHidden: boolean;
  /** Stable badge identity from the badge detail URL if present and verified. */
  stableId: string | null;
};

export type ObservedGoogleProfileParse = {
  /** This parser is diagnostic only and intentionally has no complete result. */
  status: "incomplete";
  reason:
    | "unexpected_html"
    | "identity_mismatch"
    | "identity_unverified"
    | "badge_container_missing"
    | "badge_container_ambiguous"
    | "empty_unconfirmed"
    | "completeness_unverified"
    | "ambiguous_card_structure"
    | "explicit_hidden_markup"
    | "incomplete_relevant_markup"
    | "incomplete_document_markup"
    | "loading_indicator"
    | "challenge_indicator"
    | "access_denied_indicator";
  identityStatus: "matched" | "mismatch" | "unverified";
  /** All raw recognized card elements, including explicitly hidden ones. */
  badgeCandidates: number;
  visibleBadgeCandidates: number;
  hiddenBadgeCandidates: number;
  duplicateTitleGroups: number;
  duplicateLookingGroups: number;
  qualityWarnings: ObservedProfileQualityWarning[];
  entries: ObservedGoogleBadgeEntry[];
};

type HtmlNode = { tag: string; attrs: Map<string, string>; children: (HtmlNode | string)[] };
type HtmlTreeResult = { root: HtmlNode; incompleteRelevantMarkup: boolean; incompleteDocumentMarkup: boolean };

function decodeHtmlText(value: string): string {
  const named: Record<string, string> = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"' };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity[0] === "#") {
      const hex = entity[1]?.toLowerCase() === "x";
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      try { return Number.isFinite(code) ? String.fromCodePoint(code) : whole; } catch { return whole; }
    }
    return named[entity.toLowerCase()] ?? whole;
  });
}

function isRelevantBadgeNode(node: HtmlNode): boolean {
  if (node.tag !== "div") return false;
  const classes = new Set((node.attrs.get("class") ?? "").split(/\s+/).filter(Boolean));
  return classes.has("profile-badges") || classes.has("profile-badge");
}

function htmlTree(html: string): HtmlTreeResult {
  const root: HtmlNode = { tag: "document", attrs: new Map(), children: [] };
  const stack = [root];
  let incompleteRelevantMarkup = false;
  let malformedDocumentMarkup = false;
  const voidElements = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
  const markup = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  let offset = 0;
  for (const match of markup.matchAll(/<\/?[a-z][a-z0-9:-]*\b[^>]*>/gi)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (index > offset) stack.at(-1)?.children.push(decodeHtmlText(markup.slice(offset, index)));
    offset = index + token.length;
    const parsed = token.match(/^<\s*(\/)?\s*([a-z][a-z0-9:-]*)\b([^>]*)>$/i);
    if (!parsed) continue;
    const closing = Boolean(parsed[1]);
    const tag = parsed[2].toLowerCase();
    if (closing) {
      let foundClosingElement = false;
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].tag === tag) {
          if (tag !== "div" && stack.slice(i + 1).some(isRelevantBadgeNode)) incompleteRelevantMarkup = true;
          stack.length = i;
          foundClosingElement = true;
          break;
        }
      }
      if (!foundClosingElement) malformedDocumentMarkup = true;
      continue;
    }
    const node: HtmlNode = { tag, attrs: attributes(token), children: [] };
    stack.at(-1)?.children.push(node);
    if (!voidElements.has(tag) && !/\/\s*>$/.test(token)) stack.push(node);
  }
  if (offset < markup.length) {
    const tail = markup.slice(offset);
    if (/<div\b[^>]*(?:profile-badges|profile-badge)[^>]*$/i.test(tail)) incompleteRelevantMarkup = true;
    stack.at(-1)?.children.push(decodeHtmlText(tail));
  }
  if (stack.slice(1).some(isRelevantBadgeNode)) incompleteRelevantMarkup = true;
  return {
    root,
    incompleteRelevantMarkup,
    incompleteDocumentMarkup: malformedDocumentMarkup || stack.length !== 1
      || !/<\/body\s*>/i.test(markup) || !/<\/html\s*>/i.test(markup),
  };
}

function descendants(node: HtmlNode): HtmlNode[] {
  const result: HtmlNode[] = [];
  const visit = (current: HtmlNode) => {
    result.push(current);
    for (const child of current.children) if (typeof child !== "string") visit(child);
  };
  visit(node);
  return result;
}

function nodeText(node: HtmlNode): string {
  return node.children.map((child) => typeof child === "string" ? child : nodeText(child)).join(" ").replace(/\s+/g, " ").trim();
}

function nodeClasses(node: HtmlNode): Set<string> {
  return new Set((node.attrs.get("class") ?? "").split(/\s+/).filter(Boolean));
}

function pageQualityWarnings(nodes: HtmlNode[]): ObservedProfileQualityWarning[] {
  const warnings: ObservedProfileQualityWarning[] = [];
  const markerValues = nodes.flatMap((node) => [
    node.attrs.get("id") ?? "",
    node.attrs.get("class") ?? "",
    node.attrs.get("data-testid") ?? "",
  ]).map((value) => value.toLowerCase());
  const hasMarker = (markers: readonly string[]) => markerValues.some((value) => markers.some((marker) =>
    value === marker || value.split(/[\s_-]+/).includes(marker)));
  if (hasMarker(["profile-loading", "badges-loading", "loading-profile", "loading-badges", "loading-indicator"])) warnings.push("loading_indicator");
  if (hasMarker(["challenge", "captcha", "recaptcha", "cf-challenge", "challenge-page", "security-challenge"])) warnings.push("challenge_indicator");
  if (hasMarker(["access-denied", "private-profile", "login-required", "sign-in-required", "authentication-required"])) warnings.push("access_denied_indicator");
  for (const node of nodes) {
    if (node.attrs.get("role")?.toLowerCase() !== "alert") continue;
    const alertText = nodeText(node).toLowerCase().replace(/\s+/g, " ").trim();
    if (["loading profile", "loading badges", "please wait while your profile loads"].includes(alertText)
      && !warnings.includes("loading_indicator")) warnings.push("loading_indicator");
    if (["checking your browser", "verify you are human", "complete the security check"].includes(alertText)
      && !warnings.includes("challenge_indicator")) warnings.push("challenge_indicator");
    if (["access denied", "this profile is private", "sign in to view this profile"].includes(alertText)
      && !warnings.includes("access_denied_indicator")) warnings.push("access_denied_indicator");
  }
  return warnings;
}

function explicitlyHidden(node: HtmlNode): boolean {
  return node.attrs.has("hidden") || (node.attrs.get("aria-hidden") ?? "").trim().toLowerCase() === "true";
}

function descendantsWithHiddenState(node: HtmlNode, inheritedHidden = false): { node: HtmlNode; explicitlyHidden: boolean }[] {
  const hidden = inheritedHidden || explicitlyHidden(node);
  const result = [{ node, explicitlyHidden: hidden }];
  for (const child of node.children) {
    if (typeof child !== "string") result.push(...descendantsWithHiddenState(child, hidden));
  }
  return result;
}

function inheritedHiddenState(root: HtmlNode, target: HtmlNode, inheritedHidden = false): boolean | null {
  const hidden = inheritedHidden || explicitlyHidden(root);
  if (root === target) return inheritedHidden;
  for (const child of root.children) {
    if (typeof child !== "string") {
      const result = inheritedHiddenState(child, target, hidden);
      if (result !== null) return result;
    }
  }
  return null;
}

function safeObservedImageUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "cdn.qwiklabs.com" || url.username || url.password || url.port) return null;
    return url.href;
  } catch {
    return null;
  }
}

function earnedDate(value: string | undefined): { date: string | null; timezone: string | null } {
  if (!value) return { date: null, timezone: null };
  const match = value.trim().match(/^Earned\s+([A-Za-z]{3,9}\s+\d{1,2},\s+\d{4})(?:\s+([A-Z]{2,5}))?$/i);
  if (!match) return { date: null, timezone: null };
  const timestamp = Date.parse(`${match[1]} 00:00:00 UTC`);
  if (!Number.isFinite(timestamp)) return { date: null, timezone: match[2] ?? null };
  return { date: new Date(timestamp).toISOString().slice(0, 10), timezone: match[2] ?? null };
}

const ALLOWED_BADGE_HOSTS = new Set([
  "skills.google",
  "www.skills.google",
  "cloudskillsboost.google",
  "www.cloudskillsboost.google",
]);

const BADGE_PATH_PATTERN = /^\/public_profiles\/([A-Za-z0-9_-]+)\/badges\/(\d+)\/?$/;

function safeObservedBadgeIdentity(
  value: string | undefined,
  expectedProfileId: string,
): { canonicalBadgeUrl: string | null; stableId: string | null } {
  if (!value || typeof value !== "string") {
    return { canonicalBadgeUrl: null, stableId: null };
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("//")) {
    return { canonicalBadgeUrl: null, stableId: null };
  }

  let pathname: string;
  if (trimmed.startsWith("/")) {
    if (trimmed.includes("?") || trimmed.includes("#")) {
      return { canonicalBadgeUrl: null, stableId: null };
    }
    pathname = trimmed;
  } else {
    try {
      const url = new URL(trimmed);
      if (url.protocol !== "https:") return { canonicalBadgeUrl: null, stableId: null };
      if (!ALLOWED_BADGE_HOSTS.has(url.hostname.toLowerCase())) return { canonicalBadgeUrl: null, stableId: null };
      if (url.username || url.password || /\/\/[^/?#]*@/.test(trimmed)) return { canonicalBadgeUrl: null, stableId: null };
      if (url.port) return { canonicalBadgeUrl: null, stableId: null };
      if (url.search || url.hash || /[?#]/.test(trimmed)) return { canonicalBadgeUrl: null, stableId: null };
      pathname = url.pathname;
    } catch {
      return { canonicalBadgeUrl: null, stableId: null };
    }
  }

  const match = BADGE_PATH_PATTERN.exec(pathname);
  if (!match) return { canonicalBadgeUrl: null, stableId: null };

  const urlProfileId = match[1];
  const badgeId = match[2];

  if (urlProfileId.toLowerCase() !== expectedProfileId.toLowerCase()) {
    return { canonicalBadgeUrl: null, stableId: null };
  }

  return {
    canonicalBadgeUrl: `https://www.skills.google/public_profiles/${expectedProfileId}/badges/${badgeId}`,
    stableId: badgeId,
  };
}

function observedEntry(node: HtmlNode, isExplicitlyHidden: boolean, expectedProfileId: string): ObservedGoogleBadgeEntry {
  const subnodes = descendants(node);
  const titleNodes = subnodes.filter((item) => item.tag === "span" && nodeClasses(item).has("ql-title-medium"));
  const earnedNodes = subnodes.filter((item) => item.tag === "span" && nodeClasses(item).has("ql-body-medium"));
  const images = subnodes.filter((item) => item.tag === "img");
  const earned = earnedNodes.length === 1 ? earnedDate(nodeText(earnedNodes[0])) : { date: null, timezone: null };

  const anchors = subnodes.filter((item) => item.tag === "a" && item.attrs.has("href"));
  let badgeIdentity: { canonicalBadgeUrl: string | null; stableId: string | null } = { canonicalBadgeUrl: null, stableId: null };
  const badgeImageAnchor = anchors.find((item) => nodeClasses(item).has("badge-image"));
  if (badgeImageAnchor) {
    badgeIdentity = safeObservedBadgeIdentity(badgeImageAnchor.attrs.get("href"), expectedProfileId);
  }
  if (!badgeIdentity.stableId) {
    for (const anchor of anchors) {
      if (anchor === badgeImageAnchor) continue;
      const candidate = safeObservedBadgeIdentity(anchor.attrs.get("href"), expectedProfileId);
      if (candidate.stableId) {
        badgeIdentity = candidate;
        break;
      }
    }
  }

  return {
    title: titleNodes.length === 1 ? nodeText(titleNodes[0]) || null : null,
    canonicalBadgeUrl: badgeIdentity.canonicalBadgeUrl,
    imageUrl: images.length === 1 ? safeObservedImageUrl(images[0].attrs.get("src")) : null,
    earnedOn: earned.date,
    earnedTimezoneLabel: earned.timezone,
    explicitlyHidden: isExplicitlyHidden,
    stableId: badgeIdentity.stableId,
  };
}

/**
 * Extracts only the badge-card fields observed in the captured public HTML.
 * It always returns incomplete because the response has no total/pagination
 * guarantee and the cards expose no stable badge IDs or canonical badge URLs.
 */
export function parseObservedGoogleSkillsProfileHtml(html: string, expectedProfileUrl: string): ObservedGoogleProfileParse {
  const empty = (
    reason: ObservedGoogleProfileParse["reason"],
    identityStatus: ObservedGoogleProfileParse["identityStatus"] = "unverified",
    qualityWarnings: ObservedProfileQualityWarning[] = [],
  ): ObservedGoogleProfileParse => ({
    status: "incomplete", reason, identityStatus, badgeCandidates: 0, visibleBadgeCandidates: 0,
    hiddenBadgeCandidates: 0, duplicateTitleGroups: 0, duplicateLookingGroups: 0, qualityWarnings, entries: [],
  });
  if (typeof html !== "string" || html.length === 0 || html.length > 1_000_000 || !/<(?:!doctype\s+html|html|body|div)\b/i.test(html)) {
    return empty("unexpected_html");
  }
  const expected = validateGoogleSkillsProfileUrl(expectedProfileUrl);
  if (!expected.ok) return empty("identity_unverified");

  const tree = htmlTree(html);
  const root = tree.root;
  const nodes = descendants(root);
  const canonicalLinks = nodes.filter((node) => node.tag === "link"
    && (node.attrs.get("rel") ?? "").toLowerCase().split(/\s+/).includes("canonical"));
  let identityStatus: ObservedGoogleProfileParse["identityStatus"] = "unverified";
  if (canonicalLinks.length === 1) {
    const canonicalUrl = canonicalLinks[0].attrs.get("href") ?? "";
    const canonical = validateGoogleSkillsProfileUrl(canonicalUrl);
    identityStatus = canonical.ok
      ? canonical.value.normalizedUrl === expected.value.normalizedUrl ? "matched" : "mismatch"
      : "unverified";
  }
  if (identityStatus === "mismatch") return empty("identity_mismatch", identityStatus);

  const containers = nodes.filter((node) => node.tag === "div" && nodeClasses(node).has("profile-badges"));
  const markupWarnings: ObservedProfileQualityWarning[] = tree.incompleteRelevantMarkup ? ["incomplete_relevant_markup"] : [];
  const pageWarnings = pageQualityWarnings(nodes);
  if (containers.length === 0) {
    const warnings: ObservedProfileQualityWarning[] = [
      ...markupWarnings,
      ...(tree.incompleteDocumentMarkup ? ["incomplete_document_markup" as const] : []),
      ...pageWarnings,
    ];
    const reason = warnings[0] ?? "badge_container_missing";
    return empty(reason, identityStatus, warnings);
  }
  if (containers.length !== 1) return empty("badge_container_ambiguous", identityStatus, markupWarnings);

  const ancestorHidden = inheritedHiddenState(root, containers[0]) ?? false;
  const visibleNodes = descendantsWithHiddenState(containers[0], ancestorHidden);
  const containerExplicitlyHidden = visibleNodes[0]?.explicitlyHidden ?? false;
  const entryStates = visibleNodes.filter(({ node }) => node.tag === "div" && nodeClasses(node).has("profile-badge"));
  const entries = entryStates.map(({ node, explicitlyHidden: isHidden }) =>
    observedEntry(node, isHidden, expected.value.profileId));
  const hiddenBadgeCandidates = entryStates.filter((entry) => entry.explicitlyHidden).length;
  const visibleBadgeCandidates = entryStates.length - hiddenBadgeCandidates;
  if (entries.length === 0) {
    const emptyWarnings = [...markupWarnings];
    if (containerExplicitlyHidden) emptyWarnings.push("explicit_hidden_markup");
    const reason = tree.incompleteRelevantMarkup
      ? "incomplete_relevant_markup"
      : containerExplicitlyHidden ? "explicit_hidden_markup" : "empty_unconfirmed";
    return empty(reason, identityStatus, emptyWarnings);
  }

  const titleCounts = new Map<string, number>();
  const duplicateLooks = new Map<string, number>();
  for (const badge of entries) {
    if (badge.title) titleCounts.set(badge.title, (titleCounts.get(badge.title) ?? 0) + 1);
    const normalizedTitle = badge.title?.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase() ?? null;
    const signature = JSON.stringify([normalizedTitle, badge.canonicalBadgeUrl, badge.imageUrl, badge.earnedOn]);
    duplicateLooks.set(signature, (duplicateLooks.get(signature) ?? 0) + 1);
  }
  const duplicateTitleGroups = [...titleCounts.values()].filter((count) => count > 1).length;
  const duplicateLookingGroups = [...duplicateLooks.values()].filter((count) => count > 1).length;
  const entrySet = new Set(entryStates.map((entry) => entry.node));
  const hasNestedCards = entryStates.some(({ node }) => descendants(node).slice(1).some((descendant) => entrySet.has(descendant)));
  const qualityWarnings = [...markupWarnings, ...pageWarnings];
  if ((duplicateTitleGroups > 0 || duplicateLookingGroups > 0 || hasNestedCards)
    && !qualityWarnings.includes("ambiguous_card_structure")) qualityWarnings.push("ambiguous_card_structure");
  if (hiddenBadgeCandidates > 0) qualityWarnings.push("explicit_hidden_markup");
  const reason = qualityWarnings[0]
    ?? (identityStatus === "unverified" ? "identity_unverified" : "completeness_unverified");
  return {
    status: "incomplete",
    reason,
    identityStatus,
    badgeCandidates: entries.length,
    visibleBadgeCandidates,
    hiddenBadgeCandidates,
    duplicateTitleGroups,
    duplicateLookingGroups,
    qualityWarnings,
    entries,
  };
}

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

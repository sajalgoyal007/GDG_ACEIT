#!/usr/bin/env python3
"""Offline structural diagnostics for locally saved Google Skills HTML files.

This tool never performs HTTP requests and never reports profile names, page
text, image URLs, or other page content. Candidate cards are not verified
earned badges. An explicit-empty marker is a detected signal, not proof of a
complete or zero-badge profile.
"""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit


UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
PROFILE_PATH_RE = re.compile(r"^/public_profiles/([^/]+)/?$", re.IGNORECASE)
VOID_TAGS = {
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
    "meta", "param", "source", "track", "wbr",
}

# These are exact, deliberately narrow marker names. Detecting one does not
# establish that Google guarantees it or that the captured page is complete.
EMPTY_CLASSES = {"profile-badges-empty", "empty-badges", "no-badges", "badge-empty-state"}
EMPTY_TEST_IDS = {"profile-badges-empty", "empty-badges", "no-badges"}
EMPTY_TEXT = {
    "no badges earned yet",
    "you have not earned any badges yet",
    "you haven't earned any badges yet",
    "no badges to display",
}
LOADING_MARKERS = {"loading", "profile-loading", "badges-loading", "spinner"}
CHALLENGE_MARKERS = {"challenge", "captcha", "cf-challenge", "recaptcha"}
ACCESS_MARKERS = {"access-denied", "access_denied", "private-profile", "sign-in-required", "login-required"}
LOADING_TEXT = {"loading profile", "loading badges", "please wait while your profile loads"}
CHALLENGE_TEXT = {"checking your browser", "verify you are human", "complete the security check"}
ACCESS_TEXT = {"access denied", "this profile is private", "sign in to view this profile"}


@dataclass
class Node:
    tag: str
    attrs: dict[str, str]
    parent: Node | None = None
    children: list[Node | str] = field(default_factory=list)


class CaptureParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.root = Node("#document", {})
        self.stack = [self.root]
        self.malformed = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self._start(tag, attrs, push=tag.lower() not in VOID_TAGS)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self._start(tag, attrs, push=False)

    def _start(self, tag: str, attrs: list[tuple[str, str | None]], *, push: bool) -> None:
        node = Node(tag.lower(), {key.lower(): value or "" for key, value in attrs})
        node.parent = self.stack[-1]
        node.parent.children.append(node)
        if push:
            self.stack.append(node)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        matching = next((i for i in range(len(self.stack) - 1, 0, -1) if self.stack[i].tag == tag), None)
        if matching is None:
            self.malformed = True
            return
        if matching != len(self.stack) - 1:
            self.malformed = True
        del self.stack[matching:]

    def handle_data(self, data: str) -> None:
        self.stack[-1].children.append(data)


def walk(node: Node):
    for child in node.children:
        if isinstance(child, Node):
            yield child
            yield from walk(child)


def text_content(node: Node) -> str:
    parts: list[str] = []
    for child in node.children:
        parts.append(text_content(child) if isinstance(child, Node) else child)
    return " ".join(" ".join(parts).split()).casefold()


def class_tokens(node: Node) -> set[str]:
    return {token.casefold() for token in node.attrs.get("class", "").split()}


def is_div_with_class(node: Node, token: str) -> bool:
    return node.tag == "div" and token in class_tokens(node)


def canonical_profile(nodes: list[Node]) -> tuple[str | None, str | None, bool]:
    links = [node for node in nodes if node.tag == "link"
             and "canonical" in node.attrs.get("rel", "").casefold().split()]
    if len(links) != 1:
        return None, None, len(links) > 1
    href = links[0].attrs.get("href", "").strip()
    try:
        parsed = urlsplit(href)
        if (parsed.scheme != "https" or parsed.hostname not in {"skills.google", "www.skills.google"}
                or parsed.username is not None or parsed.password is not None or parsed.port is not None
                or parsed.query or parsed.fragment):
            return None, None, False
    except ValueError:
        return None, None, False
    match = PROFILE_PATH_RE.fullmatch(parsed.path)
    if not match or not UUID_RE.fullmatch(match.group(1)):
        return None, None, False
    normalized_host = parsed.hostname.lower()
    canonical = f"https://{normalized_host}{parsed.path.rstrip('/') or parsed.path}"
    return canonical, match.group(1).lower(), False


def marker_flags(nodes: list[Node], body_text: str) -> dict[str, bool]:
    loading = challenge = access = explicit_empty = False
    for node in nodes:
        classes = class_tokens(node)
        identifiers = {node.attrs.get("id", "").casefold(), node.attrs.get("data-testid", "").casefold()}
        role = node.attrs.get("role", "").casefold()
        if classes & LOADING_MARKERS or identifiers & LOADING_MARKERS:
            loading = True
        if classes & CHALLENGE_MARKERS or identifiers & CHALLENGE_MARKERS:
            challenge = True
        if classes & ACCESS_MARKERS or identifiers & ACCESS_MARKERS:
            access = True
        empty_marker = (bool(classes & EMPTY_CLASSES)
                        or node.attrs.get("data-testid", "").casefold() in EMPTY_TEST_IDS
                        or node.attrs.get("data-empty-state", "").casefold() in {"true", "empty", "no-badges"})
        if empty_marker or (role == "status" and text_content(node) in EMPTY_TEXT):
            explicit_empty = True

    # Exact phrases are only treated as candidate markers, and only when the
    # capture contains no badge cards. They are not considered authoritative.
    if any(phrase in body_text for phrase in LOADING_TEXT):
        loading = True
    if any(phrase in body_text for phrase in CHALLENGE_TEXT):
        challenge = True
    if any(phrase in body_text for phrase in ACCESS_TEXT):
        access = True
    return {"loading": loading, "challenge": challenge, "access_denied": access, "explicit_empty_state": explicit_empty}


def analyze_html(html: str) -> dict[str, Any]:
    parser = CaptureParser()
    try:
        parser.feed(html)
        parser.close()
    except Exception:
        parser.malformed = True
    nodes = list(walk(parser.root))
    canonical_url, profile_uuid, canonical_ambiguous = canonical_profile(nodes)
    containers = [node for node in nodes if is_div_with_class(node, "profile-badges")]
    cards_all = [node for node in nodes if is_div_with_class(node, "profile-badge")]
    cards: list[Node] = []
    nested_cards = False
    if len(containers) == 1:
        container = containers[0]
        cards = [node for node in walk(container) if is_div_with_class(node, "profile-badge")]
        nested_cards = any(any(parent is card for parent in ancestors(card)) for card in cards)

    body_text = text_content(parser.root)
    markers = marker_flags(nodes, body_text)
    relevant_open = any(is_div_with_class(node, "profile-badges") or is_div_with_class(node, "profile-badge")
                        for node in parser.stack[1:])
    malformed_section = parser.malformed or relevant_open or bool(parser.rawdata)
    card_ids = [node.attrs.get("data-badge-id", "").strip() for node in cards if node.attrs.get("data-badge-id", "").strip()]
    duplicate_id_count = len(card_ids) - len(set(card_ids))
    orphan_cards = len(cards_all) > len(cards)

    structure_incomplete = (malformed_section or canonical_ambiguous or canonical_url is None
                            or len(containers) > 1 or orphan_cards or nested_cards or duplicate_id_count > 0
                            or (markers["explicit_empty_state"] and bool(cards)))
    if structure_incomplete or markers["loading"] or markers["challenge"] or markers["access_denied"]:
        classification = "incomplete_or_unexpected_response"
    elif markers["explicit_empty_state"] and not cards:
        classification = "explicit_empty_state"
    elif not containers:
        classification = "badge_container_missing"
    elif not cards:
        classification = "empty_unconfirmed"
    else:
        classification = "badge_cards_detected"

    return {
        "classification": classification,
        "canonical_profile_url": canonical_url,
        "profile_uuid": profile_uuid,
        "badge_container_count": len(containers),
        "badge_card_count": len(cards),
        "loading_marker": markers["loading"],
        "challenge_marker": markers["challenge"],
        "access_denied_marker": markers["access_denied"],
        "explicit_empty_marker": markers["explicit_empty_state"],
        "structure_warnings": {
            "malformed_or_unclosed_badge_section": malformed_section,
            "ambiguous_canonical_identity": canonical_ambiguous,
            "multiple_badge_containers": len(containers) > 1,
            "badge_cards_outside_container": orphan_cards,
            "nested_badge_cards": nested_cards,
            "duplicate_explicit_badge_ids": duplicate_id_count,
        },
    }


def ancestors(node: Node):
    parent = node.parent
    while parent is not None:
        yield parent
        parent = parent.parent


def analyze_directory(directory: Path) -> dict[str, Any]:
    files = sorted(path for path in directory.rglob("*") if path.is_file() and path.suffix.casefold() in {".html", ".htm"})
    results = []
    for path in files:
        try:
            html = path.read_text(encoding="utf-8", errors="replace")
            result = analyze_html(html)
            result["file"] = path.relative_to(directory).as_posix()
        except OSError:
            result = {
                "file": path.relative_to(directory).as_posix(),
                "classification": "incomplete_or_unexpected_response",
                "canonical_profile_url": None,
                "profile_uuid": None,
                "badge_container_count": 0,
                "badge_card_count": 0,
                "loading_marker": False,
                "challenge_marker": False,
                "access_denied_marker": False,
                "explicit_empty_marker": False,
                "structure_warnings": {"file_read_error": True},
            }
        results.append(result)

    counts: dict[str, int] = {}
    for result in results:
        category = result["classification"]
        counts[category] = counts.get(category, 0) + 1
    zero_results = counts.get("explicit_empty_state", 0) + counts.get("empty_unconfirmed", 0) + counts.get("badge_container_missing", 0)
    positive_results = counts.get("badge_cards_detected", 0)
    return {
        "tool": "google_skills_html_diagnostic",
        "mode": "offline_local_html_only",
        "files_scanned": len(results),
        "classification_counts": counts,
        "comparison": {
            "zero_or_empty_candidate_files": zero_results,
            "badge_bearing_files": positive_results,
            "both_groups_present": zero_results > 0 and positive_results > 0,
            "interpretation": "Structural comparison only. Candidate cards are not verified totals; empty-state markers are not proof of a complete zero.",
        },
        "results": results,
    }


def main() -> int:
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("directory", type=Path, help="Directory containing saved .html/.htm captures")
    cli.add_argument("--output", type=Path, help="Optional JSON report path; the report contains structural metadata only")
    args = cli.parse_args()
    if not args.directory.is_dir():
        cli.error("input must be an existing directory")
    report = analyze_directory(args.directory)
    encoded = json.dumps(report, indent=2, ensure_ascii=False) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded, encoding="utf-8", newline="\n")
    print(encoded, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

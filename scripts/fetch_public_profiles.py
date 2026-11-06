#!/usr/bin/env python3
"""Automated, conservative public profile HTML fetcher for Google Skills Boost.

Features:
- Standard HTTP client (urllib.request) with custom User-Agent and Accept headers.
- Bounded concurrency (default 1 worker, configurable) with per-request pacing.
- Timeout protection, retry/backoff for transient errors, and transient-error handling.
- Saves raw HTML responses locally: data/raw_profiles/<participant_uuid>.html
- Resumable fetch manifest: data/raw_profiles/fetch_manifest.json
- Preserves individual HTTP status, final URL, headers, and error details.
- Stops immediately if blocked (HTTP 403, 429) to respect access limits.
- Supports canary testing (--canary <N>) and individual profile fetches (--uuid <UUID>).
- Strict non-fabrication: failures are explicitly marked, never defaulted to zero.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import random
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)
DEFAULT_HEADERS = {
    "User-Agent": DEFAULT_USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
}

ALLOWED_HOSTS = {
    "skills.google",
    "www.skills.google",
    "cloudskillsboost.google",
    "www.cloudskillsboost.google",
}


def normalize_profile_url(url_str: str) -> str:
    """Validate that the URL belongs to allowed Google Skills Boost hosts."""
    clean = url_str.strip()
    parsed = urllib.parse.urlsplit(clean)
    if parsed.scheme.lower() != "https":
        raise ValueError(f"Insecure scheme in profile URL: {clean}")
    if not parsed.hostname or parsed.hostname.lower() not in ALLOWED_HOSTS:
        raise ValueError(f"Disallowed host in profile URL: {clean}")
    return clean


def read_participant_roster(source_csv: Path) -> list[dict[str, str]]:
    """Read participant UUIDs, names, and profile URLs."""
    if not source_csv.is_file():
        raise FileNotFoundError(f"Source roster not found: {source_csv}")

    with source_csv.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    valid_roster: list[dict[str, str]] = []
    for row in rows:
        uuid = (row.get("participant_uuid") or row.get("participant_id") or "").strip()
        name = (row.get("participant_name") or "").strip()
        url = (row.get("profile_url") or "").strip()
        if uuid and url:
            valid_roster.append({
                "participant_uuid": uuid,
                "participant_name": name,
                "profile_url": url,
            })

    return valid_roster


def load_manifest(manifest_path: Path) -> dict[str, Any]:
    """Load existing fetch manifest if available."""
    if manifest_path.is_file():
        try:
            return json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "last_updated_at": None,
        "profiles": {},
    }


def save_manifest_atomic(manifest_path: Path, data: dict[str, Any]) -> None:
    """Save manifest atomically as formatted JSON with retry for Windows file locks."""
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = manifest_path.with_name(manifest_path.name + ".tmp")
    data["last_updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    temp_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    for attempt in range(5):
        try:
            temp_path.replace(manifest_path)
            return
        except PermissionError:
            time.sleep(0.1 * (attempt + 1))
    # Fallback if replace fails repeatedly
    temp_path.replace(manifest_path)


def fetch_single_profile(
    url: str,
    timeout: float = 15.0,
) -> tuple[int, str, bytes, dict[str, str], str | None]:
    """Fetch profile HTML.
    
    Returns: (http_status, final_url, html_bytes, response_headers, error_message)
    """
    req = urllib.request.Request(url, headers=DEFAULT_HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            status = response.status
            final_url = response.geturl()
            html_bytes = response.read()
            headers = {k.lower(): v for k, v in response.headers.items()}
            return status, final_url, html_bytes, headers, None
    except urllib.error.HTTPError as err:
        error_body = err.read()
        headers = {k.lower(): v for k, v in err.headers.items()}
        return err.code, err.geturl(), error_body, headers, f"HTTP_{err.code}: {err.reason}"
    except urllib.error.URLError as err:
        return 0, url, b"", {}, f"URL_ERROR: {err.reason}"
    except TimeoutError:
        return 0, url, b"", {}, "TIMEOUT: Connection timed out"
    except Exception as err:
        return 0, url, b"", {}, f"FETCH_EXCEPTION: {type(err).__name__}: {err}"


TRANSIENT_STATUSES = {0, 408, 425, 429, 500, 502, 503, 504}


def run_collection(
    roster: list[dict[str, str]],
    output_dir: Path,
    manifest_path: Path,
    delay_seconds: float = 1.5,
    timeout_seconds: float = 15.0,
    force_refetch: bool = False,
    concurrency: int = 1,
    retries: int = 2,
    backoff_base: float = 2.0,
) -> dict[str, Any]:
    """Run bounded-concurrency profile collection with pacing, retries, and caching.

    The manifest is the cache: previously fetched HTTP 200 profiles are skipped
    unless ``force_refetch`` is set. Each failed attempt is retried with
    exponential backoff plus jitter for transient errors only.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest = load_manifest(manifest_path)
    profiles_dict = manifest.setdefault("profiles", {})

    total = len(roster)
    workers = max(1, min(concurrency, total)) if total else 1
    print(f"Starting fetch operation for {total} profile(s)...")
    print(
        f"Concurrency: {workers} worker(s) | Pacing: {delay_seconds:.2f}s per request | "
        f"Timeout: {timeout_seconds:.1f}s | Retries: {retries}"
    )
    print(f"Storage: {output_dir.resolve()}\n")

    lock = threading.Lock()
    stop_event = threading.Event()
    state = {"consecutive_blocks": 0, "cache_hits": 0, "fetched": 0, "failed": 0}

    def save_entry(uuid: str, entry: dict[str, Any]) -> None:
        with lock:
            profiles_dict[uuid] = entry
            save_manifest_atomic(manifest_path, manifest)

    def process(item: dict[str, str], idx: int) -> None:
        uuid = item["participant_uuid"]
        name = item["participant_name"]
        raw_url = item["profile_url"]
        html_file = output_dir / f"{uuid}.html"

        existing = profiles_dict.get(uuid)
        if existing and existing.get("status") == 200 and html_file.is_file() and not force_refetch:
            with lock:
                state["cache_hits"] += 1
            print(f"[{idx}/{total}] Cached HTTP 200: {name} ({uuid[:8]}...)")
            return

        try:
            target_url = normalize_profile_url(raw_url)
        except ValueError as err:
            print(f"[{idx}/{total}] URL Error for {name}: {err}")
            save_entry(
                uuid,
                {
                    "participant_name": name,
                    "profile_url": raw_url,
                    "status": 0,
                    "final_url": raw_url,
                    "content_length": 0,
                    "error": str(err),
                    "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "html_path": None,
                },
            )
            with lock:
                state["failed"] += 1
            return

        attempt = 0
        attempts: list[dict[str, Any]] = []
        final_status = 0
        final_url = target_url
        error_msg: str | None = None
        headers: dict[str, str] = {}
        html_bytes = b""

        while attempt <= retries:
            if stop_event.is_set():
                error_msg = "ABORTED: collection stopped after repeated access restrictions"
                break
            if attempt > 0:
                backoff = backoff_base * (2 ** (attempt - 1)) + random.uniform(0, 0.5)
                time.sleep(backoff)
            if delay_seconds > 0:
                time.sleep(delay_seconds)

            print(
                f"[{idx}/{total}] Fetching (attempt {attempt + 1}/{retries + 1}): "
                f"{name} ({uuid[:8]}...) -> {target_url}",
                flush=True,
            )
            final_status, final_url, html_bytes, headers, error_msg = fetch_single_profile(
                target_url, timeout=timeout_seconds
            )
            attempts.append(
                {
                    "attempt": attempt + 1,
                    "status": final_status,
                    "error": error_msg,
                    "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                }
            )
            if final_status == 200 and len(html_bytes) > 0:
                break
            if final_status in (403, 429):
                with lock:
                    state["consecutive_blocks"] += 1
                    if state["consecutive_blocks"] >= 2:
                        stop_event.set()
            if final_status not in TRANSIENT_STATUSES:
                break
            attempt += 1

        content_length = len(html_bytes)
        html_path_saved = None

        if final_status == 200 and content_length > 0:
            html_file.write_bytes(html_bytes)
            html_path_saved = str(html_file.resolve())
            with lock:
                state["fetched"] += 1
                state["consecutive_blocks"] = 0
            print(f"[{idx}/{total}] HTTP 200 ({content_length:,} bytes) [SAVED] {name}")
        else:
            if content_length > 0 and final_status in (404, 403, 500):
                # Save error page HTML for diagnosis
                error_html_file = output_dir / f"{uuid}_error_{final_status}.html"
                error_html_file.write_bytes(html_bytes)
                html_path_saved = str(error_html_file.resolve())
            with lock:
                state["failed"] += 1
            print(f"[{idx}/{total}] HTTP {final_status} - Error: {error_msg}")

        save_entry(
            uuid,
            {
                "participant_name": name,
                "profile_url": target_url,
                "final_url": final_url,
                "status": final_status,
                "content_length": content_length,
                "error": error_msg,
                "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "html_path": html_path_saved,
                "content_type": headers.get("content-type"),
                "attempts": len(attempts),
                "retry_history": attempts,
            },
        )

    if workers == 1:
        for idx, item in enumerate(roster, start=1):
            process(item, idx)
    else:
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {
                executor.submit(process, item, idx): item
                for idx, item in enumerate(roster, start=1)
            }
            for future in as_completed(futures):
                try:
                    future.result()
                except Exception as err:  # keep other workers running
                    item = futures[future]
                    print(f"Worker error for {item['participant_name']}: {err}")

    if stop_event.is_set():
        print(
            "\n[ALERT] Collection stopped early after repeated HTTP 403/429 responses. "
            "Cached entries are preserved."
        )

    print("\nFetch execution finished.")
    print(
        f"Summary: {state['fetched']} fetched, {state['cache_hits']} cached, "
        f"{state['failed']} failed."
    )
    with lock:
        save_manifest_atomic(manifest_path, manifest)
    return manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Automated public profile HTML fetcher for Google Skills Boost."
    )
    parser.add_argument(
        "--source-roster",
        type=Path,
        default=Path("data/verified-badge-counts-source.csv"),
        help="Path to verified badge counts source CSV",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("data/raw_profiles"),
        help="Directory to save raw HTML profiles (default: data/raw_profiles)",
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=Path("data/raw_profiles/fetch_manifest.json"),
        help="Path to resumable fetch manifest JSON (default: data/raw_profiles/fetch_manifest.json)",
    )
    parser.add_argument(
        "--canary",
        type=int,
        metavar="N",
        help="Run only the first N profiles for canary validation",
    )
    parser.add_argument(
        "--uuid",
        type=str,
        help="Fetch a single specific participant UUID",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=1.5,
        help="Delay in seconds between requests (default: 1.5)",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=15.0,
        help="HTTP request timeout in seconds (default: 15.0)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force re-fetching even if already present in manifest with HTTP 200",
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=1,
        help="Bounded number of concurrent fetch workers (default: 1)",
    )
    parser.add_argument(
        "--retries",
        type=int,
        default=2,
        help="Retries for transient errors such as timeouts and HTTP 5xx (default: 2)",
    )
    parser.add_argument(
        "--backoff-base",
        type=float,
        default=2.0,
        help="Base seconds for exponential retry backoff (default: 2.0)",
    )

    args = parser.parse_args(argv)

    try:
        roster = read_participant_roster(args.source_roster)
    except Exception as err:
        print(f"ERROR: Could not read participant roster: {err}", file=sys.stderr)
        return 2

    if args.uuid:
        target_uuid = args.uuid.strip().lower()
        roster = [r for r in roster if r["participant_uuid"].lower() == target_uuid]
        if not roster:
            print(f"ERROR: Participant UUID '{args.uuid}' not found in roster.", file=sys.stderr)
            return 2

    if args.canary and args.canary > 0:
        roster = roster[: args.canary]

    manifest = run_collection(
        roster=roster,
        output_dir=args.output_dir,
        manifest_path=args.manifest,
        delay_seconds=args.delay,
        timeout_seconds=args.timeout,
        force_refetch=args.force,
        concurrency=args.concurrency,
        retries=args.retries,
        backoff_base=args.backoff_base,
    )

    # Print summary statistics
    profiles = manifest.get("profiles", {})
    successful = sum(1 for p in profiles.values() if p.get("status") == 200)
    failed = sum(1 for p in profiles.values() if p.get("status") != 200)
    print(f"\nManifest summary: {successful} HTTP 200 responses, {failed} non-200 or failed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())


#!/usr/bin/env python3
"""Assign 114 participants into balanced, non-overlapping batches for organizer review.

Reads the participant verification workspace, partitions records across a configurable
number of reviewers, and emits separate reviewer CSV files plus a master assignment summary.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import math
import sys
import tempfile
from pathlib import Path
from typing import Any

WORKSPACE_HEADERS = [
    "serial_number",
    "participant_name",
    "profile_url",
    "verified_badge_count",
    "review_status",
    "reviewer",
    "reviewed_at",
    "review_note",
]


class AssignmentError(ValueError):
    """Raised when assignment cannot be completed due to invalid input or configuration."""
    pass


def read_workspace_csv(path: Path) -> list[dict[str, str]]:
    """Read workspace CSV safely, supporting UTF-8 with BOM."""
    if not path.is_file():
        raise AssignmentError(f"Workspace file not found: {path}")

    raw = path.read_bytes()
    if len(raw) == 0:
        raise AssignmentError("Workspace file is empty")
    if len(raw) > 5_000_000:
        raise AssignmentError("Workspace file exceeds 5 MB size limit")

    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as err:
        raise AssignmentError(f"Workspace must be valid UTF-8: {err}") from None

    reader = csv.DictReader(io.StringIO(text, newline=""))
    if not reader.fieldnames:
        raise AssignmentError("Workspace is missing a header row")

    headers = [h.strip() for h in reader.fieldnames if h]
    if headers != WORKSPACE_HEADERS:
        raise AssignmentError(
            f"Unexpected workspace headers. Expected: {WORKSPACE_HEADERS}, found: {headers}"
        )

    rows = list(reader)
    if not rows:
        raise AssignmentError("Workspace contains no participant rows")

    # Validate serial numbers are sequential 1..N and profiles are present
    seen_serials: set[int] = set()
    seen_urls: set[str] = set()
    for index, row in enumerate(rows, start=1):
        serial_str = (row.get("serial_number") or "").strip()
        url = (row.get("profile_url") or "").strip()
        name = (row.get("participant_name") or "").strip()

        if not serial_str.isdigit():
            raise AssignmentError(f"Row {index} has invalid serial_number '{serial_str}'")
        serial = int(serial_str)
        if serial in seen_serials:
            raise AssignmentError(f"Duplicate serial_number {serial} found in workspace")
        seen_serials.add(serial)

        if not url:
            raise AssignmentError(f"Row {index} (serial {serial}) is missing profile_url")
        if url in seen_urls:
            raise AssignmentError(f"Duplicate profile_url in workspace: {url}")
        seen_urls.add(url)

        if not name:
            raise AssignmentError(f"Row {index} (serial {serial}) is missing participant_name")

    return rows


def partition_participants(
    rows: list[dict[str, str]],
    reviewer_names: list[str],
) -> dict[str, list[dict[str, str]]]:
    """Partition participants into contiguous, approximately equal batches.
    
    Contiguous partitioning ensures each reviewer receives a clear serial number range
    (e.g., 1-38, 39-76, 77-114), minimizing coordination overhead.
    """
    total = len(rows)
    num_reviewers = len(reviewer_names)
    if num_reviewers < 1:
        raise AssignmentError("At least one reviewer must be specified")
    if num_reviewers > total:
        raise AssignmentError(
            f"Cannot assign {num_reviewers} reviewers to {total} participants (max {total})"
        )

    assignments: dict[str, list[dict[str, str]]] = {}
    
    # Calculate batch sizes (distribute remainder evenly across first few reviewers)
    base_size = total // num_reviewers
    remainder = total % num_reviewers
    
    offset = 0
    assigned_serials: set[int] = set()

    for idx, reviewer in enumerate(reviewer_names):
        batch_size = base_size + (1 if idx < remainder else 0)
        batch = rows[offset : offset + batch_size]
        offset += batch_size

        batch_copies: list[dict[str, str]] = []
        for row in batch:
            serial = int(row["serial_number"])
            if serial in assigned_serials:
                raise AssignmentError(f"Internal error: serial {serial} assigned more than once")
            assigned_serials.add(serial)

            # Pre-fill assigned reviewer while keeping counts and notes clean
            row_copy = dict(row)
            row_copy["reviewer"] = reviewer
            row_copy["review_status"] = "pending"
            row_copy["verified_badge_count"] = ""
            row_copy["reviewed_at"] = ""
            row_copy["review_note"] = ""
            batch_copies.append(row_copy)

        assignments[reviewer] = batch_copies

    if len(assigned_serials) != total:
        raise AssignmentError(
            f"Partition mismatch: {len(assigned_serials)} assigned out of {total} total"
        )

    return assignments


def write_csv_atomic(path: Path, rows: list[dict[str, str]]) -> None:
    """Write CSV atomically with UTF-8 BOM for spreadsheet compatibility."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_file: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8-sig",
            newline="",
            dir=path.parent,
            delete=False,
        ) as temp:
            temp_file = temp.name
            writer = csv.DictWriter(
                temp,
                fieldnames=WORKSPACE_HEADERS,
                lineterminator="\r\n",
            )
            writer.writeheader()
            writer.writerows(rows)
        Path(temp_file).replace(path)
    finally:
        if temp_file and Path(temp_file).exists():
            Path(temp_file).unlink()


def generate_assignments(
    workspace_path: Path,
    reviewer_names: list[str],
    output_dir: Path,
    summary_path: Path | None = None,
) -> dict[str, Any]:
    """Execute participant partitioning and write reviewer CSV files and summary."""
    rows = read_workspace_csv(workspace_path)
    assignments = partition_participants(rows, reviewer_names)

    output_dir.mkdir(parents=True, exist_ok=True)
    summary_batches: list[dict[str, Any]] = []

    for reviewer, batch in assignments.items():
        # Sanitize filename
        safe_name = "".join(c if c.isalnum() or c in ("-", "_") else "_" for c in reviewer.lower())
        file_prefix = "" if safe_name.startswith("reviewer_") else "reviewer_"
        reviewer_csv_path = output_dir / f"{file_prefix}{safe_name}.csv"
        write_csv_atomic(reviewer_csv_path, batch)

        first_serial = int(batch[0]["serial_number"]) if batch else 0
        last_serial = int(batch[-1]["serial_number"]) if batch else 0

        summary_batches.append({
            "reviewer": reviewer,
            "participant_count": len(batch),
            "serial_range": f"{first_serial}-{last_serial}" if batch else "empty",
            "file_name": reviewer_csv_path.name,
            "file_path": str(reviewer_csv_path.resolve()),
        })

    summary_data: dict[str, Any] = {
        "workspace_source": str(workspace_path.resolve()),
        "total_participants": len(rows),
        "total_reviewers": len(reviewer_names),
        "batches": summary_batches,
    }

    if summary_path:
        summary_path.parent.mkdir(parents=True, exist_ok=True)
        summary_temp = summary_path.with_name(summary_path.name + ".tmp")
        summary_temp.write_text(json.dumps(summary_data, indent=2) + "\n", encoding="utf-8")
        summary_temp.replace(summary_path)

    return summary_data


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Partition 114 participants into reviewer workspace CSVs."
    )
    parser.add_argument(
        "--workspace",
        type=Path,
        default=Path("data/participant-verification-workspace.csv"),
        help="Path to participant-verification-workspace.csv",
    )
    parser.add_argument(
        "--reviewers",
        type=str,
        help="Comma-separated list of reviewer names (e.g. 'Alice,Bob,Charlie')",
    )
    parser.add_argument(
        "--num-reviewers",
        type=int,
        default=3,
        help="Number of reviewers if --reviewers is not provided (default: 3)",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("data/assignments"),
        help="Output directory for individual reviewer CSVs (default: data/assignments)",
    )
    parser.add_argument(
        "--summary",
        type=Path,
        default=Path("data/assignments/assignment_summary.json"),
        help="Path to master assignment JSON summary (default: data/assignments/assignment_summary.json)",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    if args.reviewers:
        reviewers = [name.strip() for name in args.reviewers.split(",") if name.strip()]
        if not reviewers:
            print("ERROR: --reviewers must contain at least one valid non-empty name.", file=sys.stderr)
            return 2
    else:
        if args.num_reviewers < 1:
            print("ERROR: --num-reviewers must be at least 1.", file=sys.stderr)
            return 2
        reviewers = [f"reviewer_{i}" for i in range(1, args.num_reviewers + 1)]

    try:
        summary = generate_assignments(
            workspace_path=args.workspace,
            reviewer_names=reviewers,
            output_dir=args.output_dir,
            summary_path=args.summary,
        )
    except AssignmentError as err:
        print(f"ASSIGNMENT_FAILED: {err}", file=sys.stderr)
        return 1

    print(f"Successfully partitioned {summary['total_participants']} participants across {summary['total_reviewers']} reviewers:")
    for b in summary["batches"]:
        print(f"  - {b['reviewer']}: {b['participant_count']} participants (Serials {b['serial_range']}) -> {b['file_name']}")
    print(f"Master summary saved to: {args.summary}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

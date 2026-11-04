#!/usr/bin/env python3
"""Comprehensive unit tests for the organizer review workflow.

Tests:
1. Equal participant distribution (2, 3, 4, 5 reviewers)
2. Duplicate assignment prevention (disjoint serial partitions)
3. Blank count rejection
4. Valid zero count with explicit note
5. Invalid count (negative, float, out of range, non-numeric)
6. Missing reviewer
7. Missing verification date / timestamp
8. Conflicting counts across reviewer batches
9. Unknown participant rejection against canonical roster
10. Correct 3-column export format compatible with prepare_verified_badge_csv.py
"""

from __future__ import annotations

import csv
import io
import tempfile
import unittest
from pathlib import Path

from scripts.assign_reviewers import AssignmentError, partition_participants, read_workspace_csv
from scripts.prepare_verified_badge_csv import prepare as prepare_verified_badge_csv
from scripts.validate_and_export_reviews import (
    EXPORT_HEADERS,
    load_source_roster_mapping,
    normalize_profile_url,
    process_review_files,
    validate_review_record,
    write_export_atomic,
)

UUID_1 = "11111111-1111-4111-8111-111111111111"
UUID_2 = "22222222-2222-4222-8222-222222222222"
UUID_3 = "33333333-3333-4333-8333-333333333333"

URL_1 = "https://www.skills.google/public_profiles/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
URL_2 = "https://cloudskillsboost.google/public_profiles/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
URL_3 = "https://www.skills.google/public_profiles/cccccccc-cccc-4ccc-8ccc-cccccccccccc"


class ReviewWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.tmp = Path(self.temp_dir.name)

        # Create synthetic 114 rows
        self.workspace_114 = []
        for i in range(1, 115):
            self.workspace_114.append({
                "serial_number": str(i),
                "participant_name": f"Learner {i}",
                "profile_url": f"https://www.skills.google/public_profiles/{i:08d}-0000-4000-8000-000000000000",
                "verified_badge_count": "",
                "review_status": "pending",
                "reviewer": "",
                "reviewed_at": "",
                "review_note": "",
            })

        # Canonical roster mapping
        self.canonical_mapping = {
            "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa": {
                "participant_uuid": UUID_1,
                "participant_name": "Alice Valid",
                "canonical_url": URL_1,
            },
            "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb": {
                "participant_uuid": UUID_2,
                "participant_name": "Bob Valid",
                "canonical_url": URL_2,
            },
            "cccccccc-cccc-4ccc-8ccc-cccccccccccc": {
                "participant_uuid": UUID_3,
                "participant_name": "Charlie Valid",
                "canonical_url": URL_3,
            },
        }

    def tearDown(self):
        self.temp_dir.cleanup()

    def create_csv_file(self, filename: str, rows: list[dict[str, str]], headers: list[str]) -> Path:
        path = self.tmp / filename
        with open(path, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.DictWriter(f, fieldnames=headers)
            w.writeheader()
            w.writerows(rows)
        return path

    # --- Step 1: Partitioning & Assignment Tests ---

    def test_equal_participant_distribution_three_reviewers(self):
        reviewers = ["Reviewer A", "Reviewer B", "Reviewer C"]
        partition = partition_participants(self.workspace_114, reviewers)
        counts = [len(partition[r]) for r in reviewers]
        self.assertEqual(counts, [38, 38, 38])
        self.assertEqual(sum(counts), 114)

    def test_equal_participant_distribution_four_reviewers(self):
        reviewers = ["R1", "R2", "R3", "R4"]
        partition = partition_participants(self.workspace_114, reviewers)
        counts = [len(partition[r]) for r in reviewers]
        self.assertEqual(counts, [29, 29, 28, 28])
        self.assertEqual(sum(counts), 114)

    def test_equal_participant_distribution_five_reviewers(self):
        reviewers = ["R1", "R2", "R3", "R4", "R5"]
        partition = partition_participants(self.workspace_114, reviewers)
        counts = [len(partition[r]) for r in reviewers]
        self.assertEqual(counts, [23, 23, 23, 23, 22])
        self.assertEqual(sum(counts), 114)

    def test_duplicate_assignment_prevention(self):
        reviewers = ["Rev1", "Rev2", "Rev3"]
        partition = partition_participants(self.workspace_114, reviewers)

        all_assigned_serials = []
        for r in reviewers:
            for row in partition[r]:
                all_assigned_serials.append(int(row["serial_number"]))

        # Disjoint: no serial appears twice
        self.assertEqual(len(all_assigned_serials), 114)
        self.assertEqual(len(set(all_assigned_serials)), 114)
        self.assertEqual(set(all_assigned_serials), set(range(1, 115)))

    # --- Step 3 & 4: Validation & Export Tests ---

    def test_blank_count_rejection(self):
        row = {
            "serial_number": "1",
            "participant_name": "Alice Valid",
            "profile_url": URL_1,
            "verified_badge_count": "",
            "review_status": "verified",
            "reviewer": "Reviewer1",
            "reviewed_at": "2026-11-04T12:00:00Z",
            "review_note": "Looked at profile",
        }
        record, issues = validate_review_record(row, "test.csv", 2, self.canonical_mapping)
        self.assertIsNone(record)
        self.assertTrue(any(i["code"] == "blank_count" for i in issues))

    def test_valid_zero_count_accepted_with_explicit_note(self):
        row = {
            "serial_number": "1",
            "participant_name": "Alice Valid",
            "profile_url": URL_1,
            "verified_badge_count": "0",
            "review_status": "verified",
            "reviewer": "Reviewer1",
            "reviewed_at": "2026-11-04T12:00:00Z",
            "review_note": "Confirmed 0 public badges on profile",
        }
        record, issues = validate_review_record(row, "test.csv", 2, self.canonical_mapping)
        self.assertIsNotNone(record)
        self.assertEqual(record["verified_badge_count"], 0)
        self.assertEqual(issues, [])

    def test_zero_count_rejected_without_explicit_note(self):
        row = {
            "serial_number": "1",
            "participant_name": "Alice Valid",
            "profile_url": URL_1,
            "verified_badge_count": "0",
            "review_status": "verified",
            "reviewer": "Reviewer1",
            "reviewed_at": "2026-11-04T12:00:00Z",
            "review_note": "zero",  # < 5 characters
        }
        record, issues = validate_review_record(row, "test.csv", 2, self.canonical_mapping)
        self.assertIsNone(record)
        self.assertTrue(any(i["code"] == "verified_zero_requires_explanation" for i in issues))

    def test_invalid_count_rejected(self):
        bad_counts = ["-1", "1.5", "10001", "abc", "  "]
        for count_val in bad_counts:
            row = {
                "serial_number": "1",
                "participant_name": "Alice Valid",
                "profile_url": URL_1,
                "verified_badge_count": count_val,
                "review_status": "verified",
                "reviewer": "Reviewer1",
                "reviewed_at": "2026-11-04T12:00:00Z",
                "review_note": "Checked profile",
            }
            record, issues = validate_review_record(row, "test.csv", 2, self.canonical_mapping)
            self.assertIsNone(record, f"Count '{count_val}' should have been rejected")
            self.assertTrue(
                any(i["code"] in ("invalid_badge_count", "count_out_of_range", "blank_count") for i in issues)
            )

    def test_missing_reviewer_rejected(self):
        row = {
            "serial_number": "1",
            "participant_name": "Alice Valid",
            "profile_url": URL_1,
            "verified_badge_count": "5",
            "review_status": "verified",
            "reviewer": "",
            "reviewed_at": "2026-11-04T12:00:00Z",
            "review_note": "Checked badges",
        }
        record, issues = validate_review_record(row, "test.csv", 2, self.canonical_mapping)
        self.assertIsNone(record)
        self.assertTrue(any(i["code"] == "missing_reviewer" for i in issues))

    def test_missing_verification_date_rejected(self):
        row = {
            "serial_number": "1",
            "participant_name": "Alice Valid",
            "profile_url": URL_1,
            "verified_badge_count": "5",
            "review_status": "verified",
            "reviewer": "Reviewer1",
            "reviewed_at": "",
            "review_note": "Checked badges",
        }
        record, issues = validate_review_record(row, "test.csv", 2, self.canonical_mapping)
        self.assertIsNone(record)
        self.assertTrue(any(i["code"] == "missing_timestamp" for i in issues))

    def test_conflicting_counts_across_files_excluded(self):
        f1_rows = [{
            "serial_number": "1",
            "participant_name": "Alice Valid",
            "profile_url": URL_1,
            "verified_badge_count": "4",
            "review_status": "verified",
            "reviewer": "Reviewer1",
            "reviewed_at": "2026-11-04T12:00:00Z",
            "review_note": "First count",
        }]
        f2_rows = [{
            "serial_number": "1",
            "participant_name": "Alice Valid",
            "profile_url": URL_1,
            "verified_badge_count": "6",
            "review_status": "verified",
            "reviewer": "Reviewer2",
            "reviewed_at": "2026-11-04T12:10:00Z",
            "review_note": "Conflicting second count",
        }]
        p1 = self.create_csv_file("r1.csv", f1_rows, list(f1_rows[0].keys()))
        p2 = self.create_csv_file("r2.csv", f2_rows, list(f2_rows[0].keys()))

        export_rows, summary, issues = process_review_files([p1, p2])
        self.assertEqual(len(export_rows), 0)
        self.assertTrue(any(i["code"] == "conflicting_counts" for i in issues))

    def test_unknown_participant_rejected_against_roster(self):
        row = {
            "serial_number": "99",
            "participant_name": "Intruder",
            "profile_url": "https://www.skills.google/public_profiles/99999999-9999-4999-8999-999999999999",
            "verified_badge_count": "5",
            "review_status": "verified",
            "reviewer": "Reviewer1",
            "reviewed_at": "2026-11-04T12:00:00Z",
            "review_note": "Profile not registered",
        }
        record, issues = validate_review_record(row, "test.csv", 2, self.canonical_mapping)
        self.assertIsNone(record)
        self.assertTrue(any(i["code"] == "unknown_participant" for i in issues))

    def test_correct_three_column_export_format_and_prepare_compatibility(self):
        valid_rows = [
            {
                "serial_number": "1",
                "participant_name": "Alice Valid",
                "profile_url": URL_1,
                "verified_badge_count": "5",
                "review_status": "verified",
                "reviewer": "Reviewer1",
                "reviewed_at": "2026-11-04T12:00:00Z",
                "review_note": "Verified 5 badges",
            },
            {
                "serial_number": "2",
                "participant_name": "Bob Valid",
                "profile_url": URL_2,
                "verified_badge_count": "0",
                "review_status": "verified",
                "reviewer": "Reviewer2",
                "reviewed_at": "2026-11-04T12:05:00Z",
                "review_note": "Confirmed 0 badges on profile",
            },
        ]
        input_csv = self.create_csv_file("completed_rev.csv", valid_rows, list(valid_rows[0].keys()))
        export_csv = self.tmp / "reviewed_badge_counts.csv"

        export_rows, summary, issues = process_review_files([input_csv])
        self.assertEqual(len(export_rows), 2)
        write_export_atomic(export_csv, export_rows)

        # Inspect exported file headers
        with open(export_csv, "r", encoding="utf-8-sig") as f:
            reader = csv.reader(f)
            headers = next(reader)
        self.assertEqual(headers, ["profile_url", "verified_badge_count", "review_note"])

        # Feed directly into prepare_verified_badge_csv without header error
        roster_csv = self.create_csv_file("roster.csv", [
            {"participant_id": UUID_1, "profile_url": URL_1},
            {"participant_id": UUID_2, "profile_url": URL_2},
        ], ["participant_id", "profile_url"])

        clean, prep_report, skipped = prepare_verified_badge_csv(roster_csv, export_csv)
        self.assertEqual(len(clean), 2)
        self.assertEqual(prep_report["clean_rows"], 2)
        self.assertEqual(clean[0]["participant_id"], UUID_1)
        self.assertEqual(clean[0]["verified_badge_count"], "5")
        self.assertEqual(clean[1]["participant_id"], UUID_2)
        self.assertEqual(clean[1]["verified_badge_count"], "0")

    def test_distribution_summary_calculation(self):
        mixed_rows = [
            {
                "serial_number": "1",
                "participant_name": "Alice Valid",
                "profile_url": URL_1,
                "verified_badge_count": "10",
                "review_status": "verified",
                "reviewer": "Reviewer1",
                "reviewed_at": "2026-11-04T12:00:00Z",
                "review_note": "Verified 10 badges",
            },
            {
                "serial_number": "2",
                "participant_name": "Bob Valid",
                "profile_url": URL_2,
                "verified_badge_count": "0",
                "review_status": "verified",
                "reviewer": "Reviewer2",
                "reviewed_at": "2026-11-04T12:05:00Z",
                "review_note": "Confirmed 0 badges on profile",
            },
            {
                "serial_number": "3",
                "participant_name": "Charlie Valid",
                "profile_url": URL_3,
                "verified_badge_count": "4",
                "review_status": "verified",
                "reviewer": "Reviewer1",
                "reviewed_at": "2026-11-04T12:10:00Z",
                "review_note": "Verified 4 badges",
            },
            {
                "serial_number": "4",
                "participant_name": "Dave Flagged",
                "profile_url": "https://www.skills.google/public_profiles/dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                "verified_badge_count": "",
                "review_status": "flagged",
                "reviewer": "Reviewer1",
                "reviewed_at": "2026-11-04T12:15:00Z",
                "review_note": "Profile is private",
            },
            {
                "serial_number": "5",
                "participant_name": "Eve Pending",
                "profile_url": "https://www.skills.google/public_profiles/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
                "verified_badge_count": "",
                "review_status": "pending",
                "reviewer": "Reviewer2",
                "reviewed_at": "",
                "review_note": "",
            },
        ]
        input_csv = self.create_csv_file("mixed.csv", mixed_rows, list(mixed_rows[0].keys()))
        export_rows, summary, issues = process_review_files([input_csv])

        dist = summary["distribution_summary"]
        self.assertEqual(dist["total_participants"], 5)
        self.assertEqual(dist["successfully_verified"], 3)
        self.assertEqual(dist["verified_zero"], 1)
        self.assertEqual(dist["verified_nonzero"], 2)
        self.assertEqual(dist["unavailable_or_private"], 1)
        self.assertEqual(dist["pending"], 1)
        self.assertEqual(dist["min_verified_badge_count"], 0)
        self.assertEqual(dist["max_verified_badge_count"], 10)
        # Average of [10, 0, 4] is 14 / 3 = 4.67
        self.assertEqual(dist["avg_verified_badge_count"], 4.67)


if __name__ == "__main__":
    unittest.main()


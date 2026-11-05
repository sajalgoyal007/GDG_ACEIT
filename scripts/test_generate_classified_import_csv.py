#!/usr/bin/env python3
"""
Unit tests for scripts/generate_classified_import_csv.py
"""
import csv
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class TestGenerateClassifiedImportCsv(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.dir_path = Path(self.temp_dir.name)

        self.roster_path = self.dir_path / "source-roster.csv"
        self.report_path = self.dir_path / "classification-report.json"
        self.output_csv = self.dir_path / "classified-import.csv"
        self.output_report = self.dir_path / "classified-import-report.json"
        self.validation_report = self.dir_path / "classified-import-validation.json"

    def tearDown(self):
        self.temp_dir.cleanup()

    def _write_files(self, roster_data, report_data, roster_fields=None):
        if roster_fields is None:
            roster_fields = ["participant_uuid", "participant_name", "public_profile_url"]
        with open(self.roster_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=roster_fields)
            writer.writeheader()
            writer.writerows(roster_data)

        self.report_path.write_text(json.dumps(report_data), encoding="utf-8")

    def _run_script(self):
        cmd = [
            sys.executable,
            "scripts/generate_classified_import_csv.py",
            "--classification-report", str(self.report_path),
            "--source-roster", str(self.roster_path),
            "--output", str(self.output_csv),
            "--report", str(self.output_report),
            "--validation-report", str(self.validation_report),
            "--no-backup",
        ]
        return subprocess.run(cmd, capture_output=True, text=True)

    def test_valid_generation(self):
        u1 = "11111111-1111-4111-8111-111111111111"
        u2 = "22222222-2222-4222-8222-222222222222"
        roster = [
            {"participant_uuid": u1, "participant_name": "Alice", "public_profile_url": "https://skills.google/public_profiles/slug-1"},
            {"participant_uuid": u2, "participant_name": "Bob", "public_profile_url": "https://skills.google/public_profiles/slug-2"},
        ]
        report = {
            "per_participant": [
                {
                    "participant_uuid": u1,
                    "profile_url": "https://www.skills.google/public_profiles/slug-1",
                    "skill_badge_count": 3,
                    "arcade_game_badge_count": 1,
                    "unknown_badge_count": 0,
                    "total_badge_count": 4,
                },
                {
                    "participant_uuid": u2,
                    "profile_url": "https://www.skills.google/public_profiles/slug-2",
                    "skill_badge_count": 0,
                    "arcade_game_badge_count": 0,
                    "unknown_badge_count": 0,
                    "total_badge_count": 0,
                },
            ]
        }
        self._write_files(roster, report)
        res = self._run_script()
        self.assertEqual(res.returncode, 0)
        self.assertTrue(self.output_csv.exists())

        with open(self.output_csv, encoding="utf-8-sig") as f:
            reader = list(csv.DictReader(f))
            self.assertEqual(len(reader), 2)
            self.assertEqual(reader[0]["participant_id"], u1)
            self.assertEqual(int(reader[0]["skill_badge_count"]), 3)
            self.assertEqual(int(reader[0]["arcade_game_badge_count"]), 1)
            self.assertEqual(int(reader[0]["total_badge_count"]), 4)

            self.assertEqual(reader[1]["participant_id"], u2)
            self.assertEqual(int(reader[1]["total_badge_count"]), 0)

    def test_production_roster_matching_by_profile_url(self):
        prod_id1 = "aaaa1111-1111-4111-8111-111111111111"
        prod_id2 = "bbbb2222-2222-4222-8222-222222222222"
        old_uuid1 = "99999999-9999-4999-8999-999999999999"

        # Production roster format: participant_id, profile_url
        roster = [
            {"participant_id": prod_id1, "profile_url": "https://www.skills.google/public_profiles/target-profile-1/"},
            {"participant_id": prod_id2, "profile_url": "https://cloudskillsboost.google/public_profiles/target-profile-2"},
        ]
        report = {
            "per_participant": [
                {
                    "participant_uuid": old_uuid1,
                    "participant_name": "Target Learner 1",
                    "profile_url": "https://skills.google/public_profiles/target-profile-1",
                    "skill_badge_count": 5,
                    "arcade_game_badge_count": 2,
                    "unknown_badge_count": 0,
                    "total_badge_count": 7,
                },
                {
                    "participant_uuid": "old-uuid-2",
                    "participant_name": "Target Learner 2",
                    "profile_url": "https://www.skills.google/public_profiles/target-profile-2/",
                    "skill_badge_count": 0,
                    "arcade_game_badge_count": 0,
                    "unknown_badge_count": 0,
                    "total_badge_count": 0,
                },
            ]
        }
        self._write_files(roster, report, roster_fields=["participant_id", "profile_url"])
        res = self._run_script()
        self.assertEqual(res.returncode, 0)

        with open(self.output_csv, encoding="utf-8-sig") as f:
            reader = list(csv.DictReader(f))
            self.assertEqual(len(reader), 2)
            # CRITICAL: Must use NEW production ID, NOT old UUID
            self.assertEqual(reader[0]["participant_id"], prod_id1)
            self.assertNotEqual(reader[0]["participant_id"], old_uuid1)
            self.assertEqual(int(reader[0]["skill_badge_count"]), 5)
            self.assertEqual(int(reader[0]["arcade_game_badge_count"]), 2)
            self.assertEqual(int(reader[0]["total_badge_count"]), 7)

            self.assertEqual(reader[1]["participant_id"], prod_id2)
            self.assertEqual(int(reader[1]["total_badge_count"]), 0)

        # Check validation JSON
        self.assertTrue(self.validation_report.exists())
        val_data = json.loads(self.validation_report.read_text(encoding="utf-8"))
        self.assertEqual(val_data["validation_status"], "passed")
        self.assertEqual(val_data["final_csv_metrics"]["total_skill_badges"], 5)
        self.assertEqual(val_data["final_csv_metrics"]["total_arcade_badges"], 2)
        self.assertEqual(val_data["final_csv_metrics"]["total_badges"], 7)
        self.assertTrue(val_data["final_csv_metrics"]["all_ids_in_production_roster"])
        self.assertTrue(val_data["final_csv_metrics"]["no_old_participant_uuids_used"])

    def test_skips_unknown_badges(self):
        u1 = "11111111-1111-4111-8111-111111111111"
        roster = [
            {"participant_uuid": u1, "participant_name": "Alice", "public_profile_url": "https://skills.google/public_profiles/slug-1"},
        ]
        report = {
            "per_participant": [
                {
                    "participant_uuid": u1,
                    "profile_url": "https://skills.google/public_profiles/slug-1",
                    "skill_badge_count": 3,
                    "arcade_game_badge_count": 1,
                    "unknown_badge_count": 1,  # Has unknown badge!
                    "total_badge_count": 5,
                },
            ]
        }
        self._write_files(roster, report)
        res = self._run_script()
        self.assertEqual(res.returncode, 0)

        with open(self.output_csv, encoding="utf-8-sig") as f:
            reader = list(csv.DictReader(f))
            self.assertEqual(len(reader), 0)  # Excluded

    def test_skips_sum_mismatch(self):
        u1 = "11111111-1111-4111-8111-111111111111"
        roster = [
            {"participant_uuid": u1, "participant_name": "Alice", "public_profile_url": "https://skills.google/public_profiles/slug-1"},
        ]
        report = {
            "per_participant": [
                {
                    "participant_uuid": u1,
                    "profile_url": "https://skills.google/public_profiles/slug-1",
                    "skill_badge_count": 3,
                    "arcade_game_badge_count": 1,
                    "unknown_badge_count": 0,
                    "total_badge_count": 10,  # 3 + 1 != 10
                },
            ]
        }
        self._write_files(roster, report)
        res = self._run_script()
        self.assertEqual(res.returncode, 0)

        with open(self.output_csv, encoding="utf-8-sig") as f:
            reader = list(csv.DictReader(f))
            self.assertEqual(len(reader), 0)  # Excluded


if __name__ == "__main__":
    unittest.main()

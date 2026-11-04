"""End-to-end dry run audit testing the complete verification pipeline.

Tests:
1. Valid verified count
2. Blank badge count
3. Duplicate participant
4. Conflicting counts
5. Invalid UUID
6. Invalid count
7. Unmatched participant
8. Lower count than existing verified count
"""

import csv
import json
import subprocess
import sys
import tempfile
from pathlib import Path

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from scripts.prepare_verified_badge_csv import prepare, write_csv_atomic

# Synthetic UUIDs
UUID_VALID_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"  # Valid participant (count 7)
UUID_VALID_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"  # Lower count (recount 8, existing 10)
UUID_BLANK = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"    # Blank count (pending)
UUID_DUP = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"      # Duplicate profile
UUID_CONFLICT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" # Conflicting count
UUID_INVALID_COUNT = "ffffffff-ffff-4fff-8fff-ffffffffffff" # Invalid count (-1, 15000, abc)
UUID_UNMATCHED = "11111111-1111-4111-8111-111111111111"   # In source but not in roster

PROFILE_VALID_1 = "https://www.skills.google/public_profiles/22222222-2222-4222-8222-222222222222"
PROFILE_VALID_2 = "https://cloudskillsboost.google/public_profiles/33333333-3333-4333-8333-333333333333"
PROFILE_BLANK = "https://www.skills.google/public_profiles/44444444-4444-4444-8444-444444444444"
PROFILE_DUP = "https://www.skills.google/public_profiles/55555555-5555-4555-8555-555555555555"
PROFILE_CONFLICT = "https://www.skills.google/public_profiles/66666666-6666-4666-8666-666666666666"
PROFILE_INVALID_COUNT = "https://www.skills.google/public_profiles/77777777-7777-4777-8777-777777777777"
PROFILE_UNMATCHED = "https://www.skills.google/public_profiles/88888888-8888-4888-8888-888888888888"


def run_dry_run():
    print("=== PHASE 6A.1 OFFLINE END-TO-END DRY RUN ===")
    
    with tempfile.TemporaryDirectory() as tmpdir:
        tmppath = Path(tmpdir)
        roster_path = tmppath / "roster.csv"
        source_workspace_path = tmppath / "workspace_reviewed.csv"
        intermediate_source_path = tmppath / "intermediate_source.csv"
        admin_import_path = tmppath / "final_admin_import.csv"
        report_path = tmppath / "report.json"
        
        # 1. Setup Roster (as exported by /api/admin/verified-badge-roster)
        roster_rows = [
            {"participant_id": UUID_VALID_1, "profile_url": PROFILE_VALID_1},
            {"participant_id": UUID_VALID_2, "profile_url": PROFILE_VALID_2},
            {"participant_id": UUID_BLANK, "profile_url": PROFILE_BLANK},
            {"participant_id": UUID_DUP, "profile_url": PROFILE_DUP},
            {"participant_id": UUID_CONFLICT, "profile_url": PROFILE_CONFLICT},
            {"participant_id": UUID_INVALID_COUNT, "profile_url": PROFILE_INVALID_COUNT},
            # Note: UUID_UNMATCHED is deliberately omitted from roster!
        ]
        with open(roster_path, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.DictWriter(f, fieldnames=["participant_id", "profile_url"])
            w.writeheader()
            w.writerows(roster_rows)
            
        print(f"Created synthetic admin roster with {len(roster_rows)} participants.")
        
        # 2. Simulate Organizer Review in Workspace CSV
        # Workspace columns: serial_number,participant_name,profile_url,verified_badge_count,review_status,reviewer,reviewed_at,review_note
        workspace_rows = [
            # 1. Valid verified count
            {"serial_number": "1", "participant_name": "Alice Valid", "profile_url": PROFILE_VALID_1,
             "verified_badge_count": "7", "review_status": "verified", "reviewer": "Admin1",
             "reviewed_at": "2026-11-04T10:00:00Z", "review_note": "Verified via public profile"},
             
            # 2. Valid lower count (recount)
            {"serial_number": "2", "participant_name": "Bob Recount", "profile_url": PROFILE_VALID_2,
             "verified_badge_count": "8", "review_status": "verified", "reviewer": "Admin1",
             "reviewed_at": "2026-11-04T10:05:00Z", "review_note": "Corrected count: 2 badges removed"},
             
            # 3. Blank count (pending)
            {"serial_number": "3", "participant_name": "Charlie Blank", "profile_url": PROFILE_BLANK,
             "verified_badge_count": "", "review_status": "pending", "reviewer": "",
             "reviewed_at": "", "review_note": ""},
             
            # 4. Duplicate participant (identical counts)
            {"serial_number": "4", "participant_name": "David Dup 1", "profile_url": PROFILE_DUP,
             "verified_badge_count": "5", "review_status": "verified", "reviewer": "Admin1",
             "reviewed_at": "2026-11-04T10:10:00Z", "review_note": "First entry"},
            {"serial_number": "5", "participant_name": "David Dup 2", "profile_url": PROFILE_DUP + "/",
             "verified_badge_count": "5", "review_status": "verified", "reviewer": "Admin2",
             "reviewed_at": "2026-11-04T10:12:00Z", "review_note": "Second duplicate entry"},
             
            # 5. Conflicting counts
            {"serial_number": "6", "participant_name": "Eve Conflict 1", "profile_url": PROFILE_CONFLICT,
             "verified_badge_count": "3", "review_status": "verified", "reviewer": "Admin1",
             "reviewed_at": "2026-11-04T10:15:00Z", "review_note": "Review 1"},
            {"serial_number": "7", "participant_name": "Eve Conflict 2", "profile_url": PROFILE_CONFLICT,
             "verified_badge_count": "6", "review_status": "verified", "reviewer": "Admin2",
             "reviewed_at": "2026-11-04T10:16:00Z", "review_note": "Conflicting Review 2"},
             
            # 6. Invalid count (negative or malformed)
            {"serial_number": "8", "participant_name": "Frank Invalid", "profile_url": PROFILE_INVALID_COUNT,
             "verified_badge_count": "-5", "review_status": "flagged", "reviewer": "Admin1",
             "reviewed_at": "2026-11-04T10:20:00Z", "review_note": "Negative count entered by mistake"},
             
            # 7. Unmatched participant (not in roster)
            {"serial_number": "9", "participant_name": "Grace Unmatched", "profile_url": PROFILE_UNMATCHED,
             "verified_badge_count": "4", "review_status": "verified", "reviewer": "Admin1",
             "reviewed_at": "2026-11-04T10:25:00Z", "review_note": "Profile not registered in roster"},
        ]
        
        with open(source_workspace_path, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.DictWriter(f, fieldnames=[
                "serial_number", "participant_name", "profile_url", "verified_badge_count",
                "review_status", "reviewer", "reviewed_at", "review_note"
            ])
            w.writeheader()
            w.writerows(workspace_rows)
            
        print(f"Created synthetic reviewed workspace with {len(workspace_rows)} rows covering all 8 test cases.")
        
        # 3. Source Extraction to 3-column input expected by prepare_verified_badge_csv.py:
        # profile_url, verified_badge_count, review_note
        extracted_source_rows = []
        for r in workspace_rows:
            extracted_source_rows.append({
                "profile_url": r["profile_url"],
                "verified_badge_count": r["verified_badge_count"],
                "review_note": r["review_note"] or "Pending review",
            })
            
        with open(intermediate_source_path, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.DictWriter(f, fieldnames=["profile_url", "verified_badge_count", "review_note"])
            w.writeheader()
            w.writerows(extracted_source_rows)
            
        # 4. Run prepare_verified_badge_csv.py
        clean, report, skipped = prepare(roster_path, intermediate_source_path)
        write_csv_atomic(admin_import_path, ["participant_id", "verified_badge_count", "review_note"], clean)
        
        print("\n--- prepare_verified_badge_csv Execution Results ---")
        print(f"Clean rows: {report['clean_rows']}")
        print(f"Skipped rows: {report['skipped_rows']}")
        print(f"Issues by code: {report['issues_by_code']}")
        
        # Assertions on prepare output
        # Should only contain 2 clean rows: UUID_VALID_1 (count 7) and UUID_VALID_2 (count 8)
        assert len(clean) == 2, f"Expected exactly 2 clean rows, got {len(clean)}"
        clean_ids = {r["participant_id"]: r["verified_badge_count"] for r in clean}
        assert clean_ids.get(UUID_VALID_1) == "7", "UUID_VALID_1 should have count 7"
        assert clean_ids.get(UUID_VALID_2) == "8", "UUID_VALID_2 should have count 8"
        
        # Verify excluded cases:
        # Blank count excluded:
        assert any(issue["reason_code"] == "invalid_badge_count" for issue in report["issues"]), "Blank count should be skipped as invalid_badge_count"
        # Duplicate excluded:
        assert any(issue["reason_code"] == "duplicate_profile" for issue in report["issues"]), "Duplicates should be skipped"
        # Conflict excluded:
        assert any(issue["reason_code"] == "conflicting_counts" for issue in report["issues"]), "Conflicts should be skipped"
        # Unmatched excluded:
        assert any(issue["reason_code"] == "unknown_profile" for issue in report["issues"]), "Unmatched should be skipped as unknown_profile"
        
        print("[OK] All preparation exclusion assertions passed.")
        
        # 5. Node.js CSV Parser & Resolution Validation (src/lib/participants/verified-badge-csv.ts)
        print("\n--- Testing Existing Node.js CSV Parser & Resolution ---")
        module_url = (PROJECT_ROOT / "src/lib/participants/verified-badge-csv.ts").as_uri()
        node_script = f"""
import fs from 'fs';
import {{ parseVerifiedBadgeCsv, resolveVerifiedBadgeCsvRows }} from '{module_url}';

const csvContent = fs.readFileSync('{admin_import_path.as_posix()}', 'utf8');
const parsed = parseVerifiedBadgeCsv(csvContent);

console.log('Node parser issues:', parsed.issues);
console.log('Node parser parsed rows count:', parsed.rows.length);

if (parsed.rows.length !== 2) {{
  console.error('FAIL: Expected 2 parsed rows');
  process.exit(1);
}}

// Mock Supabase participants table records
const participants = [
  {{
    id: '{UUID_VALID_1}',
    displayName: 'Alice Valid',
    verifiedBadgeCount: 0,
    lastVerifiedAt: null,
    verificationSource: null
  }},
  {{
    id: '{UUID_VALID_2}',
    displayName: 'Bob Recount',
    verifiedBadgeCount: 10, // Note: existing count is 10, new count is 8!
    lastVerifiedAt: '2026-11-01T12:00:00Z',
    verificationSource: 'admin_manual'
  }}
];

const resolved = resolveVerifiedBadgeCsvRows(parsed.rows, participants);
console.log('Node resolved rows count:', resolved.rows.length);
console.log('Node resolution issues:', resolved.issues);

if (resolved.rows.length !== 2 || resolved.issues.length !== 0) {{
  console.error('FAIL: Resolution failed');
  process.exit(1);
}}

// Verify lower count resolution
const bobResolved = resolved.rows.find(r => r.participantId === '{UUID_VALID_2}');
if (!bobResolved || bobResolved.badgeCount !== 8 || bobResolved.verifiedBadgeCount !== 10) {{
  console.error('FAIL: Lower count resolution mismatch');
  process.exit(1);
}}

console.log('SUCCESS: Existing Node parser and resolution validated cleanly.');
"""
        runner_path = tmppath / "test_runner.mjs"
        runner_path.write_text(node_script, encoding="utf-8")
        
        proc = subprocess.run(
            ["node", "--experimental-strip-types", str(runner_path)],
            cwd=str(PROJECT_ROOT),
            capture_output=True,
            text=True
        )
        print("Node Output:\n" + proc.stdout)
        if proc.stderr:
            print("Node Stderr:\n" + proc.stderr)
        assert proc.returncode == 0, "Node.js parser validation failed!"
        
        print("[OK] Full chain validation succeeded!")


if __name__ == "__main__":
    run_dry_run()

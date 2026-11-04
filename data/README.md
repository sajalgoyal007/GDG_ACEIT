# Data Artifact Directory — GDG On Campus ACEIT

This directory contains participant rosters, badge observation logs, automated collection results, badge classification artifacts, and admin import files for the GDG ACEIT Leaderboard.

---

## ⚠️ CRITICAL NOTICE FOR ADMIN IMPORT

### ✅ THE ONLY FILE TO UPLOAD TO THE WEBSITE:
```
data/classified-badge-import.csv
```
- **Target Importer:** Admin Workspace → **Classified Badge Data Import** (`#classified-badge-import`)
- **Required Header:**
  `participant_id,skill_badge_count,arcade_game_badge_count,total_badge_count,review_note`
- **Verified Record Count:** Exactly 114 registered participants.
- **Classification Totals:** 123 Skill Badges + 11 Arcade Game Badges = 134 Total Badges.
- **Zero vs Non-Zero Breakdown:** 90 verified zeroes, 24 non-zero earners.

### 🚫 DO NOT UPLOAD ANY OTHER CSV FILE TO THE CLASSIFIED IMPORTER:
- Never upload `data/participant-verification-workspace.csv`
- Never upload `data/verified-badge-counts-source.csv`
- Never upload `data/automated-badge-counts.csv`
- Never upload `data/reviewed-badge-counts.csv`
- Never upload `data/badge-classification.csv`
- Never upload `data/verified-badge-import-admin.csv`

---

## File Classification & Purpose

| File | Classification | Purpose | Upload to Web? |
| :--- | :--- | :--- | :---: |
| `classified-badge-import.csv` | **Final Admin Import** | Production CSV containing the 114 audited participant rows with categorized Skill and Arcade badge counts. | **YES (Classified Importer)** |
| `classified-badge-import-report.json` | **Final Admin Import** | JSON summary audit verifying 114 rows, 123 skill badges, 11 arcade badges, and sum invariants. | No (Audit Reference) |
| `badge-classification.csv` | **Badge Classification Output** | 134 individual awarded badge records classified into `SKILL_BADGE` (123) or `ARCADE_GAME_BADGE` (11). | No (Audit Reference) |
| `badge-classification-report.json` | **Badge Classification Output** | Machine-readable classification audit report with method breakdowns and signal distributions. | No (Audit Reference) |
| `automated-badge-counts.csv` | **Intermediate Processing Output** | Automated profile retrieval results for all 114 participants with reviewer audit metadata. | No (Do NOT upload) |
| `reviewed-badge-counts.csv` | **Intermediate Processing Output** | Intermediate URL-to-count review records. | No (Do NOT upload) |
| `reviewed-badge-counts-validated.csv` | **Intermediate Processing Output** | Validated URL-to-count review records. | No (Do NOT upload) |
| `participant-verification-workspace.csv` | **Canonical Source Data** | Human-friendly review workspace with serial numbers and reviewer allocations. | No (Do NOT upload) |
| `verified-badge-counts-source.csv` | **Canonical Source Data** | Canonical roster mapping participant UUIDs to public profile URLs and verification statuses. | No (Do NOT upload) |
| `verified-badge-import-admin.csv` | **Legacy Output** | Phase 6B legacy single-count verification CSV (`participant_id,verified_badge_count,review_note`). Superseded by `classified-badge-import.csv`. | No (Obsolete) |


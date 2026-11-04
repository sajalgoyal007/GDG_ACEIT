# Google Skills Boost Badge Manual Verification Guide

**Project:** GDG On Campus ACEIT Leaderboard  
**Target Group:** 114 Registered Participants  
**Audience:** Community Organizers & Designated Reviewers  

---

## 1. Core Principles & Strict Policy

This guide defines the standardized procedure for community organizers to manually verify Google Skills Boost public profile badge counts for registered participants.

### Mandatory Compliance Rules:
1. **Human Manual Inspection Only**: All profile checks must be conducted manually in a standard personal desktop web browser.
2. **Strict Prohibition on Automation**: **Do not** use web scrapers, automated scripts, curl loops, headless browsers (e.g., Puppeteer, Playwright, Selenium), browser extensions, or CAPTCHA bypass mechanisms.
3. **Zero Estimation Policy**: **Never estimate, extrapolate, or fabricate badge counts.** Every recorded badge count must be directly observed on the participant's official public profile page.
4. **Audit Trail Accountability**: Every verified entry is logged into the system with the reviewer's identity, timestamp, and review note, forming an unalterable audit record in Supabase (`participant_audit_events`).
5. **Individual Profile Accountability**: Do not assume all participants have zero badges. Every participant must be checked individually.
6. **No Default or Fallback Zero**: Never use 0 as a default, fallback, or placeholder. Enter 0 only when the profile is accessible, correctly matched, and genuinely displays zero awarded badges.
7. **No Count Propagation**: Never copy one participant's count to another participant or derive counts from participant names.
8. **Inaccessible Profiles Must Stay Blank**: If a profile cannot be verified (e.g. 404, private, broken link), mark it `flagged` or `unreachable` and leave the count strictly blank.

---

## 2. Reviewer Workspace & Batch Assignment

Each reviewer is assigned an individual CSV file in `data/assignments/` (e.g., `reviewer_1.csv`):

| Column | Description | Instructions |
| :--- | :--- | :--- |
| `serial_number` | 1–114 sequential identifier | **Do not modify.** Keeps sorting stable. |
| `participant_name` | Registered learner name | **Do not modify.** Reference for cross-checking. |
| `profile_url` | Canonical public profile link | **Do not modify.** URL to open in browser. |
| `verified_badge_count` | Observed badge count | Enter integer (`0` to `10000`). Leave blank if unverified. |
| `review_status` | Current status | Change from `pending` to `verified`, `flagged`, or `unreachable`. |
| `reviewer` | Reviewer name/handle | Enter your official organizer name (e.g., `Sajal Goyal`). |
| `reviewed_at` | Review timestamp | Enter current ISO timestamp or date (`YYYY-MM-DD` or `YYYY-MM-DDTHH:MM:SSZ`). |
| `review_note` | Audit / evidence note | Provide factual description of the observation. |

---

## 3. Step-by-Step Profile Inspection Procedure

### Step 3.1: Open the Public Profile URL
1. Copy the `profile_url` from your assigned row.
2. Paste it into your web browser address bar (must start with `https://www.skills.google/public_profiles/` or `https://cloudskillsboost.google/public_profiles/`).
3. Press **Enter** and wait for the page to completely finish loading.

### Step 3.2: Inspect Visible Badges (Official Counting Rule)

> **FINAL COUNTING RULE (DECIDED):**  
> **Count ALL currently awarded badges visibly displayed in each participant's Google Skills Boost public profile.**  
> - **Do NOT distinguish between badge types:** Count Arcade Game Badges, Skill Badges, Course Completion Badges, and all other awarded badges.
> - **Do NOT filter by date or campaign period:** Count all visible badges regardless of whether they were earned in 2026, 2025, 2024, or earlier.
> - **Objective:** Record the total visible count of all awarded badges currently present on the public profile.

1. Locate the **Badges** section on the participant's public profile page.
2. Count the total number of awarded badge cards visibly rendered in this section.
3. Verify that the displayed learner name roughly corresponds to or is consistent with the registered participant.

---

## 4. How to Record Specific Scenarios

### Scenario A: Visible Badge Count > 0
- Set `verified_badge_count`: Enter the exact number of visible badges (e.g. `7`).
- Set `review_status`: `verified`
- Set `reviewer`: Your organizer name (e.g. `Jane Doe`).
- Set `reviewed_at`: `2026-11-04T12:00:00Z`
- Set `review_note`: Factual summary (e.g., `"Verified 7 visible badges on public profile"`).

### Scenario B: Verified Zero Badges (Profile exists but has 0 badges)
- When a profile exists and loads normally, but has no badges earned or displays 0 badges:
- Set `verified_badge_count`: **`0`** (**DO NOT LEAVE BLANK**).
- Set `review_status`: `verified`
- Set `reviewer`: Your organizer name.
- Set `reviewed_at`: Current timestamp.
- Set `review_note`: **Explicit explanation required**, e.g., `"Confirmed public profile has 0 earned badges"`.
> **Note:** A blank entry is treated as *pending review*, NOT as zero. You must explicitly type `0` to verify a zero count.

### Scenario C: Private, Missing, or 404 Profiles
- If the URL returns a `404 Not Found`, page fails to load, profile is set to private, or profile belongs to a different unrelated user:
- Set `verified_badge_count`: Leave **strictly blank** (`""`).
- Set `review_status`: `flagged` (or `unreachable`).
- Set `reviewer`: Your organizer name.
- Set `reviewed_at`: Current timestamp.
- Set `review_note`: Detailed explanation, e.g., `"Profile returned 404 Not Found; requires participant contact"`.
> **Rule:** Never record 0 for an inaccessible or private profile. The participant must be given the opportunity by the organizer team to make their profile public.

### Scenario D: Ambiguous or Suspicious Profiles
- If the profile shows signs of being shared across multiple participants, or contains conflicting identity indicators:
- Set `verified_badge_count`: Leave blank (`""`).
- Set `review_status`: `flagged`
- Set `review_note`: Explain discrepancy (e.g., `"Profile name conflicts with registration; flagged for admin review"`).

---

## 5. Preventing Duplication and Conflicts

1. **Work Only Within Your Assigned Batch**: Each reviewer has an exclusive range of serial numbers. Do not inspect or edit records assigned to other reviewers.
2. **Do Not Re-verify Completed Rows**: Once a row is marked `verified`, avoid changing it unless correcting a demonstrable counting error.
3. **Recount / Correction Procedure**: If a participant had an existing count and you are correcting it (e.g., previously recorded 10, recount shows 8):
   - Enter `verified_badge_count`: `8`
   - Set `review_note`: `"Recount correction: removed 2 duplicate badge entries"`.
   - The admin import will preserve the previous count in the audit log.

---

## 6. Pre-Submission Checklist

Before submitting your completed CSV file for validation and export:
- [ ] No row intended as verified has an empty `verified_badge_count`.
- [ ] Verified zero counts are entered as `0`, not left blank.
- [ ] Every verified row has a valid `reviewer` name, `reviewed_at` date, and informative `review_note`.
- [ ] No estimated, guessed, or unverified counts are entered.
- [ ] File is saved in UTF-8 format.


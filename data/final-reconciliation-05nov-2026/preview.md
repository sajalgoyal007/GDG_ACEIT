# Final 195-Participant Reconciliation Preview

Generated: 2026-11-06T05:49:10.875116+00:00

## Source

- CSV rows: **195**
- Distinct normalized Google Skills profile URLs: **195**
- Duplicate profile URLs: **0**
- Invalid profile URLs: **0**

## Classification (every row accounted for exactly once)

| Category | Count |
| :--- | ---: |
| Exact URL + name match | 190 |
| URL match with differing name | 5 |
| New participant | 0 |
| Production-only (absent from CSV) | 7 |
| Invalid | 0 |
| **Total** | **195** |

## Badge verification

- Profiles verified: **195 / 195**
- Explicitly verified zero: **155**
- Verified with badges: **40**
- Inaccessible / unverified: **0**
- Evidence fetch window: **2026-11-06T04:48:44Z → 2026-11-06T05:44:32Z**
- Proposed Skill badges: **200**
- Proposed Arcade badges: **16**
- Proposed combined total: **216**

Every profile returned HTTP 200 with a canonical URL matching the expected participant.
Skill and Arcade badges were classified from distinct structural modal links, and totals
are unique badge identities, not repeated HTML elements.

## Name corrections (URL identity is authoritative)

| Participant UUID | Current | CSV | Public profile | Proposed | Action |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `1aba2a95-8cfb-43bf-adb4-9a3c73366d92` | Danish Usman and | Danish Usman | Danish Usman | Danish Usman | correct |
| `3fd4444d-7b4e-482c-a775-fa7577c36c96` | Gautan Jangid | Gautam jangid | Gautam Jangid | Gautam Jangid | correct |
| `e8f0688f-b418-4f15-9886-ebdd7e97fbe3` | Ridhima Gupta | Ridhima | Ridhima Gupta | Ridhima Gupta | keep_current |
| `588b78eb-4705-4dba-80a0-f2ea6cdf7084` | Rocky yogi | Rocky | Rocky Yogi | Rocky Yogi | keep_current |
| `a8142567-1b1f-42da-9451-273e53dd5103` | Ujjwal Singh | Ujjwal Kumar Singh | Ujjwal Singh | Ujjwal Singh | keep_current |

Name corrections are prepared for review only. No approved rename workflow exists.

## Removal proposals (production-only records)

| UUID | Name | Profile URL | Verified | Skill | Arcade |
| :--- | :--- | :--- | ---: | ---: | ---: |
| `96e3f84b-0a8a-4949-a13b-9480ea2ad247` | Aaryan Sharma | https://www.skills.google/public_profiles/e5a728d5-a3a9-4f6e-ac78-a3258061dfce | 0 | 0 | 0 |
| `64a6be93-7070-4b03-a491-10eef8c907ac` | Chirag Bhavnani | https://www.skills.google/public_profiles/a65f959b-6c39-4f2b-b5b9-29f230189cf4 | 18 | 13 | 5 |
| `27ae37f9-e2cc-423f-a811-e6515e435913` | Komal | https://www.skills.google/public_profiles/3e6d1d14-1231-447c-8c44-3b2620fc7136 | 0 | 0 | 0 |
| `25303bee-97b6-489c-9bd9-b6cb5b2d79c8` | Nimit Patidar | https://www.skills.google/public_profiles/37528521-c794-4e61-9b88-b73d6adb1116 | 0 | 0 | 0 |
| `599f7bcb-9470-4688-b87d-8e4cea912acd` | Rohit Choudhary | https://www.skills.google/public_profiles/595cb8c3-9298-4c65-9dc7-0180f9e391e4 | 2 | 2 | 0 |
| `ca7bf9b4-b953-4ebb-8d30-11fb422cd78d` | SALONI SHARMA | https://www.skills.google/public_profiles/7b335424-b07d-49d5-bf3c-14951722ef0c | 0 | 0 | 0 |
| `b79fd3e1-2427-4e38-98a4-26d697465677` | Wasid Ali | https://www.skills.google/public_profiles/23c893ff-38ba-4d5f-bc53-27226032229f | 0 | 0 | 0 |

Removal proposals: **7**. Their verified badges: 15 Skill / 5 Arcade / 20 total.

Recommended action is **soft removal from the public registered leaderboard**
(preserving the row and audit history). No approved unregister workflow currently
exists, so no production removal has been executed.

## Required checkpoint

- Proposed final roster: **195** distinct participant UUIDs and **195** distinct profile URLs.
- Classified import CSV: **195** unique participant rows with Skill + Arcade = Total.
- Manual review: **0**.
- Validation: **PASSED**.

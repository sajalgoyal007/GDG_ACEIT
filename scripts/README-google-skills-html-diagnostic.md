# Offline Google Skills HTML diagnostic

This standalone Python 3 tool inspects **local saved HTML only**. It has no HTTP client and never requests a profile. It emits only capture filenames, a validated canonical public-profile URL/UUID, structural counts, boolean marker flags, and structural warnings. It never outputs page text, profile names, images, or raw HTML.

## Run

From the repository root:

```powershell
py scripts/google_skills_html_diagnostic.py .\path\to\saved-captures
```

Save the sanitized JSON report outside the input directory if desired:

```powershell
py scripts/google_skills_html_diagnostic.py .\path\to\saved-captures --output .\diagnostic-report.json
```

The input directory is scanned recursively for `.html` and `.htm` files. Files that cannot be read appear as `incomplete_or_unexpected_response`; their contents and OS error details are not emitted.

## Classifications

- `badge_cards_detected`: one recognized `div.profile-badges` container with descendant `div.profile-badge` candidates and no detected structural/loading/access warning.
- `explicit_empty_state`: no badge cards and one of the narrowly listed empty marker forms or exact phrases was detected.
- `badge_container_missing`: no recognized badge container and no explicit empty marker.
- `empty_unconfirmed`: one recognized container exists but has no cards and no recognized explicit marker.
- `incomplete_or_unexpected_response`: malformed/unclosed relevant markup, missing/ambiguous canonical identity, duplicate/nested/orphan card structure, multiple containers, or loading/challenge/access-denied markers.

The parser looks for these exact empty markers: classes `profile-badges-empty`, `empty-badges`, `no-badges`, `badge-empty-state`; `data-testid` values `profile-badges-empty`, `empty-badges`, `no-badges`; `data-empty-state="true|empty|no-badges"`; and exact normalized phrases `no badges earned yet`, `you have not earned any badges yet`, `you haven't earned any badges yet`, or `no badges to display` inside an element marked `role="status"`. It does not use headings or titles to infer emptiness. These are **diagnostic candidates only**. No Google documentation has established these as a guaranteed zero-state contract. Therefore `explicit_empty_state` must not be treated as a verified zero without an authoritative source guarantee and identity/completeness review.

Loading, challenge, and access-denied detection is likewise a narrow structural/text marker check, not a comprehensive detector. A clear page that does not match known patterns may still be incomplete. Badge card counts are DOM candidates, not verified totals; this tool does not deduplicate visually repeated cards unless duplicate explicit `data-badge-id` values make the file fail closed. Missing IDs prevent reliable deduplication.

## Tests and synthetic fixtures

Run the standard-library tests with:

```powershell
py -m unittest scripts.test_google_skills_html_diagnostic -v
```

Fixtures under `scripts/fixtures/google-skills-html/` are synthetic and use reserved `.example` URLs. They test an explicit empty marker, positive cards, an empty container, a missing container, malformed markup, and loading/challenge/access-denied responses. They are not representations of Google's actual zero-badge HTML.

`docs/diagnostics/google-skills-html-structure-comparison.json` is a sanitized report generated from these synthetic fixtures. It demonstrates what the tool can distinguish; it is not evidence about Google's live zero-state markup. Existing saved real captures in `src/lib/auto-progress/fixtures/` are badge-bearing examples only. No zero-badge HTML capture was present when this report was generated, so the actual Google empty-state structure remains unverified.

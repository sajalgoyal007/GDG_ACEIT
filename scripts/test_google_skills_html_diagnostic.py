import unittest
from pathlib import Path

from scripts.google_skills_html_diagnostic import analyze_directory, analyze_html


FIXTURES = Path(__file__).parent / "fixtures" / "google-skills-html"


class GoogleSkillsHtmlDiagnosticTests(unittest.TestCase):
    def test_extracts_canonical_url_and_uuid_and_counts_descendant_cards(self):
        html = (FIXTURES / "positive-two-cards.html").read_text(encoding="utf-8")
        result = analyze_html(html)
        self.assertEqual(result["classification"], "badge_cards_detected")
        self.assertEqual(result["badge_container_count"], 1)
        self.assertEqual(result["badge_card_count"], 2)
        self.assertEqual(result["profile_uuid"], "00000000-0000-4000-8000-000000000001")
        self.assertEqual(result["canonical_profile_url"], "https://www.skills.google/public_profiles/00000000-0000-4000-8000-000000000001")

    def test_explicit_empty_marker_is_detected_but_not_called_a_verified_zero(self):
        html = (FIXTURES / "explicit-empty-marker.html").read_text(encoding="utf-8")
        result = analyze_html(html)
        self.assertEqual(result["classification"], "explicit_empty_state")
        self.assertEqual(result["badge_card_count"], 0)
        self.assertTrue(result["explicit_empty_marker"])

    def test_exact_empty_text_requires_a_status_marker_and_is_not_inferred_from_page_title(self):
        canonical = '<link rel="canonical" href="https://www.skills.google/public_profiles/00000000-0000-4000-8000-000000000010">'
        status_text = analyze_html(f"<html><head>{canonical}</head><body><p role='status'>No badges earned yet</p></body></html>")
        title_text = analyze_html(f"<html><head>{canonical}</head><body><h1>No badges earned yet</h1></body></html>")
        self.assertEqual(status_text["classification"], "explicit_empty_state")
        self.assertEqual(title_text["classification"], "badge_container_missing")

    def test_empty_and_missing_containers_remain_distinct_unknown_states(self):
        empty = analyze_html((FIXTURES / "empty-container.html").read_text(encoding="utf-8"))
        missing = analyze_html((FIXTURES / "missing-container.html").read_text(encoding="utf-8"))
        self.assertEqual(empty["classification"], "empty_unconfirmed")
        self.assertEqual(missing["classification"], "badge_container_missing")
        self.assertFalse(empty["explicit_empty_marker"])
        self.assertFalse(missing["explicit_empty_marker"])

    def test_malformed_loading_challenge_and_access_denied_fail_closed(self):
        cases = {
            "malformed-section.html": "malformed_or_unclosed_badge_section",
            "loading-response.html": "loading_marker",
            "challenge-response.html": "challenge_marker",
            "access-denied-response.html": "access_denied_marker",
        }
        for filename, warning in cases.items():
            with self.subTest(filename=filename):
                result = analyze_html((FIXTURES / filename).read_text(encoding="utf-8"))
                self.assertEqual(result["classification"], "incomplete_or_unexpected_response")
                detected = result["structure_warnings"].get(warning, result.get(warning))
                self.assertTrue(detected)

    def test_identity_or_card_structure_ambiguity_fails_closed(self):
        missing_identity = '<div class="profile-badges"><div class="profile-badge"></div></div>'
        self.assertEqual(analyze_html(missing_identity)["classification"], "incomplete_or_unexpected_response")
        duplicate_ids = '''<link rel="canonical" href="https://www.skills.google/public_profiles/00000000-0000-4000-8000-000000000009">
        <div class="profile-badges"><div class="profile-badge" data-badge-id="same"></div>
        <div class="profile-badge" data-badge-id="same"></div></div>'''
        duplicate = analyze_html(duplicate_ids)
        self.assertEqual(duplicate["classification"], "incomplete_or_unexpected_response")
        self.assertEqual(duplicate["structure_warnings"]["duplicate_explicit_badge_ids"], 1)

    def test_report_is_structural_and_compares_available_groups(self):
        report = analyze_directory(FIXTURES)
        self.assertEqual(report["mode"], "offline_local_html_only")
        self.assertEqual(report["files_scanned"], 8)
        self.assertTrue(report["comparison"]["both_groups_present"])
        encoded = str(report)
        self.assertNotIn("Example card", encoded)
        self.assertNotIn("Truncated card", encoded)


if __name__ == "__main__":
    unittest.main()

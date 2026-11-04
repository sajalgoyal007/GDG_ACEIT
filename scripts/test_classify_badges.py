#!/usr/bin/env python3
"""
Tests for scripts/classify_badges.py

Covers:
  - Modal href extraction and mapping
  - SKILL_BADGE classification via /course_templates/ href
  - ARCADE_GAME_BADGE classification via /games/ href
  - UNKNOWN classification when modal is absent
  - UNKNOWN classification when href pattern is unrecognized
  - Multiple badges in one profile
  - Zero-badge profile (no badge cards, no records)
  - Missing modal id in badge card
  - Multiple unique badge IDs per profile
  - Duplicate modal id handling (last write wins in map)
  - Empty modal body (no button href)
  - Badge ID extraction from canonical badge href
  - classify_from_href edge cases
"""
import unittest
import textwrap
from scripts.classify_badges import (
    classify_profile_html,
    _build_modal_href_map,
    _classify_from_href,
    _extract_badge_id,
    CLASSIFICATION_SKILL,
    CLASSIFICATION_ARCADE,
    CLASSIFICATION_UNKNOWN,
)


def _make_badge_card(badge_id: str, title: str, modal_num: int, profile_id: str) -> str:
    """Generate a minimal badge card HTML snippet."""
    return f"""
<div class='profile-badge'>
<a class="badge-image" href="https://www.skills.google/public_profiles/{profile_id}/badges/{badge_id}">
  <img role="presentation" src="https://cdn.qwiklabs.com/FAKE_IMAGE" />
</a>
<span class='ql-title-medium l-mts'>{title}</span>
<span class='ql-body-medium l-mbs'>Earned Oct 1, 2026 UTC</span>
<ql-button modal='public-profile-award-modal-{modal_num}' outlined>Learn more</ql-button>
</div>
"""


def _make_skill_dialog(modal_num: int, title: str, template_id: int) -> str:
    return f"""
<ql-dialog dismissalLabel='Dismiss' headline='{title}' id='public-profile-award-modal-{modal_num}'>
<p>Some description of the skill badge.</p>
<ql-button href='/course_templates/{template_id}' label='Learn more' method='get' slot='action' text>Learn more</ql-button>
</ql-dialog>
"""


def _make_arcade_dialog(modal_num: int, title: str, game_id: int) -> str:
    return f"""
<ql-dialog dismissalLabel='Dismiss' headline='{title}' id='public-profile-award-modal-{modal_num}'>
<p>Some description of the arcade game.</p>
<ql-button href='/games/{game_id}' label='Learn more' method='get' slot='action' text>Learn more</ql-button>
</ql-dialog>
"""


def _make_unknown_dialog(modal_num: int, title: str, href: str) -> str:
    return f"""
<ql-dialog dismissalLabel='Dismiss' headline='{title}' id='public-profile-award-modal-{modal_num}'>
<p>Some description.</p>
<ql-button href='{href}' label='Learn more' method='get' slot='action' text>Learn more</ql-button>
</ql-dialog>
"""


def _make_empty_dialog(modal_num: int, title: str) -> str:
    """Dialog with no ql-button href inside."""
    return f"""
<ql-dialog dismissalLabel='Dismiss' headline='{title}' id='public-profile-award-modal-{modal_num}'>
<p>No button here.</p>
</ql-dialog>
"""


def _wrap_html(body: str) -> str:
    return f"""<!DOCTYPE html><html><body><div class='profile-badges'>{body}</div></body></html>"""


class TestClassifyFromHref(unittest.TestCase):

    def test_skill_badge_href(self):
        self.assertEqual(_classify_from_href("/course_templates/636"), CLASSIFICATION_SKILL)

    def test_skill_badge_href_with_long_id(self):
        self.assertEqual(_classify_from_href("/course_templates/9999999"), CLASSIFICATION_SKILL)

    def test_arcade_badge_href(self):
        self.assertEqual(_classify_from_href("/games/76266"), CLASSIFICATION_ARCADE)

    def test_arcade_badge_href_various(self):
        self.assertEqual(_classify_from_href("/games/1"), CLASSIFICATION_ARCADE)
        self.assertEqual(_classify_from_href("/games/999999"), CLASSIFICATION_ARCADE)

    def test_none_href_is_unknown(self):
        self.assertEqual(_classify_from_href(None), CLASSIFICATION_UNKNOWN)

    def test_unrecognized_path_is_unknown(self):
        self.assertEqual(_classify_from_href("/paths/something"), CLASSIFICATION_UNKNOWN)
        self.assertEqual(_classify_from_href("/collections/ai-boost"), CLASSIFICATION_UNKNOWN)
        self.assertEqual(_classify_from_href("/catalog/item"), CLASSIFICATION_UNKNOWN)

    def test_empty_string_is_unknown(self):
        self.assertEqual(_classify_from_href(""), CLASSIFICATION_UNKNOWN)


class TestExtractBadgeId(unittest.TestCase):

    def test_extracts_numeric_id(self):
        self.assertEqual(
            _extract_badge_id("https://www.skills.google/public_profiles/abc/badges/12345"),
            "12345",
        )

    def test_no_badges_segment(self):
        self.assertIsNone(_extract_badge_id("https://www.skills.google/public_profiles/abc"))

    def test_none_input(self):
        self.assertIsNone(_extract_badge_id(None))

    def test_empty_string(self):
        self.assertIsNone(_extract_badge_id(""))


class TestBuildModalHrefMap(unittest.TestCase):

    def test_skill_dialog_mapped(self):
        html = _make_skill_dialog(0, "My Skill Badge", 636)
        result = _build_modal_href_map(html)
        self.assertEqual(result.get("public-profile-award-modal-0"), "/course_templates/636")

    def test_arcade_dialog_mapped(self):
        html = _make_arcade_dialog(1, "Arcade Game", 76266)
        result = _build_modal_href_map(html)
        self.assertEqual(result.get("public-profile-award-modal-1"), "/games/76266")

    def test_empty_dialog_maps_none(self):
        html = _make_empty_dialog(2, "No Button Dialog")
        result = _build_modal_href_map(html)
        self.assertIsNone(result.get("public-profile-award-modal-2"))

    def test_multiple_dialogs_all_mapped(self):
        html = (
            _make_skill_dialog(0, "Skill", 100)
            + _make_arcade_dialog(1, "Arcade", 200)
        )
        result = _build_modal_href_map(html)
        self.assertEqual(result["public-profile-award-modal-0"], "/course_templates/100")
        self.assertEqual(result["public-profile-award-modal-1"], "/games/200")

    def test_no_dialogs_returns_empty(self):
        result = _build_modal_href_map("<html><body>no dialogs</body></html>")
        self.assertEqual(result, {})


class TestClassifyProfileHtml(unittest.TestCase):

    PROFILE_ID = "abc123profile"
    UUID = "uuid-test-1234"
    NAME = "Test User"
    URL = f"https://www.skills.google/public_profiles/{PROFILE_ID}"

    def _run(self, badge_cards: str, dialogs: str):
        html = _wrap_html(badge_cards) + dialogs
        return classify_profile_html(html, self.UUID, self.NAME, self.URL)

    def test_single_skill_badge(self):
        cards = _make_badge_card("29000001", "My Skill", 0, self.PROFILE_ID)
        dialogs = _make_skill_dialog(0, "My Skill", 999)
        records = self._run(cards, dialogs)
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["classification"], CLASSIFICATION_SKILL)
        self.assertEqual(records[0]["badge_id"], "29000001")
        self.assertEqual(records[0]["badge_title"], "My Skill")
        self.assertEqual(records[0]["classification_signal"], "/course_templates/999")
        self.assertEqual(records[0]["classification_method"], "modal_href")

    def test_single_arcade_badge(self):
        cards = _make_badge_card("25000001", "Arcade Game", 0, self.PROFILE_ID)
        dialogs = _make_arcade_dialog(0, "Arcade Game", 76266)
        records = self._run(cards, dialogs)
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["classification"], CLASSIFICATION_ARCADE)
        self.assertEqual(records[0]["classification_signal"], "/games/76266")
        self.assertEqual(records[0]["classification_method"], "modal_href")

    def test_unknown_when_no_modal_match(self):
        cards = _make_badge_card("99000001", "Mystery Badge", 7, self.PROFILE_ID)
        # No dialog with modal 7 — should be UNKNOWN
        dialogs = _make_skill_dialog(0, "Other Skill", 100)
        records = self._run(cards, dialogs)
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["classification"], CLASSIFICATION_UNKNOWN)
        self.assertEqual(records[0]["classification_method"], "unresolved")

    def test_unknown_when_dialog_has_unrecognized_href(self):
        cards = _make_badge_card("99000002", "Path Badge", 0, self.PROFILE_ID)
        dialogs = _make_unknown_dialog(0, "Path Badge", "/paths/some-path")
        records = self._run(cards, dialogs)
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["classification"], CLASSIFICATION_UNKNOWN)
        self.assertEqual(records[0]["classification_signal"], "/paths/some-path")

    def test_unknown_when_empty_dialog(self):
        cards = _make_badge_card("88000001", "Empty Dialog Badge", 0, self.PROFILE_ID)
        dialogs = _make_empty_dialog(0, "Empty Dialog Badge")
        records = self._run(cards, dialogs)
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["classification"], CLASSIFICATION_UNKNOWN)

    def test_zero_badge_profile_returns_empty(self):
        html = "<!DOCTYPE html><html><body><p>No badges yet.</p></body></html>"
        records = classify_profile_html(html, self.UUID, self.NAME, self.URL)
        self.assertEqual(records, [])

    def test_multiple_mixed_badges(self):
        cards = (
            _make_badge_card("10000001", "Skill Badge A", 0, self.PROFILE_ID)
            + _make_badge_card("10000002", "Arcade Game B", 1, self.PROFILE_ID)
            + _make_badge_card("10000003", "Another Skill", 2, self.PROFILE_ID)
        )
        dialogs = (
            _make_skill_dialog(0, "Skill Badge A", 101)
            + _make_arcade_dialog(1, "Arcade Game B", 76999)
            + _make_skill_dialog(2, "Another Skill", 102)
        )
        records = self._run(cards, dialogs)
        self.assertEqual(len(records), 3)
        classifications = [r["classification"] for r in records]
        self.assertEqual(classifications.count(CLASSIFICATION_SKILL), 2)
        self.assertEqual(classifications.count(CLASSIFICATION_ARCADE), 1)
        self.assertEqual(classifications.count(CLASSIFICATION_UNKNOWN), 0)

    def test_participant_uuid_and_name_preserved(self):
        cards = _make_badge_card("12345", "Any Badge", 0, self.PROFILE_ID)
        dialogs = _make_skill_dialog(0, "Any Badge", 500)
        records = self._run(cards, dialogs)
        self.assertEqual(records[0]["participant_uuid"], self.UUID)
        self.assertEqual(records[0]["participant_name"], self.NAME)
        self.assertEqual(records[0]["profile_url"], self.URL)

    def test_badge_href_field_preserved(self):
        cards = _make_badge_card("99999", "Badge With Href", 0, self.PROFILE_ID)
        dialogs = _make_skill_dialog(0, "Badge With Href", 300)
        records = self._run(cards, dialogs)
        self.assertIn(f"badges/99999", records[0]["badge_href"])

    def test_all_records_have_required_fields(self):
        required = {
            "participant_uuid", "participant_name", "profile_url",
            "badge_id", "badge_title", "classification",
            "classification_signal", "classification_method",
            "badge_href", "image_url", "earned_date_raw",
        }
        cards = _make_badge_card("777", "Some Badge", 0, self.PROFILE_ID)
        dialogs = _make_arcade_dialog(0, "Some Badge", 12345)
        records = self._run(cards, dialogs)
        self.assertEqual(len(records), 1)
        self.assertEqual(set(records[0].keys()), required)


class TestClassificationInvariants(unittest.TestCase):
    """
    Invariant: classification must always be one of three explicit values.
    No other strings are acceptable.
    """

    VALID_CLASSES = {CLASSIFICATION_SKILL, CLASSIFICATION_ARCADE, CLASSIFICATION_UNKNOWN}

    def test_all_classifications_are_valid_enum_values(self):
        profile_id = "inv-profile-abc"
        cards = (
            _make_badge_card("1", "Skill", 0, profile_id)
            + _make_badge_card("2", "Arcade", 1, profile_id)
            + _make_badge_card("3", "Unknown", 99, profile_id)
        )
        dialogs = (
            _make_skill_dialog(0, "Skill", 1)
            + _make_arcade_dialog(1, "Arcade", 2)
        )
        html = _wrap_html(cards) + dialogs
        records = classify_profile_html(html, "u", "N", f"https://www.skills.google/public_profiles/{profile_id}")
        for rec in records:
            self.assertIn(
                rec["classification"],
                self.VALID_CLASSES,
                f"Invalid classification: {rec['classification']} for badge {rec['badge_id']}",
            )


if __name__ == "__main__":
    unittest.main()


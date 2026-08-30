import json
import pathlib

import pytest

from wodify import parse

FIXTURES = pathlib.Path(__file__).parent / "fixtures"


@pytest.fixture
def payload():
    return json.loads((FIXTURES / "workout_response.json").read_text())


class TestSections:
    def test_section_markers_drive_structure(self, payload):
        r = parse.parse_workout(payload)
        titles = [s["title"] for s in r["sections"]]
        assert titles == ["WARM-UP", "Back Squat", "Business Time", "PRVN RESET"]

    def test_kinds_classified(self, payload):
        r = parse.parse_workout(payload)
        kinds = [s["kind"] for s in r["sections"]]
        assert kinds == ["warmup", "strength", "metcon", "cooldown"]

    def test_title_carried(self, payload):
        assert parse.parse_workout(payload)["title"] == "CrossFit - Mon, Aug 24"


class TestFieldTraps:
    def test_description_is_the_metcon_content(self, payload):
        r = parse.parse_workout(payload)
        metcon = next(s for s in r["sections"] if s["kind"] == "metcon")
        joined = "\n".join(metcon["lines"])
        assert "10 Toes to Bar" in joined
        assert "Max Thrusters" in joined, "只读 Name/Comment 会丢掉整个 workout"

    def test_measure_rep_scheme_kept_with_newlines(self, payload):
        r = parse.parse_workout(payload)
        strength = next(s for s in r["sections"] if s["kind"] == "strength")
        joined = "\n".join(strength["lines"])
        assert "Set 1: 6 Reps @ 70%" in joined
        assert "Set 2: 3 Reps @ 80%" in joined, "组次方案带真实换行，必须逐行拆开"

    def test_empty_record_placeholder_dropped(self, payload):
        r = parse.parse_workout(payload)
        blob = json.dumps(r, ensure_ascii=False)
        assert "OutSystems empty record" not in blob
        assert "PLACEHOLDER" not in blob

    def test_notes_excluded_by_default(self, payload):
        assert parse.parse_workout(payload)["notes"] == ""
        assert parse.parse_workout(payload, include_notes=True)["notes"] != ""


class TestClassTypeFromTitle:
    @pytest.mark.parametrize(
        "title,expected",
        [
            ("CrossFit - Mon, Aug 24", "CrossFit"),
            ("CrossFit Pump & Burn - Sat, Aug 22", "CrossFit Pump & Burn"),
            ("", ""),
            ("no dash or weekday here", ""),
        ],
    )
    def test_extracts_class_name(self, title, expected):
        assert parse.class_type_from_title(title) == expected


class TestToWodRow:
    def test_derives_class_type_and_keeps_raw(self, payload):
        parsed = parse.parse_workout(payload)
        row = parse.to_wod_row("2026-08-24", parsed, payload)
        assert row["day"] == "2026-08-24"
        assert row["class_type"] == "CrossFit"
        assert row["title"] == "CrossFit - Mon, Aug 24"
        assert row["sections"] == parsed["sections"]
        assert row["raw"] == payload
        assert row["source"] == "wodify_api"

    def test_falls_back_to_placeholder_title_when_empty(self):
        parsed = {"title": "", "sections": []}
        row = parse.to_wod_row("2026-08-24", parsed, {})
        assert row["title"] == "WOD 2026-08-24"
        assert row["class_type"] == ""


class TestEmptyBehaviour:
    def test_missing_workout_returns_empty_without_inventing_reason(self):
        r = parse.parse_workout({"data": {"Response": {}}})
        assert r["sections"] == []
        assert r["empty_reason"] is None, "空结果不得编造原因"

    def test_no_crash_on_garbage(self):
        for junk in (
            {},
            {"data": {}},
            {"data": {"Response": {"ResponseWOD": {}}}},
            {"data": None},  # Wodify 完全可能返回这种形状，data 键存在但值是 null
            {"data": {"Response": None}},
            {"data": {"Response": {"ResponseWOD": None}}},
        ):
            assert parse.parse_workout(junk)["sections"] == []

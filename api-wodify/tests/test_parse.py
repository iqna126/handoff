import json
import pathlib

import pytest

from wodify import parse

FIXTURES = pathlib.Path(__file__).parent / "fixtures"


@pytest.fixture
def payload():
    return json.loads((FIXTURES / "workout_response.json").read_text())


@pytest.fixture
def schedule_payload():
    return json.loads((FIXTURES / "schedule_response.json").read_text())


@pytest.fixture
def flagged_payload():
    return json.loads((FIXTURES / "workout_response_with_flags.json").read_text())


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


class TestComponentTypeFlags:
    """真机抓包证实每个组件自己带 IsWarmup/IsGymnastics/IsWeightlifting/
    IsMetcon 标记（Wodify 官方 App 显然是靠这些区分展示的）。之前只认
    IsSection，同一个 IsSection 标记下面混着的不同类型内容（比如
    "Warm-Up:" 段落里紧跟着一个 IsWeightlifting=true 的真实力量组件）会
    被囫囵折成一段——这是真机测试暴露、用真实数据核实过的问题。
    """

    def test_flagged_component_splits_into_its_own_section(self, flagged_payload):
        r = parse.parse_workout(flagged_payload)
        titles = [s["title"] for s in r["sections"]]
        assert titles == ["Warm-Up:", "Romanian Deadlift (RDL)", "Strength EMOM", "Cool-Down"], (
            "IsWeightlifting/IsMetcon 组件要各自另开段落，不能跟前面的 Warm-Up 混在一起"
        )

    def test_split_sections_get_the_right_kind(self, flagged_payload):
        r = parse.parse_workout(flagged_payload)
        kinds = {s["title"]: s["kind"] for s in r["sections"]}
        assert kinds["Warm-Up:"] == "warmup"
        assert kinds["Romanian Deadlift (RDL)"] == "strength"
        assert kinds["Strength EMOM"] == "metcon"
        assert kinds["Cool-Down"] == "cooldown"

    def test_warmup_section_does_not_swallow_the_real_strength_content(self, flagged_payload):
        r = parse.parse_workout(flagged_payload)
        warmup = next(s for s in r["sections"] if s["title"] == "Warm-Up:")
        blob = "\n".join(warmup["lines"])
        assert "Romanian Deadlift" not in blob, "力量内容被错误地折进了热身段落"

    def test_strength_section_keeps_its_own_content(self, flagged_payload):
        r = parse.parse_workout(flagged_payload)
        strength = next(s for s in r["sections"] if s["title"] == "Romanian Deadlift (RDL)")
        blob = "\n".join(strength["lines"])
        assert "4 Sets @ 55-60%" in blob
        assert "RPE 8" in blob


class TestScalingLevels:
    def test_levels_block_attaches_to_the_metcon_it_follows(self, payload):
        r = parse.parse_workout(payload)
        metcon = next(s for s in r["sections"] if s["title"] == "Business Time")
        names = [lv["name"] for lv in metcon["levels"]]
        assert names == ["RX", "Level 2", "Masters 55+"], (
            "RX 是补的，代表主 WOD 自己那份内容；后面两档是从 Levels 组件里拆出来的"
        )

    def test_rx_level_reuses_the_section_own_lines(self, payload):
        r = parse.parse_workout(payload)
        metcon = next(s for s in r["sections"] if s["title"] == "Business Time")
        rx = metcon["levels"][0]
        assert rx["lines"] == metcon["lines"], "RX 档就是主 WOD 自己的内容，不是另外编的"

    def test_other_levels_get_their_own_html_stripped_lines(self, payload):
        r = parse.parse_workout(payload)
        metcon = next(s for s in r["sections"] if s["title"] == "Business Time")
        level2 = next(lv for lv in metcon["levels"] if lv["name"] == "Level 2")
        assert level2["lines"] == ["7 rounds for reps", "Barbell: 75/55lb (34/25kg)"]
        masters = next(lv for lv in metcon["levels"] if lv["name"] == "Masters 55+")
        assert masters["lines"] == ["5 rounds for reps"]

    def test_levels_block_is_not_also_dumped_as_a_regular_line(self, payload):
        r = parse.parse_workout(payload)
        blob = json.dumps(r, ensure_ascii=False)
        assert "<p>" not in blob, "Levels 组件的原始 HTML 不该原样漏进任何一个 section 的 lines 里"

    def test_no_levels_block_leaves_levels_empty(self, payload):
        r = parse.parse_workout(payload)
        warmup = next(s for s in r["sections"] if s["kind"] == "warmup")
        assert warmup["levels"] == []


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

    def test_section_markers_own_comment_and_scheme_are_visible(self, payload):
        """段落标记（IsSection=true）自己的 Comment/MeasureRepScheme 常常就是
        整个段落的正文（WARM-UP/Cool-Down 这类段落经常只有这一个组件）。
        之前这部分只进了没人读的 meta 字段，lines 里完全看不到——真机测试时
        表现为"WARM-UP 段落显示成空的"，被误判成内容缺失。
        """
        r = parse.parse_workout(payload)
        back_squat = next(s for s in r["sections"] if s["title"] == "Back Squat")
        joined = "\n".join(back_squat["lines"])
        assert "6 Sets" in joined, "Back Squat 段落标记自己的 MeasureRepScheme 丢了"
        assert "% of 1RM Back Squat" in joined, "Back Squat 段落标记自己的 Comment 丢了"

        business_time = next(s for s in r["sections"] if s["title"] == "Business Time")
        joined = "\n".join(business_time["lines"])
        assert "6 rounds for reps" in joined
        assert "Score = Sum Total Reps" in joined

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
        assert row["class_times"] == [], "没传 class_times 时默认空列表，不是 None"

    def test_keeps_class_times_when_given(self, payload):
        parsed = parse.parse_workout(payload)
        row = parse.to_wod_row(
            "2026-08-24",
            parsed,
            payload,
            class_times=["2026-08-24T06:00:00", "2026-08-24T09:00:00"],
        )
        assert row["class_times"] == ["2026-08-24T06:00:00", "2026-08-24T09:00:00"]

    def test_falls_back_to_placeholder_title_when_empty(self):
        parsed = {"title": "", "sections": []}
        row = parse.to_wod_row("2026-08-24", parsed, {})
        assert row["title"] == "WOD 2026-08-24"
        assert row["class_type"] == ""


class TestParseSchedule:
    def test_returns_every_class_not_deduped(self, schedule_payload):
        classes = parse.parse_schedule(schedule_payload)
        assert [c["program_id"] for c in classes] == ["101", "101", "202"], (
            "同一个 program 当天开了两个时段，都要保留——约课要知道具体是哪个时段，"
            "去重会把时段信息丢掉（去重是 distinct_programs() 的事，不是这个函数的事）"
        )

    def test_placeholder_record_dropped(self, schedule_payload):
        classes = parse.parse_schedule(schedule_payload)
        assert all(c["id"] != "0" for c in classes)

    def test_keeps_id_name_start_time(self, schedule_payload):
        classes = parse.parse_schedule(schedule_payload)
        first = classes[0]
        assert first["id"] == "9001"
        assert first["name"] == "CrossFit"
        assert first["start_time"] == "2026-08-24T06:00:00"

    def test_no_crash_on_garbage(self):
        for junk in (
            {},
            {"data": {}},
            {"data": {"Response": {}}},
            {"data": None},
            {"data": {"Response": None}},
            {"data": {"Response": {"ResponseClassList": None}}},
            {"data": {"Response": {"ResponseClassList": {"Class": None}}}},
            {"data": {"Response": {"ResponseClassList": {"Class": {"List": None}}}}},
        ):
            assert parse.parse_schedule(junk) == []

    def test_tries_alternate_container_names(self):
        for key in ("Class", "ClassList", "ScheduleList"):
            payload = {
                "data": {
                    "Response": {
                        "ResponseClassList": {key: {"List": [{"Id": "1", "ProgramId": "5"}]}}
                    }
                }
            }
            assert parse.parse_schedule(payload) == [
                {"id": "1", "name": None, "start_time": None, "program_id": "5"}
            ]


class TestDistinctPrograms:
    def test_dedupes_keeping_first_occurrence(self, schedule_payload):
        classes = parse.parse_schedule(schedule_payload)
        programs = parse.distinct_programs(classes)
        assert [p["program_id"] for p in programs] == ["101", "202"], (
            "查 workout 只需要每个 program 各查一次，不是每节课查一次"
        )
        assert programs[0]["start_time"] == "2026-08-24T06:00:00", "保留第一次出现的那条"

    def test_empty_input(self):
        assert parse.distinct_programs([]) == []


class TestClassTimesForProgram:
    def test_collects_every_time_slot_for_that_program(self, schedule_payload):
        classes = parse.parse_schedule(schedule_payload)
        times = parse.class_times_for_program(classes, "101")
        assert times == ["2026-08-24T06:00:00", "2026-08-24T09:00:00"], (
            "同一个 program 当天开了两场，约课要能选具体哪一场"
        )

    def test_program_with_one_slot(self, schedule_payload):
        classes = parse.parse_schedule(schedule_payload)
        assert parse.class_times_for_program(classes, "202") == ["2026-08-24T18:00:00"]

    def test_unknown_program_returns_empty(self, schedule_payload):
        classes = parse.parse_schedule(schedule_payload)
        assert parse.class_times_for_program(classes, "does-not-exist") == []


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

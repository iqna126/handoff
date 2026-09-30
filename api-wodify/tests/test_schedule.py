import pytest

from wodify import parse, schedule


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
        assert schedule.class_type_from_title(title) == expected


class TestToWodRow:
    def test_derives_class_type_and_keeps_raw(self, payload):
        parsed = parse.parse_workout(payload)
        row = schedule.to_wod_row("2026-08-24", parsed, payload)
        assert row["day"] == "2026-08-24"
        assert row["class_type"] == "CrossFit"
        assert row["title"] == "CrossFit - Mon, Aug 24"
        assert row["sections"] == parsed["sections"]
        assert row["raw"] == payload
        assert row["source"] == "wodify_api"
        assert row["class_times"] == [], "没传 class_times 时默认空列表，不是 None"

    def test_keeps_class_times_when_given(self, payload):
        parsed = parse.parse_workout(payload)
        row = schedule.to_wod_row(
            "2026-08-24",
            parsed,
            payload,
            class_times=["2026-08-24T06:00:00", "2026-08-24T09:00:00"],
        )
        assert row["class_times"] == ["2026-08-24T06:00:00", "2026-08-24T09:00:00"]

    def test_falls_back_to_placeholder_title_when_empty(self):
        parsed = {"title": "", "sections": []}
        row = schedule.to_wod_row("2026-08-24", parsed, {})
        assert row["title"] == "WOD 2026-08-24"
        assert row["class_type"] == ""


class TestParseSchedule:
    def test_returns_every_class_not_deduped(self, schedule_payload):
        classes = schedule.parse_schedule(schedule_payload)
        assert [c["program_id"] for c in classes] == ["101", "101", "202"], (
            "同一个 program 当天开了两个时段，都要保留——约课要知道具体是哪个时段，"
            "去重会把时段信息丢掉（去重是 distinct_programs() 的事，不是这个函数的事）"
        )

    def test_placeholder_record_dropped(self, schedule_payload):
        classes = schedule.parse_schedule(schedule_payload)
        assert all(c["id"] != "0" for c in classes)

    def test_keeps_id_name_start_time(self, schedule_payload):
        classes = schedule.parse_schedule(schedule_payload)
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
            assert schedule.parse_schedule(junk) == []

    def test_tries_alternate_container_names(self):
        for key in ("Class", "ClassList", "ScheduleList"):
            payload = {
                "data": {
                    "Response": {
                        "ResponseClassList": {key: {"List": [{"Id": "1", "ProgramId": "5"}]}}
                    }
                }
            }
            assert schedule.parse_schedule(payload) == [
                {"id": "1", "name": None, "start_time": None, "program_id": "5"}
            ]


class TestDistinctPrograms:
    def test_dedupes_keeping_first_occurrence(self, schedule_payload):
        classes = schedule.parse_schedule(schedule_payload)
        programs = schedule.distinct_programs(classes)
        assert [p["program_id"] for p in programs] == ["101", "202"], (
            "查 workout 只需要每个 program 各查一次，不是每节课查一次"
        )
        assert programs[0]["start_time"] == "2026-08-24T06:00:00", "保留第一次出现的那条"

    def test_empty_input(self):
        assert schedule.distinct_programs([]) == []


class TestClassTimesForProgram:
    def test_collects_every_time_slot_for_that_program(self, schedule_payload):
        classes = schedule.parse_schedule(schedule_payload)
        times = schedule.class_times_for_program(classes, "101")
        assert times == ["2026-08-24T06:00:00", "2026-08-24T09:00:00"], (
            "同一个 program 当天开了两场，约课要能选具体哪一场"
        )

    def test_program_with_one_slot(self, schedule_payload):
        classes = schedule.parse_schedule(schedule_payload)
        assert schedule.class_times_for_program(classes, "202") == ["2026-08-24T18:00:00"]

    def test_unknown_program_returns_empty(self, schedule_payload):
        classes = schedule.parse_schedule(schedule_payload)
        assert schedule.class_times_for_program(classes, "does-not-exist") == []

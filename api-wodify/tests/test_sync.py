"""测试 sync.py。跟 test_client.py 一样，用注入的 transport 模拟网络，
不碰真实的 Wodify 或 Worker。
"""

import json
from datetime import date

import pytest

from wodify import sync
from wodify.client import Client, SessionExpired

WORKOUT_WITH_CONTENT = {
    "versionInfo": {},
    "data": {
        "Response": {
            "ResponseWOD": {
                "ResponseWorkout": {
                    "Name": "CrossFit - Mon, Aug 24",
                    "WorkoutComponents": {
                        "List": [
                            {
                                "Id": "1",
                                "IsSection": True,
                                "Name": "Back Squat",
                                "MeasureRepScheme": "6 Sets",
                            }
                        ]
                    },
                }
            }
        }
    },
}

WORKOUT_EMPTY = {"versionInfo": {}, "data": {"Response": {}}}

ONE_PROGRAM_SCHEDULE = {
    "versionInfo": {},
    "data": {
        "Response": {
            "ResponseClassList": {
                "Class": {"List": [{"Id": "1", "Name": "CrossFit", "ProgramId": "101"}]}
            }
        }
    },
}
NO_CLASSES_SCHEDULE = {
    "versionInfo": {},
    "data": {"Response": {"ResponseClassList": {"Class": {"List": []}}}},
}
SCHEDULE_TWO_PROGRAMS = {
    "versionInfo": {},
    "data": {
        "Response": {
            "ResponseClassList": {
                "Class": {
                    "List": [
                        {"Id": "1", "Name": "CrossFit", "ProgramId": "101"},
                        {"Id": "2", "Name": "CrossFit Pump & Burn", "ProgramId": "202"},
                    ]
                }
            }
        }
    },
}

WORKOUT_PRIMED_BODY = {
    "screenData": {
        "variables": {
            "RequestCache": {"SelectedDate": "2026-01-01", "GymProgramId": "0"},
            "In_Request": {"SelectedDate": "2026-01-01", "GymProgramId": "0"},
        }
    }
}
SCHEDULE_PRIMED_BODY = {"screenData": {"variables": {"RequestCache": {"FromDate": "2026-01-01"}}}}
SESSION = {
    "csrf": "x" * 28,
    "cookie": "nr1W_Theme_UI=aaa",
    "actions": {
        "workout": {"body": WORKOUT_PRIMED_BODY},
        "schedule": {"body": SCHEDULE_PRIMED_BODY},
    },
}


def _selected_date(body: bytes) -> str:
    return json.loads(body)["screenData"]["variables"]["RequestCache"]["SelectedDate"]


def _is_schedule_query(url: str) -> bool:
    return "Schedule_OS" in url


def _program_id(body: bytes) -> str:
    return json.loads(body)["screenData"]["variables"]["RequestCache"]["GymProgramId"]


class TestWeekDates:
    def test_seven_consecutive_days(self):
        assert sync.week_dates(date(2026, 8, 24)) == [
            "2026-08-24",
            "2026-08-25",
            "2026-08-26",
            "2026-08-27",
            "2026-08-28",
            "2026-08-29",
            "2026-08-30",
        ]


class TestPullDay:
    def test_queries_schedule_before_workout(self):
        calls = []

        def transport(url, headers, body):
            calls.append("schedule" if _is_schedule_query(url) else "workout")
            if _is_schedule_query(url):
                return 200, json.dumps(ONE_PROGRAM_SCHEDULE).encode()
            return 200, json.dumps(WORKOUT_WITH_CONTENT).encode()

        c = Client("gym.wodify.com", SESSION, transport=transport)
        sync.pull_day(c, "2026-08-24")

        assert calls == ["schedule", "workout"], "必须先查 schedule 拿到 program 列表，再查 workout"

    def test_queries_workout_once_per_distinct_program(self):
        program_ids_queried = []

        def transport(url, headers, body):
            if _is_schedule_query(url):
                return 200, json.dumps(SCHEDULE_TWO_PROGRAMS).encode()
            program_ids_queried.append(_program_id(body))
            payload = dict(WORKOUT_WITH_CONTENT)
            return 200, json.dumps(payload).encode()

        c = Client("gym.wodify.com", SESSION, transport=transport)
        rows = sync.pull_day(c, "2026-08-24")

        assert program_ids_queried == ["101", "202"], (
            "两个不同 program 各查一次 workout，不能只查其中一个——这正是"
            "缺 GymProgramId 时只拿到一个 program 内容的根因"
        )
        assert len(rows) == 2

    def test_no_classes_that_day_returns_empty_without_querying_workout(self):
        workout_queried = []

        def transport(url, headers, body):
            if _is_schedule_query(url):
                return 200, json.dumps(NO_CLASSES_SCHEDULE).encode()
            workout_queried.append(url)
            return 200, json.dumps(WORKOUT_WITH_CONTENT).encode()

        c = Client("gym.wodify.com", SESSION, transport=transport)
        rows = sync.pull_day(c, "2026-08-24")

        assert rows == []
        assert workout_queried == []

    def test_program_with_empty_workout_is_skipped(self):
        def transport(url, headers, body):
            if _is_schedule_query(url):
                return 200, json.dumps(ONE_PROGRAM_SCHEDULE).encode()
            return 200, json.dumps(WORKOUT_EMPTY).encode()

        c = Client("gym.wodify.com", SESSION, transport=transport)
        rows = sync.pull_day(c, "2026-08-24")

        assert rows == []


class TestPullWeek:
    def test_skips_days_without_content_but_keeps_the_rest(self):
        queried_days = []

        def transport(url, headers, body):
            if _is_schedule_query(url):
                return 200, json.dumps(ONE_PROGRAM_SCHEDULE).encode()
            d = _selected_date(body)
            queried_days.append(d)
            payload = WORKOUT_WITH_CONTENT if d in ("2026-08-24", "2026-08-30") else WORKOUT_EMPTY
            return 200, json.dumps(payload).encode()

        c = Client("gym.wodify.com", SESSION, transport=transport)
        rows = sync.pull_week(c, date(2026, 8, 24))

        assert len(queried_days) == 7, "非上课日也要照常查询，不能提前跳过"
        assert [r["day"] for r in rows] == ["2026-08-24", "2026-08-30"]
        assert rows[0]["class_type"] == "CrossFit"

    def test_session_expired_propagates_without_swallowing(self):
        def transport(url, headers, body):
            return 401, b"{}"

        c = Client("gym.wodify.com", SESSION, transport=transport)
        with pytest.raises(SessionExpired):
            sync.pull_week(c, date(2026, 8, 24))


class TestPushToWorker:
    def test_posts_batch_with_auth_header(self):
        captured = {}

        def transport(url, headers, body):
            captured["url"] = url
            captured["headers"] = headers
            captured["body"] = json.loads(body)
            return 200, json.dumps({"written": 3}).encode()

        wods = [{"day": "2026-08-24", "class_type": "CrossFit", "sections": [], "raw": {}}]
        written = sync.push_to_worker(
            "https://handoff.example/api/wod/ingest", "tok123", wods, transport=transport
        )

        assert written == 3
        assert captured["url"] == "https://handoff.example/api/wod/ingest"
        assert captured["headers"]["Authorization"] == "Bearer tok123"
        assert captured["body"] == {"wods": wods}

    def test_sends_a_real_user_agent(self):
        """urllib 默认的 User-Agent 是已知爬虫特征，真机测试时被 Cloudflare 的
        边缘防护拦下来（403 error code 1010，请求根本没到 Worker），必须换成
        一个诚实标出自己身份的 UA。
        """
        captured = {}

        def transport(url, headers, body):
            captured["headers"] = headers
            return 200, json.dumps({"written": 0}).encode()

        sync.push_to_worker(
            "https://handoff.example/api/wod/ingest", "tok", [], transport=transport
        )

        ua = captured["headers"]["User-Agent"]
        assert ua and "python-urllib" not in ua.lower()

    def test_error_status_raises(self):
        def transport(url, headers, body):
            return 500, b"boom"

        with pytest.raises(RuntimeError, match="500"):
            sync.push_to_worker(
                "https://handoff.example/api/wod/ingest", "tok", [], transport=transport
            )


class TestReportError:
    def test_posts_error_payload(self):
        captured = {}

        def transport(url, headers, body):
            captured["body"] = json.loads(body)
            return 200, json.dumps({"written": 0}).encode()

        sync.report_error(
            "https://handoff.example/api/wod/ingest",
            "tok",
            "SessionExpired",
            "需要重新登录",
            transport=transport,
        )

        assert captured["body"] == {"error": {"kind": "SessionExpired", "detail": "需要重新登录"}}

    def test_transport_failure_does_not_raise(self):
        def transport(url, headers, body):
            raise OSError("network is down")

        sync.report_error(
            "https://handoff.example/api/wod/ingest", "tok", "X", "y", transport=transport
        )  # 不抛异常就算过——上报失败不该盖过原始错误


class TestRunWeeklySync:
    def test_happy_path_pushes_once(self):
        push_calls = []

        def transport(url, headers, body):
            if _is_schedule_query(url):
                return 200, json.dumps(ONE_PROGRAM_SCHEDULE).encode()
            if "SelectedDate" in body.decode():
                return 200, json.dumps(WORKOUT_WITH_CONTENT).encode()
            push_calls.append(json.loads(body))
            return 200, json.dumps({"written": 7}).encode()

        c = Client("gym.wodify.com", SESSION, transport=transport)
        written = sync.run_weekly_sync(
            c,
            date(2026, 8, 24),
            "https://handoff.example/api/wod/ingest",
            "tok",
            transport=transport,
        )

        assert written == 7
        assert len(push_calls) == 1, "一周只推一次，不是查完一天推一天"

    def test_session_expired_reports_then_reraises(self):
        reported = []

        def transport(url, headers, body):
            if _is_schedule_query(url):
                return 401, b"{}"
            reported.append(json.loads(body))
            return 200, json.dumps({"written": 0}).encode()

        c = Client("gym.wodify.com", SESSION, transport=transport)
        with pytest.raises(SessionExpired):
            sync.run_weekly_sync(
                c,
                date(2026, 8, 24),
                "https://handoff.example/api/wod/ingest",
                "tok",
                transport=transport,
            )

        assert len(reported) == 1
        assert reported[0]["error"]["kind"] == "SessionExpired"

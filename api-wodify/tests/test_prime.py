"""prime 的纯函数部分可以离线测。
网络与 CDP 部分测不了 —— 那部分首次运行必须人工核对。
"""

import os
import stat

import pytest

from wodify import prime

COOKIE = "nr1W_Theme_UI=" + "a" * 184 + "; AuthenticationToken=bbb"
CSRF = "c" * 28
PREFIX = "https://gym.wodify.com/WodifyClient/screenservices/"

SCHEDULE = (
    "WodifyClient_DataFetch_WB/Schedule_OS/"
    "GetClassList_ForClient_WithReservationCounts_WB/"
    "DataActionGetClassList_ForClient_WithReservationCounts"
)
WORKOUT = "WodifyClient_DataFetch_WB/WOD_Flow/GetAllWorkoutData_WB/DataActionGetAllWorkoutData"


def obs(path, body=None):
    return {
        "url": PREFIX + path,
        "headers": {"Cookie": COOKIE, "X-CSRFToken": CSRF},
        "body": body or {"versionInfo": {}},
    }


class TestObserve:
    def test_captures_allowlisted_actions(self):
        s = prime.observe_to_session([obs(SCHEDULE), obs(WORKOUT)], host="gym.wodify.com")
        assert set(s["captured"]) == {"schedule", "workout"}
        assert s["cookie"] == COOKIE
        assert len(s["csrf"]) == 28

    def test_reports_missing_actions(self):
        s = prime.observe_to_session([obs(SCHEDULE)], host="gym.wodify.com")
        assert "workout" in s["missing"], "没抓到的动作必须报出来，不能静默"

    def test_unmatched_paths_are_kept_for_diagnosis(self):
        # 模拟 2026-08 那次改版：路径加了前缀，旧的匹配规则失效
        old_path = (
            "Schedule_OS/GetClassList_ForClient_WithReservationCounts_WB/"
            "DataActionGetClassList_ForClient_WithReservationCounts"
        )
        s = prime.observe_to_session([obs(old_path)], host="gym.wodify.com")
        assert s["captured"] == []
        assert old_path in s["unmatched_paths"], "改版诊断全靠这个列表，匹配不上的路径必须留着"

    def test_non_screenservice_requests_ignored(self):
        junk = {"url": "https://gym.wodify.com/assets/app.js", "headers": {}, "body": None}
        s = prime.observe_to_session([junk, obs(WORKOUT)], host="gym.wodify.com")
        assert s["captured"] == ["workout"]

    def test_cookie_not_taken_from_unmatched_request(self):
        # 命中 /screenservices/ 但不在白名单里的请求（换版后没登记过的 action，
        # 或者以后 Wodify 加的新端点），它的 cookie/csrf 不能污染抓到的会话——
        # 放在 matched 请求之前，模拟"污染源先被观察到"的真实顺序
        unmatched = {
            "url": PREFIX + "SomeOther_WB/SomeAction",
            "headers": {"Cookie": "tracking_id=zzz", "X-CSRFToken": "unrelated"},
            "body": None,
        }
        s = prime.observe_to_session([unmatched, obs(WORKOUT)], host="gym.wodify.com")
        assert s["cookie"] == COOKIE, "未匹配请求的 cookie 不能混进抓到的会话里"
        assert s["csrf"] == CSRF
        assert "SomeOther_WB/SomeAction" in s["unmatched_paths"]


class TestReport:
    def test_missing_is_visible(self):
        s = prime.observe_to_session([obs(SCHEDULE)], host="gym.wodify.com")
        text = prime.report(s)
        assert "MISSING" in text
        assert "workout" in text

    def test_unmatched_listed(self):
        s = prime.observe_to_session([obs("Some/New/Path")], host="gym.wodify.com")
        assert "Some/New/Path" in prime.report(s)

    def test_credentials_not_printed(self):
        s = prime.observe_to_session([obs(WORKOUT)], host="gym.wodify.com")
        text = prime.report(s)
        assert COOKIE not in text and CSRF not in text, (
            "缓存里是活的凭证，任何打印出来的地方都是 bug"
        )


class TestDateLabel:
    def test_formats_month_and_day(self):
        assert prime.date_label("2026-08-31") == "August 31"

    def test_no_leading_zero_on_day(self):
        assert prime.date_label("2026-09-05") == "September 5"


class TestSessionCache:
    def test_round_trips(self, tmp_path):
        s = prime.observe_to_session([obs(WORKOUT)], host="gym.wodify.com")
        path = str(tmp_path / "session.json")
        prime.save_session(s, path)
        assert prime.load_session(path) == s

    def test_saved_file_is_not_world_readable(self, tmp_path):
        path = str(tmp_path / "session.json")
        prime.save_session({"cookie": "secret"}, path)
        mode = stat.S_IMODE(os.stat(path).st_mode)
        assert mode == 0o600, "缓存里是活的凭证，权限不能比 600 宽"

    def test_missing_file_raises(self, tmp_path):
        with pytest.raises(FileNotFoundError):
            prime.load_session(str(tmp_path / "nope.json"))

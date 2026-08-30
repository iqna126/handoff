"""测试 cli.py。核心逻辑（print_workout/run_week/cmd_doctor）都跟"client 从哪来"
解耦，直接传注入了 transport 的 Client，不碰真实网络或真实配置文件。
"""

import json
from datetime import date

from wodify import cli, prime
from wodify.client import Client

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

PRIMED_BODY = {"screenData": {"variables": {"RequestCache": {"SelectedDate": "2026-01-01"}}}}
SESSION = {
    "csrf": "x" * 28,
    "cookie": "nr1W_Theme_UI=aaa",
    "actions": {"workout": {"body": PRIMED_BODY}},
}


class TestCmdPrime:
    def test_reports_not_implemented_honestly_and_fails(self, capsys):
        code = cli.cmd_prime(argparse_namespace())
        assert code == 1, "真机抓包没实现，不能假装成功返回 0"
        assert "还没实现" in capsys.readouterr().err


class TestPrintWorkout:
    def test_prints_sections_on_success(self, capsys):
        def transport(url, headers, body):
            return 200, json.dumps(WORKOUT_WITH_CONTENT).encode()

        c = Client("gym.wodify.com", SESSION, transport=transport)
        code = cli.print_workout(c, "2026-08-24")

        out = capsys.readouterr().out
        assert code == 0
        assert "CrossFit - 2026-08-24" in out
        assert "Back Squat" in out

    def test_no_content_reports_fact_not_a_guessed_reason(self, capsys):
        def transport(url, headers, body):
            return 200, json.dumps(WORKOUT_EMPTY).encode()

        c = Client("gym.wodify.com", SESSION, transport=transport)
        code = cli.print_workout(c, "2026-08-24")

        out = capsys.readouterr().out
        assert code == 0
        assert "没有查到内容" in out
        assert "隐藏" not in out and "过滤" not in out, "不得编造原因"

    def test_session_expired_returns_nonzero(self, capsys):
        def transport(url, headers, body):
            return 401, b"{}"

        c = Client("gym.wodify.com", SESSION, transport=transport)
        code = cli.print_workout(c, "2026-08-24")
        assert code == 1
        assert "人工登录" in capsys.readouterr().err

    def test_injected_transport_is_actually_used(self):
        """确认注入的假 transport 真的被调用了，而不是悄悄退回真实网络实现。"""
        called = []

        def transport(url, headers, body):
            called.append(url)
            return 200, json.dumps(WORKOUT_EMPTY).encode()

        c = Client("gym.wodify.com", SESSION, transport=transport)
        cli.print_workout(c, "2026-08-24")

        assert called, "注入的 transport 没被调用，说明走了别的网络实现"


class TestRunWeek:
    def test_reports_written_count(self, capsys):
        def transport(url, headers, body):
            if "SelectedDate" in body.decode():
                return 200, json.dumps(WORKOUT_EMPTY).encode()
            return 200, json.dumps({"written": 0}).encode()

        c = Client("gym.wodify.com", SESSION, transport=transport)
        code = cli.run_week(
            c, date(2026, 8, 24), "https://x.example/ingest", "tok", transport=transport
        )

        assert code == 0
        assert "写入 0 条" in capsys.readouterr().out

    def test_session_expired_returns_nonzero_without_touching_real_network(self, capsys):
        def transport(url, headers, body):
            if "SelectedDate" in body.decode():
                return 401, b"{}"
            return 200, json.dumps({"written": 0}).encode()  # 错误上报那一步

        c = Client("gym.wodify.com", SESSION, transport=transport)
        code = cli.run_week(
            c, date(2026, 8, 24), "https://x.example/ingest", "tok", transport=transport
        )
        assert code == 1


class TestCmdDoctor:
    def test_missing_session_reports_and_fails(self, tmp_path, monkeypatch):
        monkeypatch.setattr(cli.config, "SESSION_CACHE_PATH", str(tmp_path / "nope.json"))
        code = cli.cmd_doctor(argparse_namespace())
        assert code == 1

    def test_complete_session_succeeds(self, tmp_path, monkeypatch, capsys):
        path = str(tmp_path / "session.json")
        session = {
            "host": "gym.wodify.com",
            "cookie": "c",
            "csrf": "x",
            "captured": ["schedule", "workout", "bookings"],
            "missing": [],
            "unmatched_paths": [],
        }
        prime.save_session(session, path)
        monkeypatch.setattr(cli.config, "SESSION_CACHE_PATH", path)

        code = cli.cmd_doctor(argparse_namespace())

        assert code == 0
        assert "captured" in capsys.readouterr().out

    def test_missing_actions_fails_even_if_file_exists(self, tmp_path, monkeypatch):
        path = str(tmp_path / "session.json")
        prime.save_session({"captured": ["schedule"], "missing": ["workout"]}, path)
        monkeypatch.setattr(cli.config, "SESSION_CACHE_PATH", path)

        assert cli.cmd_doctor(argparse_namespace()) == 1


class TestArgParsing:
    def test_workout_requires_date(self):
        parser = cli.build_parser()
        args = parser.parse_args(["workout", "--date", "2026-08-24"])
        assert args.command == "workout"
        assert args.date == "2026-08-24"

    def test_week_start_is_optional(self):
        parser = cli.build_parser()
        args = parser.parse_args(["week"])
        assert args.start is None

    def test_main_dispatches_prime(self, capsys):
        assert cli.main(["prime"]) == 1


def argparse_namespace(**kwargs):
    import argparse

    return argparse.Namespace(**kwargs)

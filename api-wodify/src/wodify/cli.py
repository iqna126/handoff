"""命令行入口：prime / workout / week / doctor。见 DESIGN.md §6.9 模块划分。

查询相关命令只用标准库。prime 的真机抓包部分还没实现（见 prime.py 顶部说明），
这里的 prime 子命令如实报告这一点，不假装能用——可见的失败优于不可见的错误。

`print_workout`/`run_week`/`cmd_doctor` 都不依赖"client 具体怎么来"，可以直接传
一个用注入 transport 建出来的 Client 测试，不用真的读配置文件、连真实网络。
"""

from __future__ import annotations

import argparse
import sys
from datetime import date

from . import config, parse, prime, sync
from .client import Client, NotPrimed, SessionExpired, VersionStale


def _load_client() -> Client:
    """从本地缓存的 session 建一个真实的 Client。没缓存就直接退出，提示先 prime。"""
    try:
        session = prime.load_session(config.SESSION_CACHE_PATH)
    except FileNotFoundError:
        print(f"没有缓存的会话（{config.SESSION_CACHE_PATH}），先跑 prime。", file=sys.stderr)
        sys.exit(1)
    return Client(config.WODIFY_HOST, session)


def print_workout(c: Client, day: str) -> int:
    """查一天的 WOD 并打印。返回值是进程退出码。"""
    try:
        payload = c.query("workout", date=day)
    except (SessionExpired, VersionStale, NotPrimed) as e:
        print(str(e), file=sys.stderr)
        return 1
    parsed = parse.parse_workout(payload)
    if not parsed["sections"]:
        print(f"{day} 没有查到内容（可能没有排课，也可能是查询失败——不猜原因）。")
        return 0
    row = parse.to_wod_row(day, parsed, payload)
    print(f"{row['class_type']} - {day}：{len(row['sections'])} 个段落")
    for s in row["sections"]:
        print(f"  [{s['kind']}] {s['title']}")
    return 0


def run_week(c: Client, start: date, ingest_url: str, sync_token: str, *, transport=None) -> int:
    """拉一周并推给 Worker，打印结果。返回值是进程退出码。

    transport 透传给 sync.run_weekly_sync——不透传的话，测试注入到 c 上的假
    transport 只会覆盖查 Wodify 那一步，推给 Worker 那一步会用真的
    urllib.request 打真实网络，跟 c 用了假 transport 这件事本身矛盾。
    """
    try:
        written = sync.run_weekly_sync(c, start, ingest_url, sync_token, transport=transport)
    except (SessionExpired, VersionStale, NotPrimed) as e:
        print(str(e), file=sys.stderr)
        return 1
    print(f"写入 {written} 条")
    return 0


def cmd_prime(args: argparse.Namespace) -> int:
    print(
        "prime 的真机抓包部分还没实现——需要先写 cdp.py 驱动 CDP，"
        "见 prime.py 顶部说明和 DESIGN.md §6.9。",
        file=sys.stderr,
    )
    return 1


def cmd_workout(args: argparse.Namespace) -> int:
    return print_workout(_load_client(), args.date)


def cmd_week(args: argparse.Namespace) -> int:
    if not config.INGEST_URL or not config.WODIFY_SYNC_TOKEN:
        print("WODIFY_INGEST_URL / WODIFY_SYNC_TOKEN 没配置，见 config.py。", file=sys.stderr)
        return 1
    start = date.fromisoformat(args.start) if args.start else date.today()
    return run_week(_load_client(), start, config.INGEST_URL, config.WODIFY_SYNC_TOKEN)


def cmd_doctor(args: argparse.Namespace) -> int:
    """检查缓存的会话状态：captured/missing/unmatched 一眼看清楚。"""
    try:
        session = prime.load_session(config.SESSION_CACHE_PATH)
    except FileNotFoundError:
        print(f"没有缓存的会话（{config.SESSION_CACHE_PATH}），先跑 prime。")
        return 1
    print(prime.report(session))
    return 1 if session.get("missing") else 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="wodify")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("prime", help="抓取会话凭证（真机抓包部分还没实现）")

    p_workout = sub.add_parser("workout", help="查一天的 WOD")
    p_workout.add_argument("--date", required=True, help="YYYY-MM-DD")

    p_week = sub.add_parser("week", help="拉一整周并推给 Worker")
    p_week.add_argument("--start", help="YYYY-MM-DD，默认今天")

    sub.add_parser("doctor", help="检查缓存的会话状态")
    return parser


_HANDLERS = {
    "prime": cmd_prime,
    "workout": cmd_workout,
    "week": cmd_week,
    "doctor": cmd_doctor,
}


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return _HANDLERS[args.command](args)


if __name__ == "__main__":
    sys.exit(main())

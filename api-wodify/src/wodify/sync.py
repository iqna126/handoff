"""拉一整周的 WOD，批量 POST 给 Worker 的 /api/wod/ingest。

不直连 Supabase——机器上只持有 WODIFY_SYNC_TOKEN 一个密钥，写库这一步交给
Worker（用它自己的 service_role key），见 DESIGN.md §6.6 密钥架构。

查询路径（这个模块 + client.py）只用标准库，热路径不需要任何安装，
跟 client.py 顶部说明的原则一致。transport 可注入，跟 client.Client 同一个
思路，方便在没有网络的环境下测试。
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from datetime import date, timedelta
from typing import Any, Callable

from . import parse
from .client import Client, SessionExpired, VersionStale

Transport = Callable[[str, dict, bytes], tuple[int, bytes]]


def week_dates(start: date) -> list[str]:
    """从 start 开始的 7 天，YYYY-MM-DD 字符串列表。"""
    return [(start + timedelta(days=i)).isoformat() for i in range(7)]


def pull_day(c: Client, day: str) -> list[dict]:
    """拉一天的 WOD，转成 wods 行——可能是 0～N 行。

    同一天可能同时排着多个 program（比如 CrossFit 和 Pump & Burn），各自的
    workout 内容完全独立，查 workout 不带 GymProgramId 只会拿到「默认」那个
    program 的内容（prime 时凑巧点进去的那个）。所以先查 schedule 拿到当天
    出现过的 program 列表，再对每个 program 各查一次 workout——见
    DESIGN.md §6.6 根因说明。

    某天没有排课是正常情况，不算失败，直接返回空列表——不是每天都上课。
    查询本身失败（SessionExpired/VersionStale）要往上抛，不在这里吞掉。
    """
    schedule_payload = c.query("schedule", date=day)
    programs = parse.parse_schedule(schedule_payload)

    rows = []
    for program in programs:
        payload = c.query("workout", date=day, program_id=program["program_id"])
        parsed = parse.parse_workout(payload)
        if not parsed["sections"]:
            continue
        rows.append(parse.to_wod_row(day, parsed, payload))
    return rows


def pull_week(c: Client, start: date) -> list[dict]:
    """拉一整周的 WOD，转成 wods 行（一天可能产出 0～N 行，见 pull_day）。"""
    rows = []
    for day in week_dates(start):
        rows.extend(pull_day(c, day))
    return rows


def _default_transport(url: str, headers: dict, body: bytes) -> tuple[int, bytes]:
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def _post_json(
    url: str, token: str, body: dict[str, Any], *, transport: Transport | None = None
) -> dict:
    transport = transport or _default_transport
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {token}"}
    status, raw = transport(url, headers, json.dumps(body).encode("utf-8"))
    if status >= 400:
        raise RuntimeError(f"ingest 失败：HTTP {status} {raw[:200]!r}")
    return json.loads(raw)


def push_to_worker(
    ingest_url: str, sync_token: str, wods: list[dict], *, transport: Transport | None = None
) -> int:
    """批量 POST 一整周的数据，返回 Worker 实际写入的条数。

    是"一次传一整周"，不是拉一天推一天——见 DESIGN.md §6.6「批量写入」。
    空列表也允许调用（等于告诉 Worker 这周查完了但没有新内容），调用方自己
    决定要不要跳过。
    """
    resp = _post_json(ingest_url, sync_token, {"wods": wods}, transport=transport)
    return resp["written"]


def report_error(
    ingest_url: str,
    sync_token: str,
    kind: str,
    detail: str,
    *,
    transport: Transport | None = None,
) -> None:
    """出错时也走同一个接口上报，让 Worker 转发 Resend 发邮件。

    上报本身失败了不再重试、不再抛出——本来就是在处理一个错误，不能让
    "上报错误"这件事本身的失败又盖过了原始异常。
    """
    try:
        _post_json(
            ingest_url, sync_token, {"error": {"kind": kind, "detail": detail}}, transport=transport
        )
    except (urllib.error.URLError, OSError, TimeoutError, RuntimeError):
        pass


def run_weekly_sync(
    c: Client,
    start: date,
    ingest_url: str,
    sync_token: str,
    *,
    transport: Transport | None = None,
) -> int:
    """完整走一遍：拉一周 → 批量推给 Worker。

    异常处理策略见 DESIGN.md §6.6 故障处理分层表：
    - SessionExpired：上报后原样往上抛，人工重新登录后手动 prime，cli.py 决定退出码
    - VersionStale：上报后原样往上抛。理论上"重新 prime 即可自动恢复"，但
      prime.py 真正驱动 CDP 的那部分还没实现，这里没法真的自动重跑，只能先如实上报
    - 其它异常：同样上报后往上抛，不在这里猜测原因或吞掉
    """
    try:
        rows = pull_week(c, start)
        return push_to_worker(ingest_url, sync_token, rows, transport=transport)
    except SessionExpired as e:
        report_error(ingest_url, sync_token, "SessionExpired", str(e), transport=transport)
        raise
    except VersionStale as e:
        report_error(ingest_url, sync_token, "VersionStale", str(e), transport=transport)
        raise
    except Exception as e:
        report_error(ingest_url, sync_token, type(e).__name__, str(e), transport=transport)
        raise

"""查询路径。只用标准库，热路径不需要任何安装。

请求体契约（这是最容易静默出错的地方）：

* 屏幕数据动作用 ``screenData.variables``，**不是** ``inputParameters``。
  后者是 ServiceAPI 风格动作用的。用错会返回 400。
* 请求体里**多一个原本没有的键就返回 400**
  （``Failed to parse JSON request content``）。
  所以 prime 存的是整个请求体，这里只修改已存在的叶子，绝不新增键。
* ``SelectedDate`` / ``GymProgramId`` 会**同时出现在两个平级对象里**
  （``RequestCache`` 和 ``In_Request``）。只改第一个不会报错，
  但会查到错误的日期 —— 这类静默错误最难发现，所以 set_field 改所有出现位置。
* ``SelectedDate`` 必须是裸的 ``YYYY-MM-DD``。任何带时间的形式都返回 400
  （浏览器 localStorage 里存的是带时区的形式，那不是线上格式，别照抄）。
"""

from __future__ import annotations

import gzip
import json
import urllib.error
import urllib.request
from typing import Any, Callable

from . import actions


class NotPrimed(Exception):
    """没有缓存，或这个动作从未被观察过。跑一次 prime。"""


class SessionExpired(Exception):
    """会话失效。必须真人重新登录后再 prime。"""


class VersionStale(Exception):
    """Wodify 重新部署了。重跑 prime 即可（可自动化）。"""


# --------------------------------------------------------------------------
# 请求体补丁
# --------------------------------------------------------------------------


def set_field(body: Any, key: str, value: Any) -> int:
    """把 body 里**所有**名为 key 的叶子改成 value，返回改了几处。

    只改已存在的键，永不新增 —— 新增会让 Wodify 返回 400。
    返回 0 表示这个键根本不在请求体里，调用方应当视为异常而不是忽略：
    悄悄什么都没改，就会查到错的日期。
    """
    count = 0
    if isinstance(body, dict):
        for k, v in body.items():
            if k == key:
                body[k] = value
                count += 1
            else:
                count += set_field(v, key, value)
    elif isinstance(body, list):
        for item in body:
            count += set_field(item, key, value)
    return count


def require_field(body: Any, key: str, value: Any) -> None:
    """set_field 的严格版：一处都没改到就抛异常。"""
    n = set_field(body, key, value)
    if n == 0:
        raise NotPrimed(f"请求体里没有 {key!r} —— 缓存的请求体可能是旧版抓的，需要重新 prime")


# --------------------------------------------------------------------------
# 过期检测
# --------------------------------------------------------------------------


def check_fresh(action_name: str, payload: dict) -> None:
    """响应自带版本标记。任一为真就说明缓存过期。

    宁可抛异常，也不返回看起来合理的数据。
    悄无声息地答错「今天没有 WOD」比报错更糟。
    """
    info = payload.get("versionInfo") or {}
    module_changed = bool(info.get("hasModuleVersionChanged"))
    api_changed = bool(info.get("hasApiVersionChanged"))
    if module_changed or api_changed:
        raise VersionStale(
            f"{action_name}：Wodify 重新部署了"
            f"（module 变={module_changed}, api 变={api_changed}）。请重新 prime。"
        )


# --------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------


def _default_transport(url: str, headers: dict, body: bytes) -> tuple[int, bytes]:
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
            if resp.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            return resp.status, raw
    except urllib.error.HTTPError as e:
        raw = e.read()
        # 请求头始终带 Accept-Encoding: gzip，错误响应一样可能被压缩；
        # 不解压的话诊断信息里全是乱码字节，等于没报错原因
        if e.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
        return e.code, raw


class Client:
    """一个动作一次 POST。

    transport 可注入，方便在没有网络的环境下测试协议逻辑。
    """

    def __init__(
        self,
        host: str,
        session: dict,
        transport: Callable[[str, dict, bytes], tuple[int, bytes]] | None = None,
    ):
        self.host = host
        self.session = session
        self.transport = transport or _default_transport

    def _url(self, path: str) -> str:
        return f"https://{self.host}/WodifyClient/screenservices/{path}"

    def query(
        self, action_name: str, *, date: str | None = None, program_id: str | None = None
    ) -> dict:
        path = actions.resolve(action_name)

        primed = (self.session.get("actions") or {}).get(action_name)
        if not primed:
            raise NotPrimed(f"动作 {action_name!r} 没有被 prime 抓到过")

        # 深拷贝，避免污染缓存里的模板
        body = json.loads(json.dumps(primed["body"]))

        if date is not None:
            if not _is_bare_date(date):
                raise ValueError(f"SelectedDate 必须是裸的 YYYY-MM-DD，收到 {date!r}")
            # 两个平级对象里都有，必须都改
            require_field(body, "SelectedDate", date)
        if program_id is not None:
            require_field(body, "GymProgramId", program_id)

        headers = {
            "Content-Type": "application/json; charset=UTF-8",
            "X-CSRFToken": self.session["csrf"],
            "Cookie": self.session["cookie"],
            "Accept": "application/json",
            "Accept-Encoding": "gzip",
        }

        status, raw = self.transport(self._url(path), headers, json.dumps(body).encode("utf-8"))

        if status in (401, 403):
            raise SessionExpired(f"{action_name}：HTTP {status}，会话已失效，需人工登录")
        if status != 200:
            raise RuntimeError(f"{action_name}：HTTP {status} {raw[:200]!r}")

        payload = json.loads(raw)
        check_fresh(action_name, payload)
        return payload


def _is_bare_date(s: str) -> bool:
    if len(s) != 10 or s[4] != "-" or s[7] != "-":
        return False
    y, m, d = s[:4], s[5:7], s[8:10]
    return y.isdigit() and m.isdigit() and d.isdigit()

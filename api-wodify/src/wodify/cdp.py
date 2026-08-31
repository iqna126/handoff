"""驱动 Chrome DevTools Protocol，配合一个已经登录的真实 Chrome 完成 prime。

结构照抄参考实现 `git.luci.ooo/lucio/wodify-cli`（同一个场馆，同一套 Wodify SPA，
见 DESIGN.md §6.6）——第一版自己设计的"连到一个已有标签页 + 从网络请求头里嗅探
cookie"整体上是错的，真机测试直接卡在"未获授权"，原因有两个：

1. **cookie 应该用 CDP 的 `Storage.getCookies` 在浏览器层面直接读**，不该指望
   驱动导航时刚好有请求带出这个 header。这样才能读到 `HttpOnly` 的
   `nr1W_Theme_UI`，而且能一次拿到 `SESSION_COOKIE_NAMES` 里全部三个 cookie——
   只嗅到一个是不够的。
2. **应该自己开一个新标签页导航过去**（`Target.createTarget` + `attachToTarget`），
   不该去接一个"猜出来的"已有标签页——那个标签页很可能压根没登录，或者是
   about:blank，或者是别的域。

⚠️ 除了 `resolve_ws_url` 之外几乎全部无法离线验证：需要真实 Chrome + 真实登录态。
第一次真机跑大概率还要根据实际报错继续调整（比如 WORKOUT_WALK_JS 的选择器），
不代表这版设计有问题——这正是 DESIGN.md 反复强调的"可见的失败优于不可见的错误"。

用法前提：
1. 启动 Chrome 时带 `--remote-debugging-port=9222`（只绑定 127.0.0.1，不能对外，
   见 DESIGN.md §6.6——这个端口没有鉴权，谁连上都能读走全部 cookie）
2. 在这个 Chrome 里用日常账号正常登录 Wodify
3. 跑 `capture()`，把返回的 `observed` 喂给 `prime.observe_to_session()`，
   `cookie` 直接覆盖到结果里（见 cli.py 的 cmd_prime）

需要可选依赖 websockets：`pip install -e '.[prime]'`。
"""

from __future__ import annotations

import asyncio
import json
import urllib.error
import urllib.request
from typing import Any, Callable

from . import config
from .prime import WALK, WORKOUT_WALK_JS, date_label


class CdpUnavailableError(RuntimeError):
    """连不上 CDP，或者连上了但浏览器没有登录态。"""


def resolve_ws_url(cdp_url: str | None = None, timeout: int = 8) -> str:
    """从 CDP 的 HTTP 根路径解析出 browser 级别的 WebSocket 地址。

    `/devtools/browser/<GUID>` 这段每次启动 Chrome 都会变，所以每次都重新解析，
    不缓存。
    """
    root = (cdp_url or config.CDP_URL).rstrip("/")
    try:
        with urllib.request.urlopen(f"{root}/json/version", timeout=timeout) as r:
            info = json.loads(r.read())
    except (urllib.error.URLError, OSError) as e:
        raise CdpUnavailableError(
            f"连不上 CDP（{root}）：{e}。Chrome 开了吗？是不是忘了带 --remote-debugging-port？"
        ) from e
    url = info.get("webSocketDebuggerUrl")
    if not url:
        raise CdpUnavailableError(f"{root}/json/version 没有返回 webSocketDebuggerUrl")
    return url


class CdpSession:
    """一次 CDP WebSocket 连接：一个协程读 socket（`_pump`），把命令回复和事件分流。

    只能有一个协程 `recv`，这不是随便选的写法——`websockets` 在两个协程同时
    `recv` 时会报错，而 prime 恰好需要"一边跑一段长脚本，一边持续收集它
    触发的网络事件"，两者必须能并发。
    """

    def __init__(self, ws):
        self._ws = ws
        self._id = 0
        self.session_id: str | None = None
        self._pending: dict[int, asyncio.Future] = {}
        self._events: asyncio.Queue = asyncio.Queue()
        self._reader: asyncio.Task | None = None

    @classmethod
    async def connect(cls, ws_url: str | None = None) -> CdpSession:
        try:
            import websockets
        except ImportError as e:
            raise ImportError(
                "cdp.py 的真机抓取需要 websockets，装可选依赖：pip install -e '.[prime]'"
            ) from e
        url = ws_url or resolve_ws_url()
        ws = await websockets.connect(url, max_size=64 * 1024 * 1024)
        session = cls(ws)
        session._reader = asyncio.create_task(session._pump())
        return session

    async def _pump(self) -> None:
        """唯一的读取者：命令回复分给对应的 future，其它一律进事件队列。"""
        try:
            async for raw in self._ws:
                msg = json.loads(raw)
                mid = msg.get("id")
                fut = self._pending.pop(mid, None) if mid is not None else None
                if fut is not None:
                    if not fut.done():
                        fut.set_result(msg)
                elif msg.get("method"):
                    self._events.put_nowait(msg)
        except Exception as e:  # noqa: BLE001 - 让所有等待者都能看到这个错误
            for fut in self._pending.values():
                if not fut.done():
                    fut.set_exception(e)
            self._pending.clear()

    async def close(self) -> None:
        if self._reader is not None:
            self._reader.cancel()
            self._reader = None
        await self._ws.close()

    async def call(
        self,
        method: str,
        params: dict | None = None,
        *,
        on_target: bool = False,
        timeout: float = 60.0,
    ) -> dict:
        self._id += 1
        mid = self._id
        msg: dict[str, Any] = {"id": mid, "method": method, "params": params or {}}
        if on_target:
            if not self.session_id:
                raise RuntimeError(f"{method}：还没 attach 到任何页面")
            msg["sessionId"] = self.session_id

        fut: asyncio.Future = asyncio.get_event_loop().create_future()
        self._pending[mid] = fut
        await self._ws.send(json.dumps(msg))
        try:
            raw = await asyncio.wait_for(fut, timeout=timeout)
        except asyncio.TimeoutError as e:
            self._pending.pop(mid, None)
            raise RuntimeError(f"{method}：{timeout} 秒没等到回复") from e
        if "error" in raw:
            raise RuntimeError(f"{method}：{raw['error']}")
        return raw.get("result", {})

    async def open_page(self, url: str = "about:blank") -> None:
        """新开一个标签页并 attach 上去——不要去接一个猜出来的已有标签页。"""
        target = await self.call("Target.createTarget", {"url": url})
        att = await self.call(
            "Target.attachToTarget", {"targetId": target["targetId"], "flatten": True}
        )
        self.session_id = att["sessionId"]
        await self.call("Page.enable", on_target=True)
        await self.call("Network.enable", on_target=True)

    async def navigate(self, url: str) -> None:
        await self.call("Page.navigate", {"url": url}, on_target=True)

    async def evaluate(self, expression: str, *, await_promise: bool = False) -> Any:
        res = await self.call(
            "Runtime.evaluate",
            {"expression": expression, "returnByValue": True, "awaitPromise": await_promise},
            on_target=True,
        )
        return (res.get("result") or {}).get("value")

    async def session_cookies(self) -> str:
        """从浏览器层面直接读 cookie（不是从某个请求头里嗅探）。

        这样才能读到 HttpOnly 的 nr1W_Theme_UI——它对页面 JS 不可见，
        `document.cookie` 读不到，Storage.getCookies 是浏览器层面的接口，不受此限制。
        """
        jar = await self.call("Storage.getCookies")
        found = {}
        for c in jar.get("cookies", []):
            if c.get("name") in config.SESSION_COOKIE_NAMES and config.WODIFY_HOST in (
                c.get("domain") or ""
            ):
                found[c["name"]] = c.get("value", "")
        if "nr1W_Theme_UI" not in found:
            raise CdpUnavailableError(
                "这个 Chrome profile 里没有 nr1W_Theme_UI cookie——说明还没登录 Wodify。"
                "先在这个浏览器窗口里手动登录一次，再重新跑 prime。"
            )
        return "; ".join(f"{n}={v}" for n, v in found.items())

    async def drain(self, seconds: float, handler: Callable[[dict], None]) -> None:
        """在 seconds 秒内，把收到的每个事件喂给 handler。

        从 `_pump` 填的队列里读，不直接读 socket，所以能跟 `call`/`evaluate`
        并发跑——跑脚本触发请求的同时收集这些请求，这正是 prime 需要的时序。
        """
        loop = asyncio.get_event_loop()
        deadline = loop.time() + seconds
        while True:
            remaining = deadline - loop.time()
            if remaining <= 0:
                return
            try:
                event = await asyncio.wait_for(self._events.get(), timeout=min(1.0, remaining))
            except asyncio.TimeoutError:
                continue
            handler(event)


def _to_observed(event: dict) -> dict | None:
    """把一个 CDP 的 Network.requestWillBeSent 事件转成 observe_to_session() 要的形状。

    纯函数，可以用构造出来的事件离线测。
    """
    if event.get("method") != "Network.requestWillBeSent":
        return None
    req = event.get("params", {}).get("request", {})
    url = req.get("url", "")
    if not url:
        return None
    body = None
    post_data = req.get("postData")
    if post_data:
        try:
            body = json.loads(post_data)
        except json.JSONDecodeError:
            body = None
    return {"url": url, "headers": req.get("headers", {}), "body": body}


async def capture(cdp_url: str, host: str, target_date: str) -> dict:
    """连上一个已登录的 Chrome，走 WALK + WORKOUT_WALK_JS，收集观察到的网络请求。

    target_date 要选一个**还没被 OutSystems 缓存过、且确实发布了 WOD** 的日期
    （见 prime.py 模块说明），否则页面直接用缓存结果，一个请求都不发。

    返回 {"observed": [...], "cookie": "...", "walk_log": {...}}——observed 喂给
    prime.observe_to_session()，cookie 是从浏览器直接读到的，要覆盖掉
    observe_to_session() 从 observed 里猜出来的那个（那个猜测在这个新设计下已经
    不准了，因为不再从网络请求头拿 cookie）。walk_log 只是诊断用的，不代表成败——
    见函数末尾的说明。
    """
    session = await CdpSession.connect()
    observed: list[dict] = []

    def collect(event: dict) -> None:
        item = _to_observed(event)
        if item is not None:
            observed.append(item)

    try:
        cookie = await session.session_cookies()
        await session.open_page()

        for path, wait in WALK:
            await session.navigate(f"https://{host}{path}")
            await session.drain(wait, collect)

        script = WORKOUT_WALK_JS.replace("__DATE_LABEL__", json.dumps(date_label(target_date)))
        walk_task = asyncio.create_task(session.evaluate(script, await_promise=True))
        drain_task = asyncio.create_task(session.drain(30, collect))
        try:
            walk_log = await asyncio.wait_for(asyncio.shield(walk_task), timeout=45)
        except asyncio.TimeoutError:
            walk_log = {"error": "walk 超时"}
        except Exception as e:  # noqa: BLE001 - 记下来诊断用，不在这里判断成败
            walk_log = {"error": f"{type(e).__name__}: {e}"}
        await drain_task
    finally:
        await session.close()

    # walk_log（点没点到"WARM-UP"这几个字）只是诊断信息，不是成败判据——
    # 点了"Go to workout"那一下，触发内容加载的请求就已经发出去了，不管最后
    # 页面渲染成什么样。真正的成败判据是有没有嗅探到需要的请求，那个由
    # 调用方（cli.cmd_prime）拿 observe_to_session() 算出的 missing 列表判断。
    # 参考实现 wodify-cli 的 prime.py 是同一个思路：只在没抓到 csrf/moduleVersion
    # 时才算失败，从不检查页面最终有没有显示某段特定文字。
    return {"observed": observed, "cookie": cookie, "walk_log": walk_log}

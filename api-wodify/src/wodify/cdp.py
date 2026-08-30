"""驱动 Chrome DevTools Protocol，配合一个已经登录的真实 Chrome 完成 prime。

⚠️ 除了 `find_page_target`/`_extract_observed` 这两个纯函数，本模块**无法离线验证**：
需要真实 Chrome + 真实 Wodify 登录态。第一次用大概率要根据实际报错调整——CDP 协议
细节、Wodify 页面结构都可能跟这里假设的有出入，不代表设计有问题。

用法前提：
1. 启动 Chrome 时带 `--remote-debugging-port=9222`（只绑定 127.0.0.1，不能对外，
   见 DESIGN.md §6.6——这个端口没有鉴权，谁连上都能读走全部 cookie）
2. 在这个 Chrome 里用日常账号正常登录 Wodify
3. 跑 `capture()`，把返回值喂给 `prime.observe_to_session()`

需要可选依赖 websockets：`pip install -e '.[prime]'`。
"""

from __future__ import annotations

import asyncio
import itertools
import json
import urllib.request

from .prime import WORKOUT_WALK_JS


def list_targets(cdp_url: str) -> list[dict]:
    """列出 Chrome 当前打开的标签页，找 webSocketDebuggerUrl 用。"""
    with urllib.request.urlopen(f"{cdp_url}/json/list", timeout=10) as r:
        return json.loads(r.read())


def find_page_target(targets: list[dict]) -> dict:
    """从标签页列表里挑一个普通页面（排除 DevTools/扩展自己的东西）。

    纯函数，可以离线测——真正拿到的 targets 列表来自真实 Chrome。
    """
    for t in targets:
        if t.get("type") == "page" and not t.get("url", "").startswith(
            ("devtools://", "chrome-extension://")
        ):
            return t
    raise RuntimeError("没找到可用的页面标签——Chrome 是不是没开着任何普通网页标签？")


def _extract_observed(events: list[dict]) -> list[dict]:
    """从 CDP 的 Network.requestWillBeSent 事件里抠出 observe_to_session() 要的形状。

    纯函数，可以用构造出来的 CDP 事件离线测；真正的事件来自真实 Chrome。
    """
    observed = []
    for e in events:
        if e.get("method") != "Network.requestWillBeSent":
            continue
        req = e.get("params", {}).get("request", {})
        url = req.get("url", "")
        if not url:
            continue
        body = None
        post_data = req.get("postData")
        if post_data:
            try:
                body = json.loads(post_data)
            except json.JSONDecodeError:
                body = None
        observed.append({"url": url, "headers": req.get("headers", {}), "body": body})
    return observed


class CdpSession:
    """一次 CDP WebSocket 连接的最小封装：发命令等回复、把事件攒起来。"""

    def __init__(self, ws):
        self._ws = ws
        self._id_counter = itertools.count(1)
        self._pending: dict[int, asyncio.Future] = {}
        self.events: list[dict] = []
        self._listener_task: asyncio.Task | None = None

    @classmethod
    async def connect(cls, ws_url: str) -> CdpSession:
        try:
            import websockets
        except ImportError as e:
            raise ImportError(
                "cdp.py 的真机抓取需要 websockets，装可选依赖：pip install -e '.[prime]'"
            ) from e
        ws = await websockets.connect(ws_url, max_size=None)
        session = cls(ws)
        session._listener_task = asyncio.create_task(session._listen())
        return session

    async def _listen(self) -> None:
        async for raw in self._ws:
            msg = json.loads(raw)
            if "id" in msg:
                fut = self._pending.pop(msg["id"], None)
                if fut and not fut.done():
                    fut.set_result(msg)
            else:
                self.events.append(msg)

    async def send(self, method: str, params: dict | None = None) -> dict:
        msg_id = next(self._id_counter)
        fut = asyncio.get_event_loop().create_future()
        self._pending[msg_id] = fut
        await self._ws.send(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
        return await asyncio.wait_for(fut, timeout=30)

    async def close(self) -> None:
        if self._listener_task:
            self._listener_task.cancel()
        await self._ws.close()


async def capture(cdp_url: str, host: str, target_date: str) -> list[dict]:
    """连上一个已登录的 Chrome，跑 WORKOUT_WALK_JS，收集观察到的网络请求。

    target_date 要选一个**还没被 OutSystems 缓存过、且确实发布了 WOD** 的日期
    （见 prime.py 模块说明），否则页面直接用缓存结果，一个请求都不发。

    返回值直接喂给 prime.observe_to_session(observed, host=host)。
    """
    targets = list_targets(cdp_url)
    target = find_page_target(targets)
    session = await CdpSession.connect(target["webSocketDebuggerUrl"])
    try:
        await session.send("Page.enable")
        await session.send("Network.enable")
        # 先显式导航到 Wodify 的域，WORKOUT_WALK_JS 里用的是相对路径
        # （location.href = '/WodifyClient/Schedule'），标签页必须已经在这个域下
        await session.send("Page.navigate", {"url": f"https://{host}/WodifyClient/Schedule"})
        await asyncio.sleep(3)

        script = WORKOUT_WALK_JS.replace("TARGET_DATE", json.dumps(target_date))
        result = await session.send(
            "Runtime.evaluate",
            {"expression": script, "awaitPromise": True, "returnByValue": True},
        )
        value = result.get("result", {}).get("result", {}).get("value")
        if not value or not value.get("ok"):
            raise RuntimeError(
                f"WORKOUT_WALK_JS 没跑通，页面结构可能变了：{value}"
                "（这是预期中最可能需要人工调整的地方，见模块顶部说明）"
            )

        await asyncio.sleep(1)  # 留一点时间让最后几个网络事件到达
        return _extract_observed(session.events)
    finally:
        await session.close()

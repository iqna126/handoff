"""测试 cdp.py 里能离线测的部分：_to_observed、resolve_ws_url 的报错路径，
以及 CdpSession 自己的协议记账逻辑（用一个假 WebSocket 注入，不需要真实
Chrome——跟 client.Client 注入 transport 测协议是同一个思路）。

capture() 本身（走 WALK、跑 WORKOUT_WALK_JS）还是需要真实 Chrome + 真实
Wodify 登录态，没法在这里测，见模块顶部说明——首次真机验证之前不代表这些
函数没问题。
"""

import asyncio
import json

import pytest

from wodify import cdp


class FakeWebSocket:
    """用一问一答的方式模拟 CDP 的 WebSocket：发什么方法，按 responder 给
    的规则回什么结果。responder 返回 None 就是这条消息不回复（模拟真实
    CDP 里有些通知没有回执）。
    """

    def __init__(self, responder):
        self._responder = responder
        self._outbox: asyncio.Queue = asyncio.Queue()
        self.sent: list[dict] = []

    async def send(self, raw: str) -> None:
        msg = json.loads(raw)
        self.sent.append(msg)
        reply = self._responder(msg)
        if reply is not None:
            await self._outbox.put(json.dumps({"id": msg["id"], "result": reply}))

    def __aiter__(self):
        return self

    async def __anext__(self):
        return await self._outbox.get()

    async def close(self) -> None:
        pass


def _make_session(responder) -> cdp.CdpSession:
    session = cdp.CdpSession(FakeWebSocket(responder))
    session._reader = asyncio.get_event_loop().create_task(session._pump())
    return session


class TestCdpSessionTargetLifecycle:
    """标签页的开/关记账——之前 close() 只断 WebSocket，从没真的关过
    Target.createTarget 开出来的标签页，prime 定期跑（cron）会导致 Chrome
    里标签页越攒越多。见 close()/open_page() 的说明。
    """

    def test_open_page_records_target_id(self):
        async def scenario():
            def responder(msg):
                if msg["method"] == "Target.createTarget":
                    return {"targetId": "target-123"}
                if msg["method"] == "Target.attachToTarget":
                    return {"sessionId": "session-456"}
                return {}

            session = _make_session(responder)
            await session.open_page()
            assert session.target_id == "target-123"
            await session.close()

        asyncio.run(scenario())

    def test_close_sends_close_target_with_the_right_id(self):
        async def scenario():
            def responder(msg):
                if msg["method"] == "Target.createTarget":
                    return {"targetId": "target-789"}
                if msg["method"] == "Target.attachToTarget":
                    return {"sessionId": "session-456"}
                return {}

            session = _make_session(responder)
            await session.open_page()
            await session.close()

            close_calls = [m for m in session._ws.sent if m["method"] == "Target.closeTarget"]
            assert len(close_calls) == 1, "标签页必须被显式关掉，不能只断 WebSocket 连接"
            assert close_calls[0]["params"] == {"targetId": "target-789"}

        asyncio.run(scenario())

    def test_close_without_ever_opening_a_page_does_not_crash(self):
        async def scenario():
            session = _make_session(lambda msg: {})
            await session.close()
            assert not any(m["method"] == "Target.closeTarget" for m in session._ws.sent)

        asyncio.run(scenario())

    def test_close_target_failure_does_not_prevent_disconnect(self):
        """关标签页这一步本身失败了（比如页面已经被人手动关掉），不能因此
        导致 close() 抛异常、连接断不掉——这只是收尾动作。
        """

        async def scenario():
            def responder(msg):
                if msg["method"] == "Target.createTarget":
                    return {"targetId": "target-1"}
                if msg["method"] == "Target.attachToTarget":
                    return {"sessionId": "session-1"}
                if msg["method"] == "Target.closeTarget":
                    return (
                        None  # 模拟没有回复 -> call() 超时/出错的路径由别处覆盖，这里模拟直接不回复
                    )
                return {}

            session = _make_session(responder)
            await session.open_page()
            # call() 默认超时 60 秒，测试里改用很短的超时验证"关闭失败不抛出"
            orig_call = session.call

            async def short_timeout_call(method, params=None, **kwargs):
                if method == "Target.closeTarget":
                    kwargs["timeout"] = 0.05
                return await orig_call(method, params, **kwargs)

            session.call = short_timeout_call
            await session.close()  # 不应该抛异常

        asyncio.run(scenario())


class TestResolveWsUrl:
    def test_unreachable_cdp_raises_clear_error(self):
        # 127.0.0.1 上一个几乎不可能被占用的端口，模拟"Chrome 没开着调试端口"
        with pytest.raises(cdp.CdpUnavailableError, match="连不上 CDP"):
            cdp.resolve_ws_url("http://127.0.0.1:1", timeout=1)


class TestToObserved:
    def test_pulls_url_headers_and_json_body(self):
        event = {
            "method": "Network.requestWillBeSent",
            "params": {
                "request": {
                    "url": "https://gym.wodify.com/WodifyClient/screenservices/x",
                    "headers": {"Cookie": "a=b", "X-CSRFToken": "c"},
                    "postData": '{"screenData": {"variables": {}}}',
                }
            },
        }
        assert cdp._to_observed(event) == {
            "url": "https://gym.wodify.com/WodifyClient/screenservices/x",
            "headers": {"Cookie": "a=b", "X-CSRFToken": "c"},
            "body": {"screenData": {"variables": {}}},
        }

    def test_ignores_non_network_events(self):
        assert cdp._to_observed({"method": "Page.loadEventFired", "params": {}}) is None

    def test_get_requests_have_no_body(self):
        event = {
            "method": "Network.requestWillBeSent",
            "params": {"request": {"url": "https://x/y", "headers": {}}},
        }
        assert cdp._to_observed(event)["body"] is None

    def test_malformed_post_data_does_not_crash(self):
        event = {
            "method": "Network.requestWillBeSent",
            "params": {"request": {"url": "https://x/y", "headers": {}, "postData": "not json"}},
        }
        assert cdp._to_observed(event)["body"] is None

    def test_requests_without_url_are_dropped(self):
        event = {"method": "Network.requestWillBeSent", "params": {"request": {"headers": {}}}}
        assert cdp._to_observed(event) is None

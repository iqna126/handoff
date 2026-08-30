"""测试 /api/wod/ingest、告警、存活校验。

用 httpx.MockTransport 模拟 Supabase/Resend 的真实响应，跟 api-wodify/client.py
测试时注入 transport 是同一个思路——测的是"我们的代码发没发对请求"，不是
"mock 返回了我们让它返回的东西"那种同义反复。
"""

import asyncio
import json
from types import SimpleNamespace

import httpx
from fastapi.testclient import TestClient

from entry import app, check_wods_freshness, get_env, get_http_client, send_alert, upsert_wods

FAKE_ENV = SimpleNamespace(
    WODIFY_SYNC_TOKEN="secret-token",  # noqa: S105 test fixture, not a real credential
    SUPABASE_URL="https://fake.supabase.co",
    SUPABASE_SERVICE_KEY="fake-service-key",
    RESEND_API_KEY="fake-resend-key",
    ALERT_EMAIL="me@example.com",
)


def mock_client(handler):
    """按 handler 的逻辑造一个假的出站 client，供 dependency_overrides 用。"""

    async def override():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            yield c

    return override


def always_ok(request: httpx.Request) -> httpx.Response:
    return httpx.Response(200, json=[])


app.dependency_overrides[get_env] = lambda: FAKE_ENV
client = TestClient(app)


class TestTokenGuard:
    def setup_method(self):
        app.dependency_overrides[get_http_client] = mock_client(always_ok)

    def test_missing_token_rejected(self):
        resp = client.post("/api/wod/ingest", json={"wods": []})
        assert resp.status_code == 401

    def test_wrong_token_rejected(self):
        resp = client.post(
            "/api/wod/ingest",
            json={"wods": []},
            headers={"Authorization": "Bearer wrong-token"},
        )
        assert resp.status_code == 401

    def test_correct_token_passes(self):
        resp = client.post(
            "/api/wod/ingest",
            json={"wods": []},
            headers={"Authorization": "Bearer secret-token"},
        )
        assert resp.status_code == 200


class TestIngestUpsert:
    def test_wods_batch_upserted_in_one_request(self):
        captured = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["url"] = str(request.url)
            captured["headers"] = dict(request.headers)
            captured["body"] = request.content
            return httpx.Response(201, json=[])

        app.dependency_overrides[get_http_client] = mock_client(handler)

        resp = client.post(
            "/api/wod/ingest",
            json={
                "wods": [
                    {"day": "2026-08-31", "class_type": "CrossFit", "sections": [], "raw": {}},
                    {"day": "2026-09-01", "class_type": "CrossFit", "sections": [], "raw": {}},
                ]
            },
            headers={"Authorization": "Bearer secret-token"},
        )

        assert resp.status_code == 200
        assert resp.json() == {"written": 2}, "一次批量写入，不是一天写一次"
        assert "on_conflict=day,class_type" in captured["url"]
        assert captured["headers"]["apikey"] == "fake-service-key"
        assert captured["headers"]["prefer"] == "resolution=merge-duplicates,return=minimal"
        assert len(json.loads(captured["body"])) == 2, "两条数据要在同一个请求体里"

    def test_no_wods_skips_the_http_call_entirely(self):
        def handler(request: httpx.Request) -> httpx.Response:
            raise AssertionError("没有数据时不该发请求")

        async def run():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
                return await upsert_wods(FAKE_ENV, [], client=c)

        assert asyncio.run(run()) == 0


class TestErrorReportTriggersAlert:
    def test_error_in_request_body_calls_resend(self):
        captured = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["url"] = str(request.url)
            captured["body"] = json.loads(request.content)
            return httpx.Response(200, json={"id": "abc"})

        app.dependency_overrides[get_http_client] = mock_client(handler)

        resp = client.post(
            "/api/wod/ingest",
            json={"error": {"kind": "SessionExpired", "detail": "需要人工重新登录"}},
            headers={"Authorization": "Bearer secret-token"},
        )

        assert resp.status_code == 200
        assert resp.json() == {"written": 0}
        assert captured["url"] == "https://api.resend.com/emails"
        assert "SessionExpired" in captured["body"]["subject"]
        assert captured["body"]["to"] == ["me@example.com"]


class TestSendAlert:
    def test_sends_expected_payload(self):
        captured = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["url"] = str(request.url)
            captured["auth"] = request.headers.get("authorization")
            captured["body"] = json.loads(request.content)
            return httpx.Response(200, json={"id": "abc"})

        async def run():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
                await send_alert(FAKE_ENV, "主题", "正文", client=c)

        asyncio.run(run())

        assert captured["url"] == "https://api.resend.com/emails"
        assert captured["auth"] == "Bearer fake-resend-key"
        assert captured["body"]["to"] == ["me@example.com"]
        assert captured["body"]["subject"] == "主题"

    def test_missing_config_skips_the_http_call_entirely(self):
        def handler(request: httpx.Request) -> httpx.Response:
            raise AssertionError("没配置 RESEND_API_KEY/ALERT_EMAIL 时不该发请求")

        incomplete_env = SimpleNamespace(RESEND_API_KEY="", ALERT_EMAIL="")

        async def run():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
                await send_alert(incomplete_env, "主题", "正文", client=c)

        asyncio.run(run())  # 不抛异常就算过


class TestFreshnessCheck:
    def test_alerts_when_todays_wods_missing(self):
        calls = []

        def handler(request: httpx.Request) -> httpx.Response:
            calls.append(str(request.url))
            if "resend.com" in str(request.url):
                return httpx.Response(200, json={"id": "abc"})
            return httpx.Response(200, json=[])  # 查询结果为空

        async def run():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
                await check_wods_freshness(FAKE_ENV, client=c)

        asyncio.run(run())

        assert any("resend.com" in url for url in calls), "查询结果为空应该触发告警"

    def test_no_alert_when_todays_wods_present(self):
        calls = []

        def handler(request: httpx.Request) -> httpx.Response:
            calls.append(str(request.url))
            if "resend.com" in str(request.url):
                raise AssertionError("今天有数据不该发告警")
            return httpx.Response(200, json=[{"id": "1"}])  # 有数据

        async def run():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
                await check_wods_freshness(FAKE_ENV, client=c)

        asyncio.run(run())
        assert len(calls) == 1, "有数据时只该查一次，不该再发告警请求"

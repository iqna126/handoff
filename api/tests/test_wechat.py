"""测试 /api/wechat/login：code 换 openid、查/建账号、签发 Supabase 会话。

用 httpx.MockTransport 模拟微信 jscode2session 接口和 Supabase admin API 的
真实响应，不是"mock 返回了我们让它返回的东西"那种同义反复——测的是我们的
代码按什么顺序发了什么请求。
"""

import json
from types import SimpleNamespace

import httpx
import pytest
from conftest import mock_client
from fastapi.testclient import TestClient

from entry import app, get_env, get_http_client

FAKE_ENV = SimpleNamespace(
    SUPABASE_URL="https://fake.supabase.co",
    SUPABASE_SERVICE_KEY="fake-service-key",
    WECHAT_APP_ID="fake-app-id",
    WECHAT_APP_SECRET="fake-app-secret",  # noqa: S105 test fixture, not a real credential
)

client = TestClient(app)


@pytest.fixture(autouse=True)
def _fake_env():
    # 每个测试前装好、测完清掉——这个 app 单例跟 test_ingest.py 共用，
    # 不能只在模块顶层赋值一次，见那边同名 fixture 的说明。
    app.dependency_overrides[get_env] = lambda: FAKE_ENV
    yield
    app.dependency_overrides.pop(get_env, None)


def _mint_session_responses(request, calls):
    """generate_link + verify 这两步，不管哪个场景都要走，抽出来复用。"""
    if "admin/generate_link" in str(request.url):
        return httpx.Response(200, json={"hashed_token": "fake-hashed-token"})
    if "/auth/v1/verify" in str(request.url):
        assert json.loads(request.content) == {
            "type": "magiclink",
            "token_hash": "fake-hashed-token",
        }
        return httpx.Response(
            200,
            json={
                "access_token": "fake-access-token",
                "refresh_token": "fake-refresh-token",
                "user": {"id": "user-123"},
            },
        )
    return None


class TestNewUser:
    def test_unknown_openid_creates_account_and_logs_in(self):
        calls = []

        def handler(request: httpx.Request) -> httpx.Response:
            calls.append(str(request.url))
            if "jscode2session" in str(request.url):
                assert request.url.params["js_code"] == "fake-code"
                assert request.url.params["appid"] == "fake-app-id"
                assert request.url.params["secret"] == "fake-app-secret"
                return httpx.Response(200, json={"openid": "openid-abc"})
            if "wechat_identities" in str(request.url) and request.method == "GET":
                return httpx.Response(200, json=[])  # 查不到，新用户
            if "admin/users" in str(request.url) and request.method == "POST":
                body = json.loads(request.content)
                assert body["email"] == "wx-openid-abc@wechat.handoff.invalid"
                assert body["email_confirm"] is True
                return httpx.Response(200, json={"id": "user-123"})
            if "wechat_identities" in str(request.url) and request.method == "POST":
                body = json.loads(request.content)
                assert body == {
                    "openid": "openid-abc",
                    "user_id": "user-123",
                    "source": "miniprogram",
                }
                assert "on_conflict=openid,source" in str(request.url)
                assert request.headers["prefer"] == "resolution=merge-duplicates,return=minimal"
                return httpx.Response(201, json=[])
            mint = _mint_session_responses(request, calls)
            if mint is not None:
                return mint
            raise AssertionError(f"没预料到的请求：{request.url}")

        app.dependency_overrides[get_http_client] = mock_client(handler)

        resp = client.post("/api/wechat/login", json={"code": "fake-code"})

        assert resp.status_code == 200
        assert resp.json() == {
            "access_token": "fake-access-token",
            "refresh_token": "fake-refresh-token",
            "is_new_user": True,
        }
        assert any("admin/users" in c for c in calls), "没查到 openid 时必须建新用户"


class TestReturningUser:
    def test_known_openid_logs_in_without_creating_anything(self):
        calls = []

        def handler(request: httpx.Request) -> httpx.Response:
            calls.append(str(request.url))
            if "jscode2session" in str(request.url):
                return httpx.Response(200, json={"openid": "openid-known"})
            if "wechat_identities" in str(request.url):
                return httpx.Response(200, json=[{"user_id": "user-999"}])
            if request.url.path == "/auth/v1/admin/users/user-999":
                return httpx.Response(200, json={"id": "user-999", "email": "real@example.com"})
            if "admin/users" in str(request.url) and request.method == "POST":
                raise AssertionError("已有记录的 openid 不该再建新用户")
            mint = _mint_session_responses(request, calls)
            if mint is not None:
                return mint
            raise AssertionError(f"没预料到的请求：{request.url}")

        app.dependency_overrides[get_http_client] = mock_client(handler)

        resp = client.post("/api/wechat/login", json={"code": "fake-code"})

        assert resp.status_code == 200
        assert resp.json()["is_new_user"] is False
        assert not any("admin/users" in c and c.endswith("users") for c in calls)


class TestWechatApiError:
    def test_bad_code_returns_401_not_500(self):
        def handler(request: httpx.Request) -> httpx.Response:
            if "jscode2session" in str(request.url):
                return httpx.Response(200, json={"errcode": 40029, "errmsg": "invalid code"})
            raise AssertionError("code 本身就换不到 openid，不该再往下发任何请求")

        app.dependency_overrides[get_http_client] = mock_client(handler)

        resp = client.post("/api/wechat/login", json={"code": "expired-code"})

        assert resp.status_code == 401
        assert "微信登录失败" in resp.json()["detail"]

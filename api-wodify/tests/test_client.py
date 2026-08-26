import json

import pytest

from wodify import client


# 模拟被 prime 抓下来的请求体：SelectedDate 故意放在两个平级对象里，
# 这正是文档记录的静默错误来源
PRIMED_BODY = {
    "versionInfo": {"moduleVersion": "abc", "apiVersion": "def"},
    "viewName": "MainScreens.Exercise",
    "screenData": {
        "variables": {
            "RequestCache": {"SelectedDate": "2026-07-24", "GymProgramId": "7"},
            "In_Request": {"SelectedDate": "2026-07-24", "GymProgramId": "7"},
            "ClientVariables": {
                "SelectedDate": "2026-07-24",
                "ActiveLocationId": "11644",
                "CustomerId": "1",
                "UserId": "2",
            },
        }
    },
}

SESSION = {
    "csrf": "x" * 28,
    "cookie": "nr1W_Theme_UI=aaa; AuthenticationToken=bbb",
    "actions": {"workout": {"body": PRIMED_BODY}},
}


class TestSetField:
    def test_writes_every_occurrence(self):
        body = json.loads(json.dumps(PRIMED_BODY))
        n = client.set_field(body, "SelectedDate", "2026-08-25")
        assert n == 3, "三处都要改到，只改第一处会静默查错日期"
        v = body["screenData"]["variables"]
        assert v["RequestCache"]["SelectedDate"] == "2026-08-25"
        assert v["In_Request"]["SelectedDate"] == "2026-08-25"
        assert v["ClientVariables"]["SelectedDate"] == "2026-08-25"

    def test_never_adds_new_keys(self):
        body = {"a": {"b": 1}}
        n = client.set_field(body, "NotThere", "x")
        assert n == 0
        assert body == {"a": {"b": 1}}, "多一个键 Wodify 会返回 400，绝不能新增"

    def test_walks_lists(self):
        body = {"list": [{"SelectedDate": "old"}, {"SelectedDate": "old"}]}
        assert client.set_field(body, "SelectedDate", "new") == 2

    def test_require_field_raises_when_absent(self):
        with pytest.raises(client.NotPrimed, match="没有"):
            client.require_field({"a": 1}, "SelectedDate", "2026-08-25")


class TestFreshness:
    def test_module_change_raises(self):
        with pytest.raises(client.VersionStale, match="重新部署"):
            client.check_fresh("workout", {"versionInfo": {"hasModuleVersionChanged": True}})

    def test_api_change_raises(self):
        with pytest.raises(client.VersionStale):
            client.check_fresh("workout", {"versionInfo": {"hasApiVersionChanged": True}})

    def test_fresh_passes(self):
        client.check_fresh("workout", {
            "versionInfo": {"hasModuleVersionChanged": False, "hasApiVersionChanged": False}
        })

    def test_missing_versioninfo_is_not_an_error(self):
        # 有些动作不带 versionInfo，不应因此报错
        client.check_fresh("workout", {"data": 1})


class TestQuery:
    def _client(self, status=200, payload=None, capture=None):
        def transport(url, headers, body):
            if capture is not None:
                capture["url"] = url
                capture["headers"] = headers
                capture["body"] = json.loads(body)
            return status, json.dumps(payload or {"versionInfo": {}}).encode()
        return client.Client("gym.wodify.com", SESSION, transport=transport)

    def test_date_patched_into_all_slots(self):
        cap = {}
        c = self._client(capture=cap)
        c.query("workout", date="2026-08-25")
        v = cap["body"]["screenData"]["variables"]
        assert v["RequestCache"]["SelectedDate"] == "2026-08-25"
        assert v["In_Request"]["SelectedDate"] == "2026-08-25"

    def test_primed_template_not_mutated(self):
        c = self._client()
        c.query("workout", date="2026-08-25")
        assert PRIMED_BODY["screenData"]["variables"]["RequestCache"]["SelectedDate"] \
            == "2026-07-24", "缓存模板必须保持原样，否则第二次查询会串"

    def test_headers_carry_csrf_and_cookie(self):
        cap = {}
        self._client(capture=cap).query("workout", date="2026-08-25")
        assert cap["headers"]["X-CSRFToken"] == "x" * 28
        assert "AuthenticationToken" in cap["headers"]["Cookie"]

    @pytest.mark.parametrize("bad", [
        "2026-08-25T00:00:00",
        "2026-08-25T00:00:00Z",
        "2026-08-25T07:00:00.000Z",
        "08/25/2026",
        "2026-8-25",
    ])
    def test_non_bare_dates_refused(self, bad):
        with pytest.raises(ValueError, match="裸的"):
            self._client().query("workout", date=bad)

    @pytest.mark.parametrize("status", [401, 403])
    def test_auth_failure_is_session_expired(self, status):
        with pytest.raises(client.SessionExpired):
            self._client(status=status).query("workout", date="2026-08-25")

    def test_unprimed_action_raises(self):
        c = client.Client("gym.wodify.com", {"csrf": "c", "cookie": "k", "actions": {}})
        with pytest.raises(client.NotPrimed):
            c.query("workout", date="2026-08-25")

    def test_stale_response_raises_not_returns(self):
        c = self._client(payload={"versionInfo": {"hasModuleVersionChanged": True}})
        with pytest.raises(client.VersionStale):
            c.query("workout", date="2026-08-25")

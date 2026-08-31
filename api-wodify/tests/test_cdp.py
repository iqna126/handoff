"""测试 cdp.py 里能离线测的部分：_to_observed 和 resolve_ws_url 的报错路径。

CdpSession/capture 需要真实 Chrome + 真实 Wodify 登录态，没法在这里测，
见模块顶部说明——首次真机验证之前不代表这些函数没问题。
"""

import pytest

from wodify import cdp


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

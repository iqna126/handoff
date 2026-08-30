"""测试 cdp.py 里能离线测的两个纯函数。

CdpSession/capture 需要真实 Chrome + 真实 Wodify 登录态，没法在这里测，
见模块顶部说明——首次真机验证之前不代表这两个函数没问题。
"""

import pytest

from wodify import cdp


class TestFindPageTarget:
    def test_picks_the_first_normal_page(self):
        targets = [
            {"type": "background_page", "url": "chrome-extension://abc/bg.html"},
            {"type": "page", "url": "https://gym.wodify.com/WodifyClient/Schedule"},
        ]
        assert cdp.find_page_target(targets)["url"].startswith("https://gym.wodify.com")

    def test_skips_devtools_and_extension_targets(self):
        targets = [
            {"type": "page", "url": "devtools://devtools/bundled/inspector.html"},
            {"type": "page", "url": "chrome-extension://abc/popup.html"},
            {"type": "page", "url": "https://gym.wodify.com/WodifyClient/Schedule"},
        ]
        assert (
            cdp.find_page_target(targets)["url"] == "https://gym.wodify.com/WodifyClient/Schedule"
        )

    def test_raises_when_nothing_usable(self):
        with pytest.raises(RuntimeError, match="没找到"):
            cdp.find_page_target([{"type": "background_page", "url": "chrome-extension://x"}])


class TestExtractObserved:
    def test_pulls_url_headers_and_json_body(self):
        events = [
            {
                "method": "Network.requestWillBeSent",
                "params": {
                    "request": {
                        "url": "https://gym.wodify.com/WodifyClient/screenservices/x",
                        "headers": {"Cookie": "a=b", "X-CSRFToken": "c"},
                        "postData": '{"screenData": {"variables": {}}}',
                    }
                },
            }
        ]
        observed = cdp._extract_observed(events)
        assert observed == [
            {
                "url": "https://gym.wodify.com/WodifyClient/screenservices/x",
                "headers": {"Cookie": "a=b", "X-CSRFToken": "c"},
                "body": {"screenData": {"variables": {}}},
            }
        ]

    def test_ignores_non_network_events(self):
        events = [{"method": "Page.loadEventFired", "params": {}}]
        assert cdp._extract_observed(events) == []

    def test_get_requests_have_no_body(self):
        events = [
            {
                "method": "Network.requestWillBeSent",
                "params": {"request": {"url": "https://x/y", "headers": {}}},
            }
        ]
        assert cdp._extract_observed(events)[0]["body"] is None

    def test_malformed_post_data_does_not_crash(self):
        events = [
            {
                "method": "Network.requestWillBeSent",
                "params": {
                    "request": {"url": "https://x/y", "headers": {}, "postData": "not json"}
                },
            }
        ]
        assert cdp._extract_observed(events)[0]["body"] is None

    def test_requests_without_url_are_dropped(self):
        events = [{"method": "Network.requestWillBeSent", "params": {"request": {"headers": {}}}}]
        assert cdp._extract_observed(events) == []

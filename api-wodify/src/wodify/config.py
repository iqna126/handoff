"""集中管理可配置项，全部可用环境变量覆盖（见 DESIGN.md §6.9 模块划分）。

场馆 host/location id 不是机密，可以留在代码里当默认值（见 DESIGN.md §6.9
「fixture 要求」的说明）——参考实现 git.luci.ooo/lucio/wodify-cli 也是这么处理的。
"""

from __future__ import annotations

import os

WODIFY_HOST = os.environ.get("WODIFY_HOST", "claycrossfit.wodify.com")
WODIFY_LOCATION_ID = os.environ.get("WODIFY_LOCATION_ID", "11644")
CDP_URL = os.environ.get("WODIFY_CDP_URL", "http://127.0.0.1:9222")
SESSION_CACHE_PATH = os.environ.get(
    "WODIFY_SESSION_CACHE", os.path.expanduser("~/.cache/wodify-pull/session.json")
)
# Worker 的 /api/wod/ingest 完整地址，例如 https://handoff.irisssaq.workers.dev/api/wod/ingest
INGEST_URL = os.environ.get("WODIFY_INGEST_URL", "")
# 这台机器上唯一的密钥，见 DESIGN.md §6.6 密钥架构
WODIFY_SYNC_TOKEN = os.environ.get("WODIFY_SYNC_TOKEN", "")

# 会话真正需要的 cookie 不止 nr1W_Theme_UI 一个——这几个都要在 Cookie 头里带上，
# 参考实现踩过这个坑（这几个名字是真实的 Wodify 场景，见其 config.py）。
SESSION_COOKIE_NAMES = ("nr1W_Theme_UI", "nr2W_Theme_UI", "AuthenticationToken")

"""集中管理可配置项，全部可用环境变量覆盖（见 DESIGN.md §6.9 模块划分）。"""

from __future__ import annotations

import os

WODIFY_HOST = os.environ.get("WODIFY_HOST", "")
SESSION_CACHE_PATH = os.environ.get(
    "WODIFY_SESSION_CACHE", os.path.expanduser("~/.cache/wodify-pull/session.json")
)
# Worker 的 /api/wod/ingest 完整地址，例如 https://handoff.irisssaq.workers.dev/api/wod/ingest
INGEST_URL = os.environ.get("WODIFY_INGEST_URL", "")
# 这台机器上唯一的密钥，见 DESIGN.md §6.6 密钥架构
WODIFY_SYNC_TOKEN = os.environ.get("WODIFY_SYNC_TOKEN", "")

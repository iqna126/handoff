"""FastAPI 应用本身。DESIGN.md §6/§7.4 的路由、JWT 校验、CORS 限制都加在这里。

当前只有 GET /api/health，目的是打通 CI/CD 部署管道（P0 步骤 1）。

不依赖 Cloudflare Workers 运行时，可以用普通 pytest 直接测（见 tests/test_health.py）。
Workers 的入口桥接在 worker.py，那边导入了只在 Workers/Pyodide 沙盒里才存在的
`workers`/`js` 模块，本地环境 import 不了，所以故意分成两个文件。
"""

from fastapi import FastAPI

app = FastAPI()


@app.get("/api/health")
async def health():
    """存活检查，不需要登录。"""
    return {"status": "ok"}

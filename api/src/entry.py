"""Cloudflare Python Worker 入口：FastAPI 应用 + Workers 的 on_fetch 桥接。

当前只有 GET /api/health，目的是打通 CI/CD 部署管道（P0 步骤 1）。
JWT 校验、CORS 限制等见 DESIGN.md §6/§7.4，等真正的业务接口再加（P0 步骤 3/5/6）。

⚠️ on_fetch 这段 ASGI 桥接写法是按 Cloudflare 公开文档写的，还没有实际部署到
Cloudflare 验证过——Python Workers 这块功能还在快速演进，第一次真的部署时如果
签名或导入路径对不上，以 Cloudflare 当时的文档为准，不代表设计有问题。
"""

from fastapi import FastAPI

app = FastAPI()


@app.get("/api/health")
async def health():
    """存活检查，不需要登录。"""
    return {"status": "ok"}


async def on_fetch(request, env):
    """Cloudflare Workers 的入口约定：把请求转给 FastAPI（ASGI）处理。"""
    import asgi

    return await asgi.fetch(app, request, env)

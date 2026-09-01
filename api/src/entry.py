"""FastAPI 应用本身。DESIGN.md §6/§7.4 的路由、JWT 校验、CORS 限制都加在这里。

不依赖 Cloudflare Workers 运行时，可以用普通 pytest 直接测（见 tests/ 下的用例）。
Workers 的入口桥接在 worker.py，那边导入了只在 Workers/Pyodide 沙盒里才存在的
`workers`/`js` 模块，本地环境 import 不了，所以故意分成两个文件。

访问 Workers 的环境变量/密钥一律通过 `get_env` 这个依赖（背后是
`request.scope["env"]`，Cloudflare 的 ASGI 桥接会自动注入），不要在函数里直接摸
`request.scope`——这样测试时可以用 `app.dependency_overrides[get_env]` 换成假的，
不需要真的跑在 Workers 沙盒里。
"""

import hmac
import logging
from datetime import UTC, datetime

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

logger = logging.getLogger("handoff-api")

app = FastAPI()

# 只允许来自我们自己前端的跨域请求，见 DESIGN.md §6.6 安全复查
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://handoff-web.irisssaq.workers.dev"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health():
    """存活检查，不需要登录。"""
    return {"status": "ok"}


def get_env(request: Request):
    """Workers 的环境变量/密钥绑定。真实运行时来自 Cloudflare 的 ASGI 桥接
    （见 worker.py），测试时用 `app.dependency_overrides[get_env]` 换掉。
    """
    return request.scope["env"]


def verify_sync_token(request: Request, env=Depends(get_env)) -> None:
    """校验 wodify-pull 常开机器带的 WODIFY_SYNC_TOKEN。

    恒定时间比较防时序攻击，反复错误记日志——这两条是之前安全复查时定下的，
    见 DESIGN.md §6.6。token 放在 Authorization 头，跟用户 JWT 用同一个头
    但校验逻辑完全独立，这个接口不认 JWT，只认这个 token。
    """
    auth = request.headers.get("authorization", "")
    prefix = "Bearer "
    supplied = auth[len(prefix) :] if auth.startswith(prefix) else ""
    expected = getattr(env, "WODIFY_SYNC_TOKEN", "") or ""
    if not expected or not hmac.compare_digest(supplied, expected):
        logger.warning("rejected /api/wod/ingest: invalid or missing sync token")
        raise HTTPException(status_code=401, detail="invalid sync token")


class WodRow(BaseModel):
    day: str
    class_type: str
    title: str = ""
    sections: list
    raw: dict
    source: str = "wodify_api"
    class_times: list[str] = []


class ErrorReport(BaseModel):
    kind: str
    detail: str


class IngestRequest(BaseModel):
    wods: list[WodRow] | None = None
    error: ErrorReport | None = None


async def send_alert(
    env, subject: str, body: str, *, client: httpx.AsyncClient | None = None
) -> None:
    """统一的告警发送口子，走 Resend。

    SessionExpired 上报、解析结构性错误上报、下面的存活校验都要走这一个函数，
    不要各写一份调 Resend 的代码（DESIGN.md §6.6「批量写入 + 可复用模块」）。
    """
    api_key = getattr(env, "RESEND_API_KEY", "") or ""
    alert_email = getattr(env, "ALERT_EMAIL", "") or ""
    if not api_key or not alert_email:
        logger.error("RESEND_API_KEY/ALERT_EMAIL 没配置，告警发不出去：%s", subject)
        return
    owns_client = client is None
    client = client or httpx.AsyncClient()
    try:
        resp = await client.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "from": "handoff-alerts@resend.dev",
                "to": [alert_email],
                "subject": subject,
                "text": body,
            },
        )
        if resp.status_code >= 400:
            logger.error("Resend 告警发送失败：%s %s", resp.status_code, resp.text)
    finally:
        if owns_client:
            await client.aclose()


async def upsert_wods(env, wods: list[WodRow], *, client: httpx.AsyncClient | None = None) -> int:
    """批量 upsert 到共享的 wods 表，按 day+class_type 冲突时更新。

    一次传一整周，不是一天写一次——见 DESIGN.md §6.6「批量写入」。
    """
    if not wods:
        return 0
    url = f"{env.SUPABASE_URL}/rest/v1/wods?on_conflict=day,class_type"
    payload = [w.model_dump() for w in wods]
    owns_client = client is None
    client = client or httpx.AsyncClient()
    try:
        resp = await client.post(
            url,
            headers={
                "apikey": env.SUPABASE_SERVICE_KEY,
                "Authorization": f"Bearer {env.SUPABASE_SERVICE_KEY}",
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates,return=minimal",
            },
            json=payload,
        )
        resp.raise_for_status()
    finally:
        if owns_client:
            await client.aclose()
    return len(wods)


async def get_http_client():
    """出站 HTTP 客户端，真实运行时是普通 httpx.AsyncClient。

    测试时用 `app.dependency_overrides[get_http_client]` 换成套了
    `httpx.MockTransport` 的客户端，跟 `get_env` 一样的思路——不要在测试里
    真的打到 Supabase/Resend。
    """
    async with httpx.AsyncClient() as client:
        yield client


@app.post("/api/wod/ingest", dependencies=[Depends(verify_sync_token)])
async def wod_ingest(body: IngestRequest, env=Depends(get_env), http=Depends(get_http_client)):
    """wodify-pull 常开机器专用：批量写入一整周的 WOD，或上报故障。

    不是给前端用的接口——靠 WODIFY_SYNC_TOKEN 校验，不认用户 JWT。
    """
    written = 0
    if body.wods:
        written = await upsert_wods(env, body.wods, client=http)
    if body.error:
        await send_alert(
            env, f"wodify-pull 故障：{body.error.kind}", body.error.detail, client=http
        )
    return {"written": written}


async def check_wods_freshness(env, *, client: httpx.AsyncClient | None = None) -> None:
    """独立存活校验：今天的 wods 数据缺失就告警。

    不依赖常开机器自己每日校验——机器整体宕机时没法自我报告，见 DESIGN.md §6.6
    「独立存活校验」。这个函数被 Worker 的 Cron Trigger 调用（见 worker.py），
    不依赖常开机器是否还活着。
    """
    today = datetime.now(UTC).date().isoformat()
    url = f"{env.SUPABASE_URL}/rest/v1/wods?day=eq.{today}&select=id"
    owns_client = client is None
    http = client or httpx.AsyncClient()
    try:
        resp = await http.get(
            url,
            headers={
                "apikey": env.SUPABASE_SERVICE_KEY,
                "Authorization": f"Bearer {env.SUPABASE_SERVICE_KEY}",
            },
        )
        resp.raise_for_status()
        rows = resp.json()
        if not rows:
            # 复用同一个 client，不要让 send_alert 自己另开一个——
            # 之前漏传这个参数，导致测试用假 client 查完数据之后，
            # 告警那一步却用了真的 httpx.AsyncClient() 打到了真实的 Resend
            await send_alert(
                env,
                "wodify-pull 存活校验：今天没有 WOD 数据",
                f"{today} 的 wods 表是空的。可能是常开机器整体失联，也可能是场馆当天"
                "确实没有排课——不确定就都发一封，让人来判断，不在这里猜原因。",
                client=http,
            )
    finally:
        if owns_client:
            await http.aclose()

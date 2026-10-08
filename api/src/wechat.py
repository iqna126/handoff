"""微信小程序登录桥接的核心逻辑：code 换 openid、查/建账号、签发 Supabase
会话。不含路由定义——路由在 entry.py（跟其它接口一致的组织方式），这里
只是纯函数，方便独立测试。完整设计见 DESIGN.md §7.2/§7.3（docs 分支）。

当前只实现"查不到 openid 记录就直接当新用户建号"这一条路径。"查到的话
是不是网页版老用户、要不要走邮箱验证关联到已有账号"（§7.2.1 的另一个
分支）还没做，是后续工作。
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import httpx

if TYPE_CHECKING:
    from entry import Env


class WechatApiError(RuntimeError):
    """微信接口本身返回了错误（errcode != 0），比如 code 过期、用错了 AppID。"""


def _service_headers(env: Env) -> dict[str, str]:
    return {
        "apikey": env.SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {env.SUPABASE_SERVICE_KEY}",
    }


def placeholder_email(openid: str) -> str:
    """纯微信账号没有真实邮箱。这个地址从来不会真的收信——只是用来满足
    Supabase 建号 API 必须有 email 这个要求，见 mint_session 的说明。
    """
    return f"wx-{openid}@wechat.handoff.invalid"


async def exchange_code_for_openid(env: Env, code: str, *, client: httpx.AsyncClient) -> str:
    """小程序 wx.login() 拿到的 code 换成 openid——微信自己的接口，
    AppSecret 只在这一步用，不传给小程序。
    """
    resp = await client.get(
        "https://api.weixin.qq.com/sns/jscode2session",
        params={
            "appid": env.WECHAT_APP_ID,
            "secret": env.WECHAT_APP_SECRET,
            "js_code": code,
            "grant_type": "authorization_code",
        },
    )
    resp.raise_for_status()
    data = resp.json()
    if data.get("errcode"):
        raise WechatApiError(f"{data['errcode']}: {data.get('errmsg', '未知错误')}")
    return data["openid"]


async def find_user_id_by_openid(env: Env, openid: str, *, client: httpx.AsyncClient) -> str | None:
    """查 wechat_identities，这个 openid 之前有没有关联过账号。"""
    resp = await client.get(
        f"{env.SUPABASE_URL}/rest/v1/wechat_identities",
        headers=_service_headers(env),
        params={"openid": f"eq.{openid}", "source": "eq.miniprogram", "select": "user_id"},
    )
    resp.raise_for_status()
    rows = resp.json()
    return rows[0]["user_id"] if rows else None


async def create_wechat_user(env: Env, openid: str, *, client: httpx.AsyncClient) -> str:
    """建一个新 Supabase 用户 + 写入 wechat_identities 关联，返回 user_id。

    纯微信新用户专用——`profiles` 行由 `db/001_init.sql` 的
    `on_auth_user_created` 触发器自动建好，这里不用管。

    已知的窄缝：建用户成功、写 wechat_identities 失败（比如网络中断）的话，
    下次同一个 openid 重试，建用户这一步会因为占位邮箱已经存在而报错，
    不会自动恢复——目前没处理，真出现了再加（先不确定 Supabase 这个失败
    返回的具体错误码，不想猜错了吞掉别的真实错误）。
    """
    resp = await client.post(
        f"{env.SUPABASE_URL}/auth/v1/admin/users",
        headers=_service_headers(env),
        json={
            "email": placeholder_email(openid),
            "email_confirm": True,
            "user_metadata": {"wechat_openid": openid},
        },
    )
    resp.raise_for_status()
    user_id = resp.json()["id"]

    link_resp = await client.post(
        f"{env.SUPABASE_URL}/rest/v1/wechat_identities?on_conflict=openid,source",
        headers={
            **_service_headers(env),
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
        json={"openid": openid, "user_id": user_id, "source": "miniprogram"},
    )
    link_resp.raise_for_status()
    return user_id


async def get_user_email(env: Env, user_id: str, *, client: httpx.AsyncClient) -> str:
    """已关联过的 openid 对应的 user_id，可能是纯微信占位邮箱，也可能是
    网页版老用户的真实邮箱（§7.3.1 关联之后）——mint_session 不关心是哪种，
    只要是这个 user_id 当前登记的邮箱就行。
    """
    resp = await client.get(
        f"{env.SUPABASE_URL}/auth/v1/admin/users/{user_id}",
        headers=_service_headers(env),
    )
    resp.raise_for_status()
    return resp.json()["email"]


async def mint_session(env: Env, email: str, *, client: httpx.AsyncClient) -> dict[str, str]:
    """给一个已存在的 Supabase 用户签发真实会话，不经过用户手动点邮件链接。

    Supabase 的 admin API 没有"直接给某个 user 发一个会话"这个接口——这是
    官方认可的绕过办法：先用 admin/generate_link 生成一个 magiclink（只拿
    hashed_token，不真的发邮件），再自己拿这个 token 去打 /verify 兑换成
    真的 access_token/refresh_token，相当于自己把这封从没寄出的邮件点开了。
    """
    link_resp = await client.post(
        f"{env.SUPABASE_URL}/auth/v1/admin/generate_link",
        headers=_service_headers(env),
        json={"type": "magiclink", "email": email},
    )
    link_resp.raise_for_status()
    hashed_token = link_resp.json()["hashed_token"]

    verify_resp = await client.post(
        f"{env.SUPABASE_URL}/auth/v1/verify",
        headers=_service_headers(env),
        json={"type": "magiclink", "token_hash": hashed_token},
    )
    verify_resp.raise_for_status()
    body = verify_resp.json()
    return {"access_token": body["access_token"], "refresh_token": body["refresh_token"]}

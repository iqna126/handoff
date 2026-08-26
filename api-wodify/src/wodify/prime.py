"""prime：从一个已登录的 Chrome 里抓取会话凭证与请求体模板。

⚠️ 这个模块**无法离线验证**。它需要一个真实的、已登录 Wodify 的 Chrome
实例，通过 CDP（Chrome DevTools Protocol）附着上去。首次运行必须人工核对。

为什么必须用浏览器 —— 三样东西没有别的办法拿到：

======================  ==================================================
nr1W_Theme_UI cookie    HttpOnly（184 字符）。document.cookie 读不到，
                        所以「手动粘 cookie」这条路是**不可行**，
                        不是仅仅麻烦。只能从 CDP 的 Network 域拿。
X-CSRFToken             不在 cookie、localStorage 或任何 JS 全局变量里。
                        只出现在发出去的请求头上，必须嗅探。
apiVersion              **每个动作一个值**，不是全局的。
                        每个端点都要从一次真实调用里观察。
======================  ==================================================

还有一个关键坑：**WOD 内容动作在直接打开 workout 页时不会触发。**
那个页面会显示「No workout posted」，一个请求都不发 —— 所以「直接加载并
枚举请求」会「证明」这个接口不存在。它只在从班级详情点进去时才触发。
WORKOUT_WALK_JS 就是为了复现这条路径。

而且 OutSystems 会缓存数据动作，重访同一天不发请求。
所以必须走一个**还没被缓存过的、且确实发布了 WOD 的日期**。
"""

from __future__ import annotations

import json
import urllib.request
from typing import Any

from . import actions

# 复现「排程 → 选日期 → 进班级 → 点去看 workout」这条导航，
# 顺带也会捕获班级详情的动作。
# 注意：直接跳转 /WodifyClient/Exercise 是没用的（见模块说明）。
WORKOUT_WALK_JS = r"""
(async (targetDate) => {
  const log = [];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const q = sel => document.querySelector(sel);
  const qa = sel => [...document.querySelectorAll(sel)];
  const clickText = (txt) => {
    const el = qa('a,button,div[role=button]').find(
      e => (e.textContent || '').trim().toLowerCase().includes(txt.toLowerCase()));
    if (el) { el.click(); return true; }
    return false;
  };

  location.hash = '';
  if (!location.pathname.includes('/Schedule')) {
    location.href = '/WodifyClient/Schedule';
    await sleep(3000);
  }
  log.push('schedule=' + !!q('[class*=Schedule], [class*=schedule]'));

  // 选日期。日期控件的实现随版本变化，这里尽量宽松地找
  const dateInput = q('input[type=date]') ||
                    qa('input').find(i => /\d{4}-\d{2}-\d{2}/.test(i.value || ''));
  if (dateInput) {
    dateInput.value = targetDate;
    dateInput.dispatchEvent(new Event('input', { bubbles: true }));
    dateInput.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(2500);
    log.push('date=true');
  } else {
    log.push('date=false');
  }

  // 进第一个班级
  const rows = qa('[class*=ClassCard], [class*=class-row], tr').filter(
    e => /\d{1,2}:\d{2}/.test(e.textContent || ''));
  log.push('classes=' + rows.length);
  if (!rows.length) return { ok: false, log };
  rows[0].click();
  await sleep(2500);
  log.push('class=true');

  // 点「Go to workout」
  const ok = clickText('go to workout') || clickText('workout');
  log.push('hasGoToWorkout=' + ok);
  if (!ok) return { ok: false, log };
  await sleep(3000);
  log.push('goto=true');

  return { ok: true, log };
})(TARGET_DATE);
"""


class PrimeError(Exception):
    pass


def _cdp_targets(cdp_url: str) -> list[dict]:
    with urllib.request.urlopen(f"{cdp_url}/json/list", timeout=10) as r:
        return json.loads(r.read())


def observe_to_session(
    observed: list[dict],
    *,
    host: str,
) -> dict:
    """把嗅探到的请求列表整理成 session 缓存。

    这一步是纯函数，可以离线测试 —— 网络部分在 capture() 里。

    observed 里每一项形如：
      {"url": ..., "headers": {...}, "body": {...}}

    只保留白名单里登记过的动作。**路径必须精确匹配**：
    2026-08 那次改版给所有动作加了 WodifyClient_DataFetch_WB/ 前缀，
    症状是「缓存的旧 apiVersion 还能用，所以除了从没抓过的动作之外一切照常，
    而 re-prime 又抓不到任何新东西」—— 因为匹配不上。
    所以匹配失败时必须**明确报出来**，不能静默跳过。
    """
    want = {name: path for name, path in actions.ACTIONS.items()}
    got: dict[str, dict] = {}
    unmatched: list[str] = []

    for item in observed:
        url = item.get("url", "")
        marker = "/screenservices/"
        if marker not in url:
            continue
        path = url.split(marker, 1)[1]
        hit = None
        for name, want_path in want.items():
            if path == want_path:
                hit = name
                break
        if hit is None:
            unmatched.append(path)
            continue
        actions.assert_read_only(path)
        got[hit] = {"path": path, "body": item.get("body")}

    cookie = ""
    csrf = ""
    for item in observed:
        h = {k.lower(): v for k, v in (item.get("headers") or {}).items()}
        cookie = cookie or h.get("cookie", "")
        csrf = csrf or h.get("x-csrftoken", "")

    missing = sorted(set(want) - set(got))
    return {
        "host": host,
        "cookie": cookie,
        "csrf": csrf,
        "actions": got,
        "captured": sorted(got),
        "missing": missing,
        # 没匹配上的路径要留着 —— 改版诊断全靠它
        "unmatched_paths": sorted(set(unmatched)),
    }


def report(session: dict) -> str:
    """人可读的 prime 结果。missing 不为空时必须让人看见。"""
    lines = [
        f"host      {session.get('host')}",
        f"cookie    {len(session.get('cookie') or '')} 字符",
        f"csrf      {len(session.get('csrf') or '')} 字符",
        f"captured  {len(session.get('captured') or [])}/"
        f"{len(session.get('captured') or []) + len(session.get('missing') or [])}"
        f"  {session.get('captured')}",
    ]
    if session.get("missing"):
        lines.append(f"MISSING   {session['missing']}  ← 这些动作没抓到，查询会失败")
    if session.get("unmatched_paths"):
        lines.append(
            "未匹配的路径（改版时对照这里找动作的新位置）："
        )
        for p in session["unmatched_paths"][:20]:
            lines.append("  " + p)
    return "\n".join(lines)

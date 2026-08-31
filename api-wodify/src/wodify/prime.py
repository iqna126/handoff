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

**导航/点击逻辑照抄参考实现**（`git.luci.ooo/lucio/wodify-cli`，同一个场馆，同一个
Wodify SPA 版本，见 DESIGN.md §6.6）：第一版自己猜的 CSS 选择器
（`input[type=date]`、`[class*=ClassCard]`、`location.href` 直接跳转）在真机测试时
全部落空——Wodify 的日期选择器是按 aria-label 点的自定义控件，不是原生 `<input
type=date>`；班级行是按文本内容的正则匹配的，不是靠 class 名；导航要先走
`WALK`（Home→Scheduler）触发 schedule 动作，再在已加载的页面里点导航文字，
不能对着还没渲染的页面直接改 `location.href`。

**当前实现状态**：本文件只有离线可测的纯函数部分（`observe_to_session`/`report`/
`_date_label`）。真正驱动 CDP、附着到 Chrome、跑 `WORKOUT_WALK_JS` 并收集网络请求的
部分在 `cdp.py`，首次真机验证过之前不代表这版选择器/时序一定对——Wodify 的页面
结构随时可能再变。
"""

from __future__ import annotations

import datetime
import json
import os
import urllib.request

from . import actions

#: 先走这两个静态页面触发 schedule 等动作，Home 是可靠的入口且会顺带填充
#: 客户端变量。（path, 等待秒数）
WALK = (
    ("/WodifyClient/Home", 12),
    ("/WodifyClient/Scheduler", 10),
)

# 复现「排程 → 选日期 → 进班级 → 点去看 workout」这条导航，顺带也会捕获班级详情的
# 动作。这一步假设已经走完上面的 WALK、页面已经在 Scheduler 上——不对着空白页面
# 改 location.href（第一版这么做过，行不通：脚本执行时页面可能还没渲染完）。
#
# 点击靠**匹配渲染出来的文字**，不靠 CSS class（Wodify 改版时 class 名比文字更容易
# 变）：叶子节点（没有子元素）精确匹配文字才点，避免点中父容器。
WORKOUT_WALK_JS = r"""
(async () => {
  const log = [];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const clickText = (txt) => {
    const els = [...document.querySelectorAll('*')].filter(
      e => e.childElementCount === 0 && e.textContent.trim() === txt);
    if (!els.length) return false;
    els[els.length - 1].click();
    return true;
  };
  const clickAria = frag => {
    const el = [...document.querySelectorAll('[aria-label]')]
      .find(e => (e.getAttribute('aria-label') || '').includes(frag));
    if (!el) return false;
    el.click();
    return true;
  };

  log.push('schedule=' + clickText('Schedule'));
  await sleep(3500);
  if (__DATE_LABEL__) { log.push('date=' + clickAria(__DATE_LABEL__)); await sleep(3500); }

  const classPattern = /^[A-Za-z][^,]*:\s*\d{1,2}:\d{2}/;
  const classes = [...document.querySelectorAll('*')]
    .filter(e => e.childElementCount === 0 && classPattern.test(e.textContent.trim()))
    .map(e => e.textContent.trim())
    .filter((v, i, a) => a.indexOf(v) === i);
  log.push('classes=' + classes.length);
  if (!classes.length) return { ok: false, log, why: 'no classes on that date' };

  log.push('class=' + clickText(classes[0]));
  await sleep(4000);
  const hasLink = document.body.innerText.includes('Go to workout');
  log.push('hasGoToWorkout=' + hasLink);
  if (!hasLink) return { ok: false, log, why: 'no workout posted for that class' };

  log.push('goto=' + clickText('Go to workout'));
  await sleep(5000);
  return { ok: document.body.innerText.includes('WARM-UP'), log };
})();
"""


def date_label(date_str: str) -> str:
    """把 YYYY-MM-DD 转成 Wodify 日期按钮 aria-label 里用的片段，比如 "August 31"。

    Wodify 的日期标签形如 "Monday, August 31, 2026"，匹配 "August 31" 这个子串就够。
    """
    parsed = datetime.date.fromisoformat(date_str)
    return parsed.strftime("%B ") + str(parsed.day)


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

    这一步是纯函数，可以离线测试 —— 真正跑 CDP 抓包的部分还没实现（见模块顶部说明）。

    observed 里每一项形如：
      {"url": ..., "headers": {...}, "body": {...}}

    只保留白名单里登记过的动作。**路径必须精确匹配**：
    2026-08 那次改版给所有动作加了 WodifyClient_DataFetch_WB/ 前缀，
    症状是「缓存的旧 apiVersion 还能用，所以除了从没抓过的动作之外一切照常，
    而 re-prime 又抓不到任何新东西」—— 因为匹配不上。
    所以匹配失败时必须**明确报出来**，不能静默跳过。
    """
    want = dict(actions.ACTIONS)
    got: dict[str, dict] = {}
    unmatched: list[str] = []
    # 只从真正匹配上白名单的请求里取 cookie/csrf——不相关的请求（埋点、
    # 未登记的 action）混进来的话，会静默把凭证换成错的，之后每次查询都 401
    cookie = ""
    csrf = ""

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
        lines.append("未匹配的路径（改版时对照这里找动作的新位置）：")
        for p in session["unmatched_paths"][:20]:
            lines.append("  " + p)
    return "\n".join(lines)


def save_session(session: dict, path: str) -> None:
    """存到本地文件。里面是活的凭证（cookie/csrf），权限收紧到只有自己能读。"""
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w") as f:
        json.dump(session, f)
    os.chmod(path, 0o600)


def load_session(path: str) -> dict:
    """读本地缓存的 session。没有就抛 FileNotFoundError——调用方决定怎么提示用户去 prime。"""
    with open(path) as f:
        return json.load(f)

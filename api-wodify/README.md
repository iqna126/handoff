# wodify-pull

从 Wodify athlete app 只读拉取 WOD 内容，写入本项目的 `wods` 表。

**这是自己实现的版本**，不是任何现有仓库的复制或衍生。协议层面的事实
（端点路径、请求体契约、字段名）来自公开的技术文档；实现全部原创。

参考资料：`git.luci.ooo/lucio/wodify-cli` 的 README 与 CLAUDE.md
（同一场馆的另一个只读客户端，独立实现）。

---

## 现状

| 模块 | 状态 |
|---|---|
| `actions.py` 白名单 + 写操作守卫 | ✅ 12 个测试通过 |
| `client.py` 请求体补丁 + 过期检测 | ✅ 20 个测试通过 |
| `parse.py` Wodify JSON → sections | ✅ 12 个测试通过 |
| `prime.py` 纯函数部分 | ✅ 7 个测试通过 |
| `prime.py` CDP 抓取 | ⚠️ **未验证** —— 需要真实的已登录 Chrome |
| `sync.py` 写入 Supabase | ⬜ 未实现 |

```bash
python -m pytest -q     # 48 passed，不需要网络
```

## 为什么分成 prime 和 query 两个阶段

| 阶段 | 频率 | 需要浏览器 |
|---|---|---|
| **prime** | 少见：装一次，之后只在 Wodify 改版时重跑 | 是（CDP） |
| **query** | 每次提问一次 HTTP POST | 否（纯标准库） |

三样东西只能从浏览器抓：

- `nr1W_Theme_UI` cookie 是 **HttpOnly**，`document.cookie` 读不到，
  所以「手动粘 cookie」**不可行**，不是仅仅麻烦
- `X-CSRFToken` 只出现在发出去的请求头上
- `apiVersion` **每个动作一个值**

## 三个必须知道的坑

**1. 请求体多一个键就 400。**
屏幕数据动作用 `screenData.variables`，不是 `inputParameters`。
所以 prime 存整个请求体，`set_field` 只改已存在的叶子，从不新增键。

**2. `SelectedDate` 在多个平级对象里同时出现。**
只改第一处不报错，但会**静默查错日期**。`set_field` 改所有出现位置，
`require_field` 在一处都没改到时抛异常。

**3. `SelectedDate` 必须是裸的 `YYYY-MM-DD`。**
带时间的形式一律 400。浏览器 localStorage 里存的是带时区的形式，别照抄。

## 只读约束

Wodify 不签发只读令牌，用的是完整会话登录，凭证层面拦不住写操作。
所以两道闸都在代码里，且都有测试盯着：

1. `ACTIONS` 白名单 —— 没登记的调不了
2. `assert_read_only` —— 路径含写标记一律拒绝，**连白名单里的也照拒**

`tests/test_actions.py` 会拿真实的写端点去撞，确认全部被拒。
新增动作必须同时加测试。

## 隐私

**只拉 workout，不拉 attendees。** 班级详情接口会返回其他会员的真实姓名，
把它写进多人共享的数据库，性质就从「我自己看」变成「我在分发他人个人信息」。

测试 fixture 里的名字全部虚构，不得引入真实会员姓名。

## 待办

- [ ] `sync.py`：拉取一整周 → 批量 POST 给 Worker 的 `/api/wod/ingest`（带
      `WODIFY_SYNC_TOKEN`），**不直连 Supabase**，机器上不持有任何 Supabase 密钥
- [ ] `cli.py`：`prime` / `workout --date` / `week` / `doctor`
- [ ] 首次真机 prime，核对 `report()` 的 captured / missing
- [ ] cron：周一 03:00 抓整周，一次批量写入（不是拉一天写一天）；每日校验已经挪到
      Cloudflare Worker 的 Cron Trigger 上，机器上不需要再跑这个
- [ ] 出错（`SessionExpiredError` / 解析结构性错误）也用 `WODIFY_SYNC_TOKEN` 调
      `/api/wod/ingest` 上报，由 Worker 转发 Resend 发邮件

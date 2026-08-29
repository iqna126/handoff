# CLAUDE.md

给在这个仓库里工作的 Claude Code 用的指导。完整的架构设计和产品行为规格在 `docs`
分支（`DESIGN.md`/`SPEC.md`/`HANDOFF.md`），不在 main 上——开工前先看那边：

```bash
git checkout docs
```

## 这是什么

训练与日程记录应用重构：Cloudflare Pages（前端）+ Cloudflare Python Worker（后端）+
Supabase（数据/登录），配合 `api-wodify/` 从 Wodify 只读拉取课表内容，替代原来的
单文件 HTML 版本。

## 交付代码前必须做的两件事

**这两项都是每次 push 前的规定动作，不是走形式，不能因为赶时间跳过。**

### 1. 密钥/敏感信息不能泄露 —— 比功能对不对更优先

这个项目发生过一次真实的险情：`web/wrangler.jsonc`（构建配置，虽然这次内容本身
不含密钥）被 Cloudflare 当成静态资源原样上传，任何人访问
`https://handoff-web.irisssaq.workers.dev/wrangler.jsonc` 都能直接看到——事后才
发现，不是提前查出来的。**"目录里的文件会被原样打包/公开"这个假设必须每次主动
验证，不能想当然**。真出现密钥泄露（不是这次这种配置文件，而是 service_role
key、JWT secret、Gemini/Resend key 这类）后果是致命的：能改全部用户数据，或者
别人拿你的账号刷钱。

每次 `git add` 之后、`push` 之前，从下面几个角度分别检查一遍，任何一条不确定
都要停下来确认，不能凭感觉判断"应该没事"：

- **进 git 的文件**：`git status`/`git diff` 里的每个文件都过一遍，尤其是新增的
  文件——看内容像不像密钥（长随机字符串、`SECRET`/`KEY`/`TOKEN`/`PASSWORD` 这类
  命名），`.env`/`.env.*`/`.dev.vars` 类文件绝对不能进去（`.gitignore` 挡了大部分，
  但不能只信 `.gitignore`，要肉眼确认一遍）
- **会被公开部署的文件**：任何进 `web/` 目录、或者会被 Cloudflare/任何静态部署
  流程打包上传的文件，都要假设"这个文件里的所有内容都会被任何人看到"。只有
  Supabase URL/anon key 这两个设计上就是公开的值可以出现在这里；
  `SUPABASE_SERVICE_KEY`/`SUPABASE_JWT_SECRET`/`GEMINI_API_KEY`/
  `WODIFY_SYNC_TOKEN`/`RESEND_API_KEY` 这些**一律不能出现在 `web/` 下任何文件里**，
  只能存在于 Worker（`api/`）的环境变量/secret 里
- **部署后要实际抽查，不能只看 build 日志说成功**：像这次用 `curl` 确认
  `/api/health` 和首页真的返回预期内容一样，公开可访问的文件范围也要抽查一下
  实际上传了什么（`wrangler.jsonc` 被当成静态资源传上去就是这么发现的）
- **日志/打印/异常信息里不能出现密钥或凭证**：`api-wodify/prime.py` 的
  `report()` 已经专门有测试断言"输出里不能出现 cookie/csrf"（见
  `tests/test_prime.py::test_credentials_not_printed`），这个习惯要在所有新代码
  里延续——任何 `print`/日志/异常消息，凡是可能带上 token、cookie、完整请求头、
  完整 env 对象的，都要显式过滤掉敏感字段，不能图省事整个对象原样打出来

### 2. CI 必须先在本地跑绿再 push

```bash
cd api-wodify   # 或 api/，看改了哪边
pip install -e ".[dev]"
ruff check .
ruff format --check .
python -m pytest -q
```

跑不过就先修，不要 push 完再补救。

这条规则不是走个形式——**现在没有走 PR 流程**（为了快速推进 P0，暂时的，后面可能
恢复），CI 绿是 main 上代码质量唯一的把关手段。`web/` 目前没有自动化检查（纯静态
文件，没有构建步骤），改完之后按上面第 1 条手动抽查。

## 分支

- `main`：只放实际代码，直接 push（owner 身份，分支保护里 `enforce_admins` 关着，
  push 会被记录成 bypass，这是预期行为）
- `docs`：`main` 的超集，额外带着设计文档和参考资料，永远不合并回 main

## 密钥清单

需要哪些密钥、放在哪，见 `docs` 分支 `DESIGN.md` §8 和 `HANDOFF.md`「环境变量」。

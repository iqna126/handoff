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

## 改 `api-wodify/parse.py`（或任何"把外部结构化数据转成我们自己的结构"的代码）前，吸取过的教训

2026-09-27/28 这两天连续在同一个地方踩坑三次，才挖到真正的根因，记录下来避免
再犯：

1. **外部系统自己打的结构化标记，永远比我们自己写的关键词/正则猜测更可信，
   必须优先查。** `parse.py` 的 `_classify()` 一开始是标题关键词正则
   （`_METCON_SCORE`/`_LIFT_WORDS`）排在 Wodify 自己的 `IsWeightlifting`/
   `IsMetcon`/`IsGymnastics`/`IsWarmup` 标记前面——一个 Wodify 自己标了
   `IsMetcon=true` 的组件，就因为标题里带了"Barbell Row"这种关键词，被我们的
   正则错误分类成 `strength`。凡是外部数据自己带了权威的类型/分类字段，都要
   先查这个，标题关键词正则只能是"外部数据没给任何信号时"的兜底猜测，不能
   反过来。
2. **"同一个类型标记是否发生变化"不能作为唯一的分段/分组依据**——同一个类型
   标记完全可能覆盖好几个语义上不同的子块（这次是同一个 WOD 里"主体内容"和
   "Accessory Finisher"/"PRVN Reset"这类收尾模块，Wodify 都打了同一个
   `IsMetcon`）。这类场景要另外找一个更强的独立信号（这里是标题本身的结构化
   词——热身/收操/辅助），跟类型标记结合起来判断，不能只看类型标记有没有变。
3. **发现"渲染出来不对"，先往上游查是不是分类/解析错了，不要在展示层加特例
   把症状糊过去。** 这次第一次修复只在前端加了个"这种复合段落退回自由文本"
   的判断，没有先查这个段落一开始为什么被分类成 `strength`——后来才发现
   Wodify 自己明明标的是 `IsMetcon`，分类这一步就错了，前端那个特例只是在
   掩盖一个更上游的真实 bug，而且这个上游 bug 会影响任何一个被错误分类的
   WOD（不只是眼前这一条）。改的时候先问"这个数据本来应该长什么样、是哪一步
   开始跟预期不一样了"，不要一发现症状就在离症状最近的那一层打补丁。
4. **改完解析逻辑，只跑现有测试不够，要用当天真实拉到的数据核实。** 现有
   测试 fixture 都是照抄过去踩过的坑写的，新出现的数据形状（比如这次"同一个
   类型标记覆盖好几个语义不同的子块"）测试完全覆盖不到。改 `_classify`/
   `_attach_levels` 这类解析核心逻辑时，除了写回归测试，一定要拿 `wodify.cli`
   （或者直接调 `Client.query`）查一天真实数据，核对解析结果，不能只看测试
   绿了就上线。
5. **解析逻辑改完，已经写进 `wods` 表的历史数据不会自动更新**——`raw` 字段
   保留了原始响应，但 `sections` 是解析时算好存进去的快照。改完解析代码、
   确认真机验证过之后，要重新跑一遍历史周的 `wodify.cli week --start <date>`
   （对着 Oracle 机器上装的最新代码跑），把 `on_conflict=day,class_type` 的
   upsert 重新触发一遍，才能让线上已有的数据跟着新逻辑更新，不然代码修好了、
   数据库里存的还是错的。
6. **"用户说看不到某个数据"≠"Wodify 没发这个数据"，先拉原始 HTML 核实，
   不要先假设是上游没给。**（2026-10-05/06）用户反馈"这节 CrossFit 明明
   该有 RX/Level 2/Level 1，这次又没有"——直接查 `WorkoutComponents` 原始
   数据，`[Xxx: Levels]` 组件其实是有的，是 `_attach_levels`/`_LEVEL_HEAD`
   没认出来：Wodify 的档位块至少有三种 HTML 形状——
   (a) `<p>Level 2: 内容</p>`（名字和内容同一行，冒号加内容）；
   (b) `<p>Level 2:</p><p>内容</p>`（名字单独一段但带冒号）；
   (c) `<p><strong>Level 2</strong></p><p>内容</p>`（**名字单独一段，完全
   没有冒号**，2026-10 真机数据新出现的格式）。
   `_LEVEL_HEAD` 原来要求冒号必须存在，格式 (c) 一行都匹配不上，
   `_attach_levels` 静默产出空列表，用户端看不到任何分级选项，不报错。
   已把冒号改成可选（`:?`）修掉这次。**以后再遇到"某个字段/某个 WOD 看起来
   缺内容"的反馈，第一步永远是直接查 `Client.query` 的原始响应（或者
   `cli.py` 加一行调试打印），确认 Wodify 到底发没发这个数据，再决定是不是
   真的解析漏了——不要凭经验先入为主地假设"这次上游真的没发"。**

## 分支

- `main`：只放实际代码，直接 push（owner 身份，分支保护里 `enforce_admins` 关着，
  push 会被记录成 bypass，这是预期行为）
- `docs`：`main` 的超集，额外带着设计文档和参考资料，永远不合并回 main

## 密钥清单

需要哪些密钥、放在哪，见 `docs` 分支 `DESIGN.md` §8 和 `HANDOFF.md`「环境变量」。

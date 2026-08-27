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

## Push 前必须做的事

**push 到 main 之前，先在本地把 CI 跑的检查项实际跑一遍，确认全绿再 push**：

```bash
cd api-wodify
pip install -e ".[dev]"
ruff check .
ruff format --check .
python -m pytest -q
```

跑不过就先修，不要 push 完再补救，不要跳过这一步图快。

这条规则不是走个形式——**现在没有走 PR 流程**（为了快速推进 P0，暂时的，后面可能
恢复），CI 绿是 main 上代码质量唯一的把关手段。`web/`、`api/` 建起来之后，这里要
补上对应的检查命令。

## 分支

- `main`：只放实际代码，直接 push（owner 身份，分支保护里 `enforce_admins` 关着，
  push 会被记录成 bypass，这是预期行为）
- `docs`：`main` 的超集，额外带着设计文档和参考资料，永远不合并回 main

## 密钥

不要把任何真实密钥写进这个仓库的任何文件。需要哪些密钥、放在哪，见 `docs` 分支
`DESIGN.md` §8 和 `HANDOFF.md`「环境变量」。

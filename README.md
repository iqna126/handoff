# handoff

训练与日程记录应用：Cloudflare Pages（前端）+ Cloudflare Python Worker（后端）+ Supabase（数据/登录），配合 `api-wodify/` 从 Wodify 只读拉取课表内容。

设计文档（架构、数据模型、产品行为规格）在 `docs` 分支，不合并进 `main`——`main` 只放实际代码。查看设计：

```bash
git checkout docs
```

## 目录

- `api-wodify/` — 只读拉取 Wodify WOD 内容的 CLI（部署在常开机器上，见 `docs` 分支的 `ops/cron-box-setup.md`）

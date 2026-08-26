# 交接说明

> 给接手实现的人（或 Claude Code）看的。本文件只说明目录里这些参考文件怎么用。
>
> **动手前先读这两份：**
> - **`DESIGN.md`** —— 架构、数据模型、接口、权限。**为什么**这么设计。
> - **`SPEC.md`** —— 产品行为逐条规格。应用**做什么**。重构必须保持这些行为。
>
> 三层分工：`DESIGN.md`（为什么）· `SPEC.md`（做什么）· 代码与测试（怎么做）。
> 新增决策时同步更新对应文档，不要只留在聊天记录里。

---

## 这个仓库要做什么

把一个 6 万字符的单文件 HTML 应用，重构成前后端分离的架构：

- 前端：Cloudflare Pages，原生 JS
- 后端：Cloudflare Python Worker（FastAPI）
- 数据 + 登录：Supabase

完整设计见 `DESIGN.md`。**动手前先完整读一遍**，尤其是第 5 节（数据模型）和第 7 节（认证）。

---

## reference/ 里是什么

这些是**参考资料，不是要直接复用的代码**。新仓库不要照搬这些文件。

### `current-app.html`

现在线上跑着的完整应用，单文件。所有功能都在里面，可以直接在浏览器打开体验。

**用途**：确认新版功能没有遗漏；看现有的交互设计和视觉风格（配色变量在 `<style>` 开头的 `:root` 里，可以直接抄进 `web/css/tokens.css`）。

⚠️ **行为以 `SPEC.md` 为准**，这个文件是参照实现。两者不一致时以 SPEC 为准并修正 SPEC。

### `js/muscles.js` · `js/skillmatch.js`

**这两个文件要移植成 Python**，放到 `api/src/wod/` 下：

| 现有 JS | 目标 Python | 做什么 |
|---|---|---|
| `muscles.js` | `muscles.py` | 动作文本 → 肌群 |
| `skillmatch.js` | `matcher.py` | 动作文本 → 技能树条目（用于自动解锁） |

> `js/wodparse.js` **不需要移植了**——训练记录的粘贴+正则拆段落这条路径已经整体删除，
> 主路径改成 wodify-pull 自动拉取（结构化段落自带 `IsSection`，不需要正则推断），拉取
> 失败时的兜底是自由文本训练记录编辑器，不走"选段落"流程。这个文件留作历史参考。

移植时注意几个已经踩过的坑，**这些是花时间调出来的，别丢**：

1. **`matcher.py`**
   - 必须有**排除词守卫**。热身里的 `5 Back Squats (Empty Bar)`、`Scapular Pull-Ups`、`Banded Pull-Aparts` 不算完成了该动作
   - 同一行**长动作名优先**并占位。`Back Rack Reverse Lunges` 只能匹配 `lunge_brl`，不能同时匹配 `lunge_walk`
   - `Suggested Loading @ 38-42% of 1RM Back Squat` 是处方建议，不是做了后蹲

2. **`muscles.py`**
   - 关键词按长度倒序匹配，否则 `squat` 会抢走 `front squat`
   - 中英文都要支持（用户的历史记录里有 `臀推 181kg 4×10` 这种）

### `fixtures/`

> ⚠️ 这三份样本**不再是测试目标**——它们是给已删除的粘贴解析路径（原 DESIGN.md §6.5）
> 准备的回归测试和 AI 少样本示例，那条路径已经整体删掉，现在唯一的测试目标是
> `api-wodify/tests/fixtures/workout_response.json`（wodify-pull 的 JSON 响应 fixture）。
> 这三份保留作历史参考，帮助理解 Wodify 课表的真实格式，不需要在新代码里引用它们。

三份**真实的 Wodify 课表**，覆盖三种课型：

- `crossfit.txt` —— 有力量项 + 带 6 个 scaling 档位的 WOD
- `pump.txt` —— 三个独立力量项，无 scaling
- `burn.txt` —— 只有一个 AMRAP，标题式段落

**直接拿来做 pytest 的 fixture。**期望的解析结果：

```
crossfit.txt → [CrossFit] Mon, Aug 24
  warmup    Warm-up
  strength  Back Squat (6 Sets)
  metcon    Business Time (6 rounds for reps)
            档位: RX / Level 2 / Level 1 / Masters 55+ / Competitor / Hotel Gym / Travel
            Barbell: 95/65lb (43/30kg)
  cooldown  PRVN RESET
  accessory Optional Accessories (Checkmark)

pump.txt → [CrossFit Pump & Burn] Mon, Aug 24
  warmup    Warm-up
  strength  Front Squat (6 x 5)
  strength  Push Press (6 x 3)
  strength  Back Rack Reverse Lunges (3 rounds for weight)
  cooldown  COOL DOWN

burn.txt → [CrossFit Pump & Burn] Sat, Aug 22
  warmup    Warm-Up (Checkmark)
  metcon    Conditioning (AMRAP - Rounds)
            Kettlebell: 53/35lb, 24/16kg
  cooldown  Cool Down (Checkmark)
```

动作识别的期望结果（只扫选中的段落 + 选中的档位）：

```
crossfit RX      → back_squat, ttb_k, thruster
pump 力量段       → front_squat, push_press, lunge_brl
burn WOD         → pullup_k, burpee, run, kb_swing
任意课的热身段     → 空（守卫生效）
```

### `catalog.json`

87 个动作的完整数据：`k`(id) / `n`(英文名) / `code`(元素周期表代号) / `cat`(分类) / `tier` / `req`(前置) / `note`(要点)，以及哪些要进 PR 墙。

放到 `api/src/wod/catalog.json`，**前后端只维护这一份**，前端通过 `GET /api/catalog` 拉取并缓存。

注意：`req`（前置动作）现在**只用于显示"相关动作"，不做解锁门禁**。用户明确要求过——不是每个人都按同一顺序练。

---

## 建议的实施顺序

按 `DESIGN.md` 第 11 节走：**P0 是上线必备，内部 6 步有序**（wodify-pull 主路径排在
步骤 3，比登录/数据上云晚一步、比前端全量搭建早，因为训练记录现在主要靠它而不是粘贴）；
**P1 是上线后再加的新功能，不细排顺序**。P0 步骤 1（仓库骨架）建议这样起步：

1. `git init`，建好目录骨架
2. 写 `db/001_init.sql`（照 DESIGN 第 5 节，注意 `wods` 表现在是 box 共享的，不按用户分），在 Supabase 控制台执行
3. `web/` 放一个能显示"已登录/未登录"的最小页面，部署到 Pages 验证流程通
4. `api/` 放一个 `GET /api/health` 的 FastAPI Worker，部署验证流程通
5. 到这一步 CI/CD 就通了，后面每次改动都能一键上线

**先把部署管道打通再写功能**，否则等功能写完再调部署会很痛苦。

---

## 环境变量

`api/.dev.vars`（本地）和 `wrangler secret put`（线上）需要：

```
SUPABASE_URL=https://axeqqltpmgzgncbqmkqy.supabase.co
SUPABASE_JWT_SECRET=<Supabase 控制台 → Settings → API 里的 JWT Secret>
SUPABASE_SERVICE_KEY=<同页面的 service_role key，绝不进前端>
GEMINI_API_KEY=<Google AI Studio 申请>
WODIFY_SYNC_TOKEN=<自己生成的一长串随机字符串，wodify-pull 常开机器调 /api/wod/ingest 用>
RESEND_API_KEY=<Resend 控制台申请，用于验证码邮件和 wodify-pull 故障告警>
```

常开机器（跑 wodify-pull 的甲骨文云实例，见 `ops/cron-box-setup.md`）只需要
`WODIFY_SYNC_TOKEN` 一个密钥，不持有任何 Supabase 或 Resend 的密钥。

前端只需要（这两个是公开信息，可以进代码）：

```
SUPABASE_URL=https://axeqqltpmgzgncbqmkqy.supabase.co
SUPABASE_ANON_KEY=<anon public key>
```

`.gitignore` 必须包含：`.env`、`.dev.vars`、`node_modules`、`__pycache__`、`.venv`

---

## 已知的坑

后端相关：

- **Python Worker 底层是 Pyodide**，纯 Python 包都能用，需要编译 C 扩展的包要先确认支持情况。我们只用到正则和字典查表，没问题。
- **`/api/wod/ingest` 的 token 校验要用 `hmac.compare_digest`**，不能用 `==`（防时序攻击），且反复错误 token 要记日志/告警。
- **Worker 的 CORS 要限制成只认 Pages 域名**，不要默认放开。

前端相关的坑（移动端弹层、日期控件、定时重绘等）**已完整整理在 `SPEC.md` 第 9 节**，实现前端前务必先读那一节 —— 这些都是实际踩过并修复过的，不看会重犯。

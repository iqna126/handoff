// 我的 tab（SPEC.md §8）：头像/用户名 + 小工具（配重计算/训练计时器）+
// PR 墙 + 技能树 + 退出登录。PR 墙和技能树不再是独立 tab，都是从这里进去
// 的子页面——用户明确要求底部 tab 只放最高频的几个。
import { getSession, signOut } from "../auth.js";
import { showAlert } from "../dialog.js";
import * as calculator from "./tools/calculator.js";
import * as timer from "./tools/timer.js";
import * as pr from "./pr.js";
import * as skills from "./skills.js";
import * as settings from "./settings.js";

const SUB_PAGES = {
  "tools/calc": { title: "配重计算", render: calculator.render },
  "tools/timer": { title: "训练计时器", render: timer.render },
  pr: { title: "PR 墙", render: pr.render },
  skills: { title: "技能树", render: skills.render },
  settings: { title: "设置", render: settings.render },
};

export async function render(container, sub) {
  if (sub && SUB_PAGES[sub]) {
    const page = SUB_PAGES[sub];
    container.innerHTML = `
      <button type="button" class="back-btn">‹ 我的</button>
      <h1 class="display sm" style="margin:0 0 16px">${page.title}</h1>
      <div class="sub-page-body"></div>
    `;
    container.querySelector(".back-btn").addEventListener("click", () => {
      location.hash = "#profile";
    });
    await page.render(container.querySelector(".sub-page-body"));
    return;
  }

  const session = await getSession();
  const email = session?.user?.email || "";
  const initial = email.slice(0, 1).toUpperCase() || "?";

  container.innerHTML = `
    <div class="profile-header">
      <div class="profile-avatar">${initial}</div>
      <div>
        <div class="profile-name">${email || "未登录"}</div>
        <div class="profile-status">已登录</div>
      </div>
    </div>

    <h2>小工具</h2>
    <div class="tools-grid">
      <button type="button" class="tool-card" data-nav="tools/calc">
        <div class="tool-card__icon">%</div>
        <div class="tool-card__title">配重计算</div>
      </button>
      <button type="button" class="tool-card" data-nav="tools/timer">
        <div class="tool-card__icon">⏱</div>
        <div class="tool-card__title">训练计时器</div>
      </button>
    </div>

    <h2>训练</h2>
    <div class="entry-list card" style="padding:4px 12px">
      <button type="button" class="entry-row" data-nav="pr">
        <span>PR 墙</span>
        <span class="entry-row__hint">›</span>
      </button>
      <button type="button" class="entry-row" data-nav="skills">
        <span>技能树</span>
        <span class="entry-row__hint">›</span>
      </button>
    </div>

    <h2>设置</h2>
    <div class="entry-list card" style="padding:4px 12px">
      <button type="button" class="entry-row" data-nav="settings">
        <span>设置</span>
        <span class="entry-row__hint">›</span>
      </button>
    </div>

    <h2>账号</h2>
    <div class="entry-list card" style="padding:4px 12px">
      <button type="button" class="entry-row" data-signout>
        <span>退出登录</span>
      </button>
    </div>
  `;

  container.querySelectorAll("[data-nav]").forEach((btn) => {
    btn.addEventListener("click", () => {
      location.hash = `#profile/${btn.dataset.nav}`;
    });
  });

  container.querySelector("[data-signout]").addEventListener("click", () => {
    signOut().catch((err) => showAlert(err.message));
  });
}

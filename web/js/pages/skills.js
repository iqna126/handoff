// 技能树（SPEC.md §6）：87 个动作，无解锁门禁——任何动作随时可以标记为
// 已解锁，前置动作只做提示不做拦截。心愿单（§6.2）：♥ 加入，点整行才是
// 打开解锁确认，只有点心形本身才移出心愿单——老版 App 这里有过一个明确修复
// 过的 bug（整行点击曾经是"移出心愿单"，导致用户点哪都是取消）。
//
// "从训练记录自动解锁"（§6.3）依赖训练记录里能解析出结构化动作行，训练
// 记录的两条录入路径都还没做，这部分先不接——跟 PR 墙暂缓扫描是同一个原因。
import { listUnlockedSkills, unlockSkill, lockSkill, listWishes, addWish, removeWish } from "../data.js";
import { showConfirm, showAlert } from "../dialog.js";

export async function render(container) {
  const catalog = await fetch("/data/catalog.json").then((r) => r.json());
  let unlocked = new Set((await listUnlockedSkills()).map((s) => s.movement_key));
  let wished = new Set((await listWishes()).map((w) => w.movement_key));
  let query = "";
  let activeCat = "all";

  const byKey = {};
  for (const s of catalog.SKILLS) byKey[s.k] = s;

  container.innerHTML = `
    <div class="skill-progress">
      <div>
        <input type="text" class="skill-search" placeholder="搜索名称或代号…" />
      </div>
      <div class="skill-progress__count">
        <b>${unlocked.size}</b> / ${catalog.SKILLS.length}
        <div class="skill-bar"><span class="skill-bar__fill" style="width:${(unlocked.size / catalog.SKILLS.length) * 100}%"></span></div>
      </div>
    </div>
    <div class="chip-row">
      <button type="button" class="chip chip--active" data-cat="all">全部</button>
      ${catalog.CATS.map((c) => `<button type="button" class="chip" data-cat="${c.key}">${c.name}</button>`).join("")}
    </div>
    <div class="wish-section"></div>
    <div class="skill-body"></div>
  `;

  const searchInput = container.querySelector(".skill-search");
  const chips = container.querySelectorAll("[data-cat]");
  const wishSection = container.querySelector(".wish-section");
  const body = container.querySelector(".skill-body");

  function matches(skill) {
    if (activeCat !== "all" && skill.cat !== activeCat) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    return skill.n.toLowerCase().includes(q) || skill.code.toLowerCase().includes(q);
  }

  function reqLabel(skill) {
    if (!skill.req?.length) return "";
    return "相关：" + skill.req.map((k) => byKey[k]?.code || k).join(" · ");
  }

  function skillRow(skill, { showHeart }) {
    const done = unlocked.has(skill.k);
    const row = document.createElement("button");
    row.type = "button";
    row.className = `skill-row ${done ? "skill-row--done" : ""}`;

    const tile = document.createElement("div");
    tile.className = "skill-tile";
    tile.textContent = skill.code;

    const bodyEl = document.createElement("div");
    bodyEl.className = "skill-row__body";
    bodyEl.innerHTML = `
      <div class="skill-row__name">${skill.n}</div>
      <div class="skill-row__note">${skill.note || ""}</div>
      ${skill.req?.length ? `<div class="entry-row__hint">${reqLabel(skill)}</div>` : ""}
    `;

    row.append(tile, bodyEl);

    if (showHeart && !done) {
      const heart = document.createElement("button");
      heart.type = "button";
      heart.className = `heart-btn ${wished.has(skill.k) ? "heart-btn--on" : ""}`;
      heart.textContent = wished.has(skill.k) ? "♥" : "♡";
      heart.addEventListener("click", async (e) => {
        e.stopPropagation(); // 只有点心形本身才动心愿单，不能连带触发整行的解锁确认
        if (wished.has(skill.k)) {
          await removeWish(skill.k);
          wished.delete(skill.k);
        } else {
          await addWish(skill.k);
          wished.add(skill.k);
        }
        repaint();
      });
      row.appendChild(heart);
    }

    row.addEventListener("click", async () => {
      if (done) {
        if (!(await showConfirm(`取消「${skill.n}」的已解锁状态？`))) return;
        await lockSkill(skill.k);
        unlocked.delete(skill.k);
        repaint();
        return;
      }
      if (!(await showConfirm(`标记「${skill.n}」为已解锁？`))) return;
      await unlockSkill(skill.k);
      unlocked.add(skill.k);
      const wasWished = wished.has(skill.k);
      if (wasWished) {
        await removeWish(skill.k);
        wished.delete(skill.k);
      }
      repaint();
      if (wasWished) await showAlert(`心愿达成 ${skill.n} 🎉`);
    });

    return row;
  }

  // 心愿单入口之前完全没有说明，没解锁过的用户根本不知道 ♡ 是干嘛的——
  // 空的时候也要把这个盒子画出来，用一句话交代清楚怎么用
  function paintWishSection() {
    const items = catalog.SKILLS.filter((s) => wished.has(s.k) && !unlocked.has(s.k));
    wishSection.innerHTML = "";
    const box = document.createElement("div");
    box.className = "wish-box";
    const title = document.createElement("h2");
    title.style.margin = "0 0 4px";
    title.textContent = items.length > 0 ? `心愿单 · 还差 ${items.length} 个` : "心愿单";
    box.appendChild(title);
    if (items.length === 0) {
      const hint = document.createElement("p");
      hint.className = "empty-hint";
      hint.style.padding = "6px 0";
      hint.textContent = "点动作右边的 ♡ 收藏想解锁的动作，会列在这里";
      box.appendChild(hint);
    } else {
      for (const s of items) {
        const row = skillRow(s, { showHeart: true });
        row.classList.add("wish-row");
        box.appendChild(row);
      }
    }
    wishSection.appendChild(box);
  }

  function paintBody() {
    body.innerHTML = "";
    const visibleCats = activeCat === "all" ? catalog.CATS : catalog.CATS.filter((c) => c.key === activeCat);
    for (const cat of visibleCats) {
      const skills = catalog.SKILLS.filter((s) => s.cat === cat.key && matches(s)).sort(
        (a, b) => a.tier - b.tier,
      );
      if (skills.length === 0) continue;
      const head = document.createElement("div");
      head.className = "skill-group-head";
      head.innerHTML = `<span class="skill-group-head__en">${cat.name}</span><span class="skill-group-head__zh">${cat.sub}</span>`;
      body.appendChild(head);
      for (const s of skills) {
        body.appendChild(skillRow(s, { showHeart: true }));
      }
    }
    if (body.children.length === 0) {
      body.innerHTML = `<p class="empty-hint">没搜到匹配的动作</p>`;
    }
  }

  function repaint() {
    container.querySelector(".skill-progress__count").innerHTML = `
      <b>${unlocked.size}</b> / ${catalog.SKILLS.length}
      <div class="skill-bar"><span class="skill-bar__fill" style="width:${(unlocked.size / catalog.SKILLS.length) * 100}%"></span></div>
    `;
    paintWishSection();
    paintBody();
  }

  searchInput.addEventListener("input", () => {
    query = searchInput.value.trim();
    paintBody();
  });

  chips.forEach((chip) =>
    chip.addEventListener("click", () => {
      activeCat = chip.dataset.cat;
      chips.forEach((c) => c.classList.toggle("chip--active", c === chip));
      paintBody();
    }),
  );

  repaint();
}

// 训练 tab（SPEC.md §4）。这一版先做手写编辑器（§4.3）+ 历史记录（§4.4）
// 这条路径——它既是"自动同步没有数据"时的正式兜底，也是"只想快速记一笔"
// 时的常规入口，覆盖了训练记录的核心使用场景。
//
// 自动同步三步流程（§4.2：选段落→逐段填写→确认）还没做——那条路径需要
// 先把 wods 表里的段落结构渲染成可勾选/可逐段填重量的表单，工作量独立于
// 这条编辑器路径，留到下一轮。约课提醒（§7）依赖这条流程的"确认"步骤
// 触发，也一起留到那时候接上。
import { addWorkout, updateWorkout, deleteWorkout, listAllWorkouts, listUnlockedSkills, autoUnlockSkill } from "../data.js";
import { parseBlock, totalVolume } from "../wodtext.js";
import { muscleProfile } from "../muscles.js";
import { matchSkills } from "../skillmatch.js";
import { todayStr, formatReadableDateTime } from "../dateutils.js";

export async function render(container) {
  let editingId = null;
  let records = await listAllWorkouts();

  container.innerHTML = `
    <form class="train-form">
      <input type="text" class="train-title" placeholder="标题（可选）" />
      <textarea class="train-body" rows="6" placeholder="一行一个动作，比如：&#10;Back Squat 100kg 5x5&#10;Row 500m 2min"></textarea>
      <div class="train-preview"></div>
      <div class="train-actions">
        <button type="button" class="btn ghost" data-cancel hidden>取消编辑</button>
        <button type="submit" class="btn" data-submit>保存</button>
      </div>
    </form>
    <h2>历史记录</h2>
    <div class="train-history"></div>
  `;

  const form = container.querySelector(".train-form");
  const titleInput = container.querySelector(".train-title");
  const bodyInput = container.querySelector(".train-body");
  const preview = container.querySelector(".train-preview");
  const submitBtn = container.querySelector("[data-submit]");
  const cancelBtn = container.querySelector("[data-cancel]");
  const historyEl = container.querySelector(".train-history");

  function paintPreview() {
    const items = parseBlock(bodyInput.value);
    if (items.length === 0) {
      preview.innerHTML = `<p class="empty-hint">还没识别到动作——解析失败不影响保存，原文原样保留。</p>`;
      return;
    }
    const volume = totalVolume(items);
    preview.innerHTML = `
      <p class="train-preview__summary">识别到 ${items.length} 个动作 · 总容量 ${Math.round(volume)} kg</p>
      <ul class="train-preview__list">
        ${items
          .map(
            (it) =>
              `<li>${it.name}${it.weightText ? ` · ${it.weightText}` : ""}${it.repsText ? ` · ${it.repsText}` : ""}</li>`,
          )
          .join("")}
      </ul>
    `;
  }

  function resetForm() {
    editingId = null;
    titleInput.value = "";
    bodyInput.value = "";
    submitBtn.textContent = "保存";
    cancelBtn.hidden = true;
    paintPreview();
  }

  function loadIntoForm(record, { asCopy }) {
    editingId = asCopy ? null : record.id;
    titleInput.value = record.title || "";
    bodyInput.value = record.body;
    submitBtn.textContent = asCopy ? "另存为新记录" : "保存修改";
    cancelBtn.hidden = false;
    paintPreview();
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function paintHistory() {
    historyEl.innerHTML = "";
    if (records.length === 0) {
      historyEl.innerHTML = `<p class="empty-hint">还没有训练记录</p>`;
      return;
    }
    for (const record of records) {
      historyEl.appendChild(renderHistoryCard(record));
    }
  }

  function renderHistoryCard(record) {
    const card = document.createElement("div");
    card.className = "train-card";

    const moveNames = (record.items || []).map((it) => it.name).join(" · ");
    const muscles = record.muscles || [];

    card.innerHTML = `
      <div class="train-card__head">
        <h3>${record.title || "训练记录"}</h3>
        <span class="train-card__time">${formatReadableDateTime(record.created_at)}</span>
      </div>
      ${moveNames ? `<p class="train-card__moves">${moveNames}</p>` : ""}
      ${
        muscles.length
          ? `<div class="muscle-tags">${muscles.map((m) => `<span class="muscle-tag">${m.name} ×${m.n}</span>`).join("")}</div>`
          : ""
      }
      <p class="train-card__volume">总容量 ${Math.round(record.volume || 0)} kg</p>
      <div class="train-card__actions">
        <button type="button" class="linklike" data-copy>复制</button>
        <button type="button" class="linklike" data-edit>改</button>
        <button type="button" class="linklike" data-delete style="color:var(--signal)">删</button>
      </div>
    `;

    card.querySelector("[data-copy]").addEventListener("click", () => loadIntoForm(record, { asCopy: true }));
    card.querySelector("[data-edit]").addEventListener("click", () => loadIntoForm(record, { asCopy: false }));
    card.querySelector("[data-delete]").addEventListener("click", async () => {
      if (!confirm(`删除「${record.title || "这条训练记录"}」？`)) return;
      await deleteWorkout(record.id);
      records = await listAllWorkouts();
      await paintHistory();
    });

    return card;
  }

  bodyInput.addEventListener("input", paintPreview);
  cancelBtn.addEventListener("click", resetForm);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = bodyInput.value.trim();
    if (!body) return;

    const items = parseBlock(body);
    const volume = totalVolume(items);
    const muscles = muscleProfile(body);
    const payload = { day: todayStr(), title: titleInput.value.trim(), body, items, volume, muscles };

    const saved = editingId ? await updateWorkout(editingId, payload) : await addWorkout(payload);

    // 保存后扫描一遍，自动解锁认出来的动作（SPEC.md §6.3）——只对"当前
    // 还没解锁"的动作调用，不覆盖已有的手动解锁记录
    const unlocked = new Set((await listUnlockedSkills()).map((s) => s.movement_key));
    const hits = matchSkills(body).filter((h) => !unlocked.has(h.key));
    for (const hit of hits) {
      await autoUnlockSkill(hit.key, { weightText: hit.weightText, sourceLine: hit.line, workoutId: saved.id });
    }

    records = await listAllWorkouts();
    resetForm();
    await paintHistory();
    if (hits.length > 0) {
      alert(`已保存，自动解锁了 ${hits.length} 个动作`);
    }
  });

  paintPreview();
  await paintHistory();
}

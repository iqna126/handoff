// 训练 tab 的历史记录列表：纯展示 + 复制/改/删，不管表单本身长什么样——
// "改"/"复制"点了之后具体怎么把记录载回表单由调用方（train.js）决定，
// 这里只负责维护 records 列表、渲染卡片、触发 onEdit 回调。
import { deleteWorkout, listAllWorkouts } from "../data.js";
import { formatMonthDay } from "../dateutils.js";
import { showConfirm } from "../dialog.js";

// onEdit(record, {asCopy})：复制/改按钮的回调，由 train.js 的 loadIntoForm 处理。
export function createHistoryList({ historyEl, onEdit }) {
  let records = [];

  async function refresh() {
    records = await listAllWorkouts();
    paint();
  }

  function paint() {
    historyEl.innerHTML = "";
    if (records.length === 0) {
      historyEl.innerHTML = `<p class="empty-hint">还没有训练记录</p>`;
      return;
    }
    for (const record of records) {
      historyEl.appendChild(renderCard(record));
    }
  }

  function renderCard(record) {
    const card = document.createElement("div");
    card.className = "train-card";
    // 肌群标签不显示 ×N 计数、也不显示"有氧"——看内容就知道有没有有氧动作，
    // 数字和 cardio 标签都是噪音（用户明确要求去掉）
    const muscles = (record.muscles || []).filter((m) => m.key !== "cardio");
    card.innerHTML = `
      <div class="train-card__head">
        <h3></h3>
        <span class="train-card__time">${formatMonthDay(record.day)}</span>
      </div>
      <pre class="train-card__body"></pre>
      ${
        muscles.length
          ? `<div class="muscle-tags">${muscles.map((m) => `<span class="muscle-tag">${m.name}</span>`).join("")}</div>`
          : ""
      }
      <div class="train-card__actions">
        <button type="button" class="linklike" data-copy>复制</button>
        <button type="button" class="linklike" data-edit>改</button>
        <button type="button" class="linklike" data-delete style="color:var(--signal)">删</button>
      </div>
    `;
    // textContent（不是拼进 innerHTML 的字符串）：保留原文真实换行，
    // 也不会把用户手填的内容当成标签解析
    card.querySelector("h3").textContent = record.title || "训练记录";
    card.querySelector(".train-card__body").textContent = record.body || "";
    card.querySelector("[data-copy]").addEventListener("click", () => onEdit(record, { asCopy: true }));
    card.querySelector("[data-edit]").addEventListener("click", () => onEdit(record, { asCopy: false }));
    card.querySelector("[data-delete]").addEventListener("click", async () => {
      if (!(await showConfirm(`删除「${record.title || "这条训练记录"}」？`))) return;
      await deleteWorkout(record.id);
      await refresh();
    });
    return card;
  }

  return { refresh };
}

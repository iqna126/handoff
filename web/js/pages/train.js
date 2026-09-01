// 训练 tab（SPEC.md §4）。
//
// 两条路径都做了：
// - 主路径（§4.2 简化版）：选日期 → 如果那天 wods 表里有 wodify-pull 同步
//   的内容，列出当天的 program，选一个把计划内容灌进编辑器，用户在同一个
//   文本框里自由改重量/组数/写 modification——SPEC 原方案是"选段落→逐段
//   填写→确认"三步向导式表单，这里简化成"预填 + 自由编辑"，工作量小很多，
//   但"选 WOD 拿到计划内容、可以自由改"这个核心诉求已经满足
// - 兜底路径（§4.3）：当天没有同步到内容，或者想快速记点别的，直接手写
//
// 约课提醒（§7）：保存一条"来自 WOD"的记录后询问要不要约下周同一天的课。
// 上课时间 wods 表现在没有存（wodify-pull 目前没有采集 schedule 的
// StartTime），按 SPEC 自己写的兜底方案——问用户手动填一次。
import {
  addWorkout,
  updateWorkout,
  deleteWorkout,
  listAllWorkouts,
  listWodsForDay,
  listUnlockedSkills,
  autoUnlockSkill,
  addTodo,
} from "../data.js";
import { parseBlock, totalVolume } from "../wodtext.js";
import { muscleProfile } from "../muscles.js";
import { matchSkills } from "../skillmatch.js";
import { renderMonthGrid } from "../calendar.js";
import {
  todayStr,
  formatMonthDay,
  formatMonthTitle,
  addMonths,
  addDays,
  parseDateStr,
  WEEKDAY_LABELS,
} from "../dateutils.js";

function wodToText(wod) {
  const lines = [wod.title || wod.class_type || "WOD"];
  for (const s of wod.sections || []) {
    lines.push(`[${s.kind}] ${s.title}`);
    for (const line of s.lines || []) lines.push(line);
  }
  return lines.join("\n");
}

export async function render(container) {
  let editingId = null;
  let sourceWodId = null; // 当前编辑器内容是不是从某个 WOD 导入的
  let sourceWodDay = null;
  let recordDay = todayStr();
  let pickerMonth = todayStr();
  let pickerOpen = false;
  let records = await listAllWorkouts();

  container.innerHTML = `
    <form class="train-form">
      <div class="train-day-row">
        <span class="entry-row__hint">记录日期</span>
        <button type="button" class="todo-date-btn" data-day-btn></button>
        <div class="todo-picker" hidden>
          <div class="cal-nav">
            <button type="button" class="cal-nav-btn" data-nav="-1">‹</button>
            <span class="cal-nav-title"></span>
            <button type="button" class="cal-nav-btn" data-nav="1">›</button>
          </div>
          <div class="cal-grid"></div>
          <button type="button" class="todo-picker-today">今天</button>
        </div>
      </div>
      <div class="train-wod-picker"></div>
      <input type="text" class="train-title" placeholder="标题（可选）" />
      <textarea class="train-body" rows="6" placeholder="一行一个动作，比如：&#10;Back Squat 100kg 5x5&#10;Row 500m 2min"></textarea>
      <div class="train-preview"></div>
      <textarea class="train-thoughts" rows="2" placeholder="今天感觉怎么样？有什么想法？（可选）"></textarea>
      <div class="train-actions">
        <button type="button" class="btn ghost" data-cancel hidden>取消编辑</button>
        <button type="submit" class="btn" data-submit>保存</button>
      </div>
    </form>
    <h2>历史记录</h2>
    <div class="train-history"></div>
  `;

  const form = container.querySelector(".train-form");
  const dayBtn = container.querySelector("[data-day-btn]");
  const picker = container.querySelector(".todo-picker");
  const pickerGrid = picker.querySelector(".cal-grid");
  const pickerTitle = picker.querySelector(".cal-nav-title");
  const wodPickerEl = container.querySelector(".train-wod-picker");
  const titleInput = container.querySelector(".train-title");
  const bodyInput = container.querySelector(".train-body");
  const thoughtsInput = container.querySelector(".train-thoughts");
  const preview = container.querySelector(".train-preview");
  const submitBtn = container.querySelector("[data-submit]");
  const cancelBtn = container.querySelector("[data-cancel]");
  const historyEl = container.querySelector(".train-history");

  function paintDayPicker() {
    dayBtn.textContent = recordDay === todayStr() ? "今天" : formatMonthDay(recordDay);
    pickerTitle.textContent = formatMonthTitle(pickerMonth);
    renderMonthGrid(pickerGrid, pickerMonth, {
      selected: recordDay,
      onPick: async (d) => {
        recordDay = d;
        pickerOpen = false;
        picker.hidden = true;
        paintDayPicker();
        await paintWodPicker();
      },
    });
  }

  dayBtn.addEventListener("click", () => {
    pickerOpen = !pickerOpen;
    picker.hidden = !pickerOpen;
    if (pickerOpen) {
      pickerMonth = recordDay;
      paintDayPicker();
    }
  });
  picker.querySelectorAll(".cal-nav-btn").forEach((btn) =>
    btn.addEventListener("click", () => {
      pickerMonth = addMonths(pickerMonth, Number(btn.dataset.nav));
      paintDayPicker();
    }),
  );
  picker.querySelector(".todo-picker-today").addEventListener("click", async () => {
    recordDay = todayStr();
    pickerMonth = todayStr();
    pickerOpen = false;
    picker.hidden = true;
    paintDayPicker();
    await paintWodPicker();
  });
  document.addEventListener("click", (e) => {
    if (pickerOpen && !container.querySelector(".train-day-row").contains(e.target)) {
      pickerOpen = false;
      picker.hidden = true;
    }
  });

  // 已同步的 WOD：显示当天所有 program，点一个把计划内容灌进编辑器，
  // 全文自由编辑——不做 SPEC 原方案那套逐段勾选/逐组填写的向导表单，
  // 简化成"预填 + 自由改"，核心诉求（能拿到当天 WOD 内容去改）已满足
  async function paintWodPicker() {
    const wods = await listWodsForDay(recordDay);
    if (wods.length === 0) {
      wodPickerEl.innerHTML = `<p class="empty-hint">${recordDay === todayStr() ? "今天" : recordDay} 还没有同步到 WOD 内容——可以直接手写</p>`;
      return;
    }
    wodPickerEl.innerHTML = `
      <p class="entry-row__hint" style="margin-bottom:6px">已从 Wodify 同步：</p>
      <div class="chip-row" style="margin:0">
        ${wods.map((w) => `<button type="button" class="chip" data-wod="${w.id}">${w.class_type || w.title}</button>`).join("")}
      </div>
    `;
    wodPickerEl.querySelectorAll("[data-wod]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const wod = wods.find((w) => w.id === btn.dataset.wod);
        titleInput.value = wod.class_type || wod.title || "";
        bodyInput.value = wodToText(wod);
        sourceWodId = wod.id;
        sourceWodDay = wod.day;
        paintPreview();
      });
    });
  }

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
    sourceWodId = null;
    sourceWodDay = null;
    titleInput.value = "";
    bodyInput.value = "";
    thoughtsInput.value = "";
    submitBtn.textContent = "保存";
    cancelBtn.hidden = true;
    paintPreview();
  }

  function loadIntoForm(record, { asCopy }) {
    editingId = asCopy ? null : record.id;
    sourceWodId = asCopy ? null : record.wod_id;
    sourceWodDay = null;
    recordDay = record.day;
    paintDayPicker();
    titleInput.value = record.title || "";
    bodyInput.value = record.body;
    thoughtsInput.value = "";
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
        <span class="train-card__time">${formatMonthDay(record.day)}</span>
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

  // 约课提醒（SPEC.md §7）：保存一条来自 WOD 的记录后才问，不是每次保存都问
  async function maybeOfferBooking() {
    if (!sourceWodId) return;
    const classDay = sourceWodDay || recordDay;
    const nextWeekDay = addDays(classDay, 7);
    const weekdayLabel = WEEKDAY_LABELS[(parseDateStr(nextWeekDay).getDay() + 6) % 7];
    if (!confirm(`要约下周${weekdayLabel}的课吗？`)) return;
    const time = prompt("几点上课？（比如 5:30 PM——wodify-pull 目前没同步具体时间，需要手填一次）");
    if (!time) return;
    const classType = titleInput.value.trim() || "训练";
    await addTodo({
      title: `约 周${weekdayLabel} ${time} 的${classType}`,
      day: addDays(nextWeekDay, -1),
    });
  }

  bodyInput.addEventListener("input", paintPreview);
  cancelBtn.addEventListener("click", resetForm);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const bodyText = bodyInput.value.trim();
    if (!bodyText) return;

    const thoughts = thoughtsInput.value.trim();
    const body = thoughts ? `${bodyText}\n\n想法：${thoughts}` : bodyText;
    const items = parseBlock(body);
    const volume = totalVolume(items);
    const muscles = muscleProfile(body);
    const payload = {
      day: recordDay,
      title: titleInput.value.trim(),
      body,
      items,
      volume,
      muscles,
      wod_id: sourceWodId,
    };

    const saved = editingId ? await updateWorkout(editingId, payload) : await addWorkout(payload);

    // 保存后扫描一遍，自动解锁认出来的动作（SPEC.md §6.3）——只对"当前
    // 还没解锁"的动作调用，不覆盖已有的手动解锁记录
    const unlocked = new Set((await listUnlockedSkills()).map((s) => s.movement_key));
    const hits = matchSkills(body).filter((h) => !unlocked.has(h.key));
    for (const hit of hits) {
      await autoUnlockSkill(hit.key, { weightText: hit.weightText, sourceLine: hit.line, workoutId: saved.id });
    }

    records = await listAllWorkouts();
    const hadSourceWod = !!sourceWodId;
    resetForm();
    await paintHistory();
    if (hits.length > 0) alert(`已保存，自动解锁了 ${hits.length} 个动作`);
    if (hadSourceWod) await maybeOfferBooking();
  });

  paintDayPicker();
  await paintWodPicker();
  paintPreview();
  await paintHistory();
}

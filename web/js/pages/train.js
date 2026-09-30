// 训练 tab（SPEC.md §4）。
//
// 两条路径：
// - 主路径（§4.2）：选日期 → 如果当天 wods 表里有 wodify-pull 同步的内容，
//   列出当天 program，选一个 → 按段落勾选 → 力量段生成组数表格（计划常驻
//   显示，重量/次数自己填），metcon 段有 scaling 档位就给选择器，没有就
//   显示整段计划 + 成绩 + 改动（改动在计划下方，不替换计划）→ 保存
// - 兜底路径（§4.3）：没有 WOD 数据，或者想快速记点别的，直接手写
//
// 段落默认全勾（不是 SPEC 原方案"默认只勾 strength/metcon"那样区别对待）：
// Wodify 有些天只标了两三个 IsSection 组件，中间真正的力量/metcon 内容会
// 被折进离它最近的那个 warmup/cooldown 段落里（kind 分类是按段落自己的
// 标题判的，跟里面实际塞了什么内容无关）——默认隐藏"非重点"段落等于默认
// 藏起来一部分真实训练内容，还得用户知道去手动勾开。全部默认勾选、让
// 用户自己去掉不想记的，比自作主张猜"这段重要不重要"更不容易漏内容。
import {
  addWorkout,
  updateWorkout,
  listWodsForDay,
  listUnlockedSkills,
  autoUnlockSkill,
  addTodo,
} from "../data.js";
import { muscleProfile } from "../muscles.js";
import { matchSkills } from "../skillmatch.js";
import { createDatePicker } from "../datepicker.js";
import { createWodSectionEditor } from "./train-wod-sections.js";
import { createHistoryList } from "./train-history.js";
import { showConfirm, showPrompt } from "../dialog.js";
import { todayStr, addDays, parseDateStr, WEEKDAY_LABELS, formatTimeOfDay } from "../dateutils.js";

export async function render(container) {
  let editingId = null;
  let recordDay = todayStr();

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

      <div class="train-manual">
        <textarea class="train-body" rows="6" placeholder="一行一个动作，比如：&#10;Back Squat 100kg 5x5&#10;Row 500m 2min"></textarea>
      </div>
      <div class="train-sections" hidden></div>

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
  const wodPickerEl = container.querySelector(".train-wod-picker");
  const titleInput = container.querySelector(".train-title");
  const manualEl = container.querySelector(".train-manual");
  const bodyInput = container.querySelector(".train-body");
  const sectionsEl = container.querySelector(".train-sections");
  const thoughtsInput = container.querySelector(".train-thoughts");
  const submitBtn = container.querySelector("[data-submit]");
  const cancelBtn = container.querySelector("[data-cancel]");
  const historyEl = container.querySelector(".train-history");

  // ---------- 日期选择器（跟待办 tab 同一套组件） ----------

  const dayPicker = createDatePicker({
    dateBtn: dayBtn,
    picker,
    outsideClickEl: container.querySelector(".train-day-row"),
    getDate: () => recordDay,
    onPick: async (d) => {
      recordDay = d;
      wodEditor.exitWodMode();
      await wodEditor.paintWodPicker();
    },
  });

  // ---------- WOD 选择 + 按段落勾选（SPEC.md §4.2 步骤①②，逻辑在
  // train-wod-sections.js） ----------

  const wodEditor = createWodSectionEditor({
    wodPickerEl,
    sectionsEl,
    titleInput,
    manualEl,
    bodyInput,
    getRecordDay: () => recordDay,
  });

  // ---------- 表单重置 / 载入历史记录 ----------

  function resetForm() {
    editingId = null;
    wodEditor.exitWodMode();
    titleInput.value = "";
    thoughtsInput.value = "";
    submitBtn.textContent = "保存";
    cancelBtn.hidden = true;
  }

  async function loadIntoForm(record, { asCopy }) {
    editingId = asCopy ? null : record.id;
    wodEditor.exitWodMode();
    recordDay = record.day;
    dayPicker.repaint();
    await wodEditor.paintWodPicker();
    thoughtsInput.value = "";
    submitBtn.textContent = asCopy ? "另存为新记录" : "保存修改";
    cancelBtn.hidden = false;

    // 这条记录当初是从某个 WOD 导入、并且存了当时的段落勾选/填写状态——
    // 退回结构化的按段落界面，而不是甩给用户一整段拼好的文字去手改
    // （用户明确要求"退回段落那样的修改"）。那天的 WOD 数据万一没了
    // （比如极少见的被删掉），就老实退回手写模式兜底，不留一片空白。
    if (record.wod_id && record.wod_state) {
      const wods = await listWodsForDay(record.day);
      const wod = wods.find((w) => w.id === record.wod_id);
      if (wod) {
        wodEditor.enterWodMode(wod, { ...record.wod_state, title: record.title });
        form.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
    }
    titleInput.value = record.title || "";
    bodyInput.value = record.body;
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const history = createHistoryList({ historyEl, onEdit: loadIntoForm });

  // ---------- 约课提醒（SPEC.md §7） ----------

  async function maybeOfferBooking(wodDay, classTime) {
    const nextWeekDay = addDays(wodDay, 7);
    const weekdayLabel = WEEKDAY_LABELS[(parseDateStr(nextWeekDay).getDay() + 6) % 7];
    if (!(await showConfirm(`要约下周${weekdayLabel}的课吗？`))) return;
    // 有真实拉到的上课时间就直接用，不用户再手填一遍；schedule 里确实没有
    // 这个 program 当天时段数据时才退回手填（老数据/极少数情况）
    let time = classTime ? formatTimeOfDay(classTime) : null;
    if (!time) {
      time = await showPrompt("几点上课？（这个 WOD 没有同步到具体时间，需要手填一次）", {
        placeholder: "比如 5:30 PM",
      });
      if (!time) return;
    }
    const classType = titleInput.value.trim() || "训练";
    await addTodo({
      title: `约 周${weekdayLabel} ${time} 的${classType}`,
      day: addDays(nextWeekDay, -1),
      classDay: nextWeekDay,
    });
  }

  // ---------- 保存 ----------

  cancelBtn.addEventListener("click", resetForm);

  // 提交按钮没有在保存期间禁用过——网络慢的时候手快点两下，第一下的 await
  // 还没回来第二下就已经发出去了。第二下发出时 editingId 还是同一个值，
  // 结果是同一条记录被 PATCH 两次，不会多出一条；但如果是"改"某条记录、
  // 第一下保存把表单 resetForm() 成"新建"状态之后才点第二下，第二下就会
  // 变成 addWorkout，凭空多出一条一模一样的记录。禁用按钮把这类竞态挡掉。
  let submitting = false;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (submitting) return;

    const fromWod = wodEditor.activeWod;
    const wodDay = fromWod ? fromWod.day : null;
    const wodClassTime = wodEditor.selectedClassTime;
    const bodyText = fromWod ? wodEditor.composeFromSections() : bodyInput.value.trim();
    if (!bodyText) return;

    // 结构化的段落状态本身也要存下来（不只是拼好的 body 文字）——不然
    // 下次点"改"就只能拿到一段拼好的文字，没法退回按段落勾选/填写的
    // 界面（用户明确要求改的时候要能退回段落模式，不是直接编辑文字）
    const wodState = fromWod
      ? {
          classTime: wodClassTime,
          sections: [...wodEditor.sectionStates.entries()].map(([id, s]) => ({ id, ...s })),
        }
      : null;

    submitting = true;
    submitBtn.disabled = true;
    try {
      const thoughts = thoughtsInput.value.trim();
      const body = thoughts ? `${bodyText}\n\n想法：${thoughts}` : bodyText;
      const muscles = muscleProfile(body);
      const payload = {
        day: recordDay,
        title: titleInput.value.trim(),
        body,
        items: [],
        volume: 0,
        muscles,
        wod_id: fromWod ? fromWod.id : null,
        wod_state: wodState,
      };

      const saved = editingId ? await updateWorkout(editingId, payload) : await addWorkout(payload);

      const unlocked = new Set((await listUnlockedSkills()).map((s) => s.movement_key));
      const hits = matchSkills(body).filter((h) => !unlocked.has(h.key));
      for (const hit of hits) {
        await autoUnlockSkill(hit.key, { weightText: hit.weightText, sourceLine: hit.line, workoutId: saved.id });
      }

      resetForm();
      await history.refresh();
      if (fromWod) await maybeOfferBooking(wodDay, wodClassTime);
    } finally {
      submitting = false;
      submitBtn.disabled = false;
    }
  });

  await wodEditor.paintWodPicker();
  await history.refresh();
}

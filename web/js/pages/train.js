// 训练 tab（SPEC.md §4）。
//
// 两条路径：
// - 主路径（§4.2）：选日期 → 如果当天 wods 表里有 wodify-pull 同步的内容，
//   列出当天 program，选一个 → 按段落勾选（默认勾 strength/metcon，热身/
//   拉伸/附加默认不勾）→ 力量段生成组数表格（计划常驻显示，重量/次数
//   自己填），metcon 段显示完整计划 + 成绩 + 改动（改动在计划下方，不
//   替换计划）→ 保存
// - 兜底路径（§4.3）：没有 WOD 数据，或者想快速记点别的，直接手写
//
// 跟 SPEC 原方案的两处差异，都是当前数据结构撑不住，不是偷懒：
// 1. metcon 没有 scaling 档位选择器——wodify-pull 自己的解析器
//    （api-wodify/src/wodify/parse.py）只按 Wodify 的 IsSection 标记分段，
//    不像被删除的粘贴解析器那样识别"[Xxx: Levels]"/"Level 2:"这种子块，
//    所以档位内容都被拉平成普通文本行，没法单独摘出来做选择器。要做的话
//    得先在 api-wodify 那边把这部分解析出来，是另一块工作量。
// 2. 约课的具体上课时间需要手填——wodify-pull 目前只拉 workout 内容，
//    没拉 schedule 动作的 StartTime。
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
import { cleanLines } from "../htmlclean.js";
import {
  todayStr,
  formatMonthDay,
  formatMonthTitle,
  addMonths,
  addDays,
  parseDateStr,
  WEEKDAY_LABELS,
} from "../dateutils.js";

const DEFAULT_CHECKED_KINDS = new Set(["strength", "metcon"]);

// 力量段：按"Set N: ..."这个模式自动预生成对应组数；识别不到就看 score
// 里有没有"(N Sets)"，再没有就默认 3 组（SPEC.md §4.2 步骤②）
function buildSetRows(section) {
  const lines = cleanLines(section.lines);
  const setLines = lines.filter((l) => /^Set\s+\d+:/i.test(l));
  if (setLines.length > 0) {
    return setLines.map((l) => {
      const m = l.match(/^Set\s+(\d+):\s*(.*)$/i);
      return { n: Number(m[1]), plan: m[2].trim(), weight: "", reps: "" };
    });
  }
  const scoreMatch = (section.score || "").match(/(\d+)\s*sets?/i);
  const n = scoreMatch ? Number(scoreMatch[1]) : 3;
  const planLine = lines.find((l) => l) || section.score || "";
  return Array.from({ length: n }, (_, i) => ({ n: i + 1, plan: planLine, weight: "", reps: "" }));
}

function wodTitle(wod) {
  return wod.class_type || wod.title || "WOD";
}

function formatTimeOfDay(iso) {
  const timePart = iso.split("T")[1] || iso;
  const [hh, mm] = timePart.split(":");
  const h = Number(hh);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm} ${period}`;
}

export async function render(container) {
  let editingId = null;
  let recordDay = todayStr();
  let pickerMonth = todayStr();
  let pickerOpen = false;
  let records = await listAllWorkouts();

  // WOD 结构化模式的状态：选中某个 program 后才有值
  let activeWod = null;
  let sectionStates = null; // Map<sectionId, {checked, rows?, resultText?, modText?, freeText?}>
  let selectedClassTime = null; // 当天这个 program 具体哪个时段的课，约课提醒用

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
        <div class="train-preview"></div>
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
  const pickerGrid = picker.querySelector(".cal-grid");
  const pickerTitle = picker.querySelector(".cal-nav-title");
  const wodPickerEl = container.querySelector(".train-wod-picker");
  const titleInput = container.querySelector(".train-title");
  const manualEl = container.querySelector(".train-manual");
  const bodyInput = container.querySelector(".train-body");
  const preview = container.querySelector(".train-preview");
  const sectionsEl = container.querySelector(".train-sections");
  const thoughtsInput = container.querySelector(".train-thoughts");
  const submitBtn = container.querySelector("[data-submit]");
  const cancelBtn = container.querySelector("[data-cancel]");
  const historyEl = container.querySelector(".train-history");

  // ---------- 日期选择器（跟待办 tab 同一套组件） ----------

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
        exitWodMode();
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
    exitWodMode();
    await paintWodPicker();
  });
  document.addEventListener("click", (e) => {
    if (pickerOpen && !container.querySelector(".train-day-row").contains(e.target)) {
      pickerOpen = false;
      picker.hidden = true;
    }
  });

  // ---------- WOD 选择 + 按段落勾选（SPEC.md §4.2 步骤①②） ----------

  async function paintWodPicker() {
    const wods = await listWodsForDay(recordDay);
    if (wods.length === 0) {
      wodPickerEl.innerHTML = `<p class="empty-hint">${recordDay === todayStr() ? "今天" : recordDay} 还没有同步到 WOD 内容——可以直接手写</p>`;
      return;
    }
    wodPickerEl.innerHTML = `
      <p class="entry-row__hint" style="margin-bottom:6px">已从 Wodify 同步：</p>
      <div class="chip-row" style="margin:0">
        ${wods.map((w) => `<button type="button" class="chip" data-wod="${w.id}">${wodTitle(w)}</button>`).join("")}
      </div>
    `;
    wodPickerEl.querySelectorAll("[data-wod]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const wod = wods.find((w) => w.id === btn.dataset.wod);
        enterWodMode(wod);
      });
    });
  }

  function enterWodMode(wod) {
    activeWod = wod;
    selectedClassTime = (wod.class_times || [])[0] || null;
    titleInput.value = wodTitle(wod);
    sectionStates = new Map();
    for (const section of wod.sections || []) {
      const checked = DEFAULT_CHECKED_KINDS.has(section.kind);
      if (section.kind === "strength") {
        sectionStates.set(section.id, { checked, rows: buildSetRows(section) });
      } else if (section.kind === "metcon") {
        // 有 scaling 档位（RX/Level 2/Masters 55+ ...）就给一个档位选择器；
        // 没有（wodify-pull 拉不到 Levels 子块的老数据）就退回展示整段计划
        const levels = (section.levels || []).map((lv) => ({
          name: lv.name,
          plan: cleanLines(lv.lines).join("\n"),
        }));
        const plan = cleanLines(section.lines).join("\n");
        sectionStates.set(section.id, { checked, levels, levelIndex: 0, plan, resultText: "", modText: "" });
      } else {
        sectionStates.set(section.id, { checked, freeText: cleanLines(section.lines).join("\n") });
      }
    }
    manualEl.hidden = true;
    sectionsEl.hidden = false;
    paintSections();
  }

  function exitWodMode() {
    activeWod = null;
    sectionStates = null;
    selectedClassTime = null;
    manualEl.hidden = false;
    sectionsEl.hidden = true;
    titleInput.value = "";
    bodyInput.value = "";
    paintPreview();
  }

  function paintSections() {
    sectionsEl.innerHTML = `<button type="button" class="linklike" data-back-to-manual style="margin-bottom:10px">‹ 改为手写</button>`;
    sectionsEl
      .querySelector("[data-back-to-manual]")
      .addEventListener("click", exitWodMode);

    const times = activeWod.class_times || [];
    if (times.length > 0) {
      const timeRow = document.createElement("div");
      timeRow.className = "chip-row";
      timeRow.style.margin = "0 0 12px";
      timeRow.innerHTML =
        `<span class="entry-row__hint" style="margin-right:4px">这节课的时间：</span>` +
        times
          .map(
            (t, i) =>
              `<button type="button" class="chip ${t === selectedClassTime ? "chip--active" : ""}" data-time="${i}">${formatTimeOfDay(t)}</button>`,
          )
          .join("");
      timeRow.querySelectorAll("[data-time]").forEach((btn) => {
        btn.addEventListener("click", () => {
          selectedClassTime = times[Number(btn.dataset.time)];
          paintSections();
        });
      });
      sectionsEl.appendChild(timeRow);
    }

    for (const section of activeWod.sections || []) {
      const state = sectionStates.get(section.id);
      const card = document.createElement("div");
      card.className = "section-card";
      card.innerHTML = `
        <label class="section-card__head">
          <input type="checkbox" data-section-check="${section.id}" ${state.checked ? "checked" : ""} />
          <span class="section-card__title">[${section.kind}] ${section.title}</span>
        </label>
        <div class="section-card__body" ${state.checked ? "" : "hidden"}></div>
      `;
      const body = card.querySelector(".section-card__body");
      paintSectionBody(body, section, state);

      card.querySelector("[data-section-check]").addEventListener("change", (e) => {
        state.checked = e.target.checked;
        body.hidden = !state.checked;
      });

      sectionsEl.appendChild(card);
    }
  }

  function paintSectionBody(body, section, state) {
    if (section.kind === "strength") {
      body.innerHTML = `
        <table class="set-table">
          <thead><tr><th>组</th><th>计划</th><th>重量</th><th>次数</th></tr></thead>
          <tbody>
            ${state.rows
              .map(
                (r, i) => `<tr>
                  <td>${r.n}</td>
                  <td class="set-table__plan">${r.plan || "—"}</td>
                  <td><input type="text" inputmode="decimal" class="set-table__input" data-row="${i}" data-field="weight" placeholder="重量" /></td>
                  <td><input type="text" inputmode="numeric" class="set-table__input" data-row="${i}" data-field="reps" placeholder="次数" /></td>
                </tr>`,
              )
              .join("")}
          </tbody>
        </table>
      `;
      body.querySelectorAll("[data-row]").forEach((input) => {
        input.addEventListener("input", () => {
          state.rows[Number(input.dataset.row)][input.dataset.field] = input.value;
        });
      });
    } else if (section.kind === "metcon") {
      const hasLevels = state.levels.length > 0;
      const planText = hasLevels ? state.levels[state.levelIndex].plan : state.plan;
      body.innerHTML = `
        ${
          hasLevels
            ? `<div class="chip-row" style="margin:0 0 8px">
                ${state.levels
                  .map(
                    (lv, i) =>
                      `<button type="button" class="chip ${i === state.levelIndex ? "chip--active" : ""}" data-level="${i}">${lv.name}</button>`,
                  )
                  .join("")}
              </div>`
            : ""
        }
        <div class="metcon-plan">${(planText || "").replace(/\n/g, "<br>") || "（没有计划内容）"}</div>
        <input type="text" class="metcon-result" placeholder="成绩（比如 78 reps / 12:34）" value="${state.resultText}" />
        <textarea class="metcon-mod" rows="2" placeholder="改动（可选，计划本身还是原样保留在上面）">${state.modText}</textarea>
      `;
      if (hasLevels) {
        body.querySelectorAll("[data-level]").forEach((btn) => {
          btn.addEventListener("click", () => {
            state.levelIndex = Number(btn.dataset.level);
            paintSectionBody(body, section, state);
          });
        });
      }
      body.querySelector(".metcon-result").addEventListener("input", (e) => {
        state.resultText = e.target.value;
      });
      body.querySelector(".metcon-mod").addEventListener("input", (e) => {
        state.modText = e.target.value;
      });
    } else {
      body.innerHTML = `<textarea class="section-freetext" rows="3">${state.freeText}</textarea>`;
      body.querySelector(".section-freetext").addEventListener("input", (e) => {
        state.freeText = e.target.value;
      });
    }
  }

  // 把结构化的段落状态拼成最终存的 body 文本 + items——力量段直接拿用户
  // 填的重量/次数拼成"标准行"喂给 parseLine，复用同一套容量计算，不用
  // 另外发明一套；metcon/其它段落是自由文本，一起丢进 parseBlock。
  // 这样"识别到 N 个动作"统计的是用户真的填了数据的那些行，不会把警告/
  // 计划原文里的每一句话都当成一个"动作"。
  function composeFromSections() {
    const lines = [];
    for (const section of activeWod.sections || []) {
      const state = sectionStates.get(section.id);
      if (!state.checked) continue;
      lines.push(`[${section.kind}] ${section.title}`);
      if (section.kind === "strength") {
        for (const r of state.rows) {
          if (!r.weight && !r.reps) continue;
          const weightPart = r.weight ? `${r.weight}lb` : "";
          const repsPart = r.reps ? `1x${r.reps}` : "";
          // 计划提示跟这一组的实际表现拼在同一行——分开成两行的话，"计划：..."
          // 那一行也会被 parseBlock 当成单独一个"动作"，把统计吹高
          const planPart = r.plan ? `（计划：${r.plan}）` : "";
          lines.push(`${section.title} ${weightPart} ${repsPart} ${planPart}`.trim());
        }
      } else if (section.kind === "metcon") {
        const hasLevels = state.levels.length > 0;
        const chosen = hasLevels ? state.levels[state.levelIndex] : null;
        lines.push(chosen ? chosen.plan : state.plan);
        if (chosen) lines.push(`档位：${chosen.name}`);
        if (state.modText) lines.push(`改动：${state.modText}`);
        if (state.resultText) lines.push(`成绩：${state.resultText}`);
      } else if (state.freeText) {
        lines.push(state.freeText);
      }
      lines.push("");
    }
    return lines.join("\n").trim();
  }

  // ---------- 手写模式的实时解析预览（SPEC.md §4.3） ----------

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

  // ---------- 表单重置 / 载入历史记录 ----------

  function resetForm() {
    editingId = null;
    exitWodMode();
    titleInput.value = "";
    thoughtsInput.value = "";
    submitBtn.textContent = "保存";
    cancelBtn.hidden = true;
  }

  function loadIntoForm(record, { asCopy }) {
    editingId = asCopy ? null : record.id;
    exitWodMode();
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

  // ---------- 约课提醒（SPEC.md §7） ----------

  async function maybeOfferBooking(wodDay, classTime) {
    const nextWeekDay = addDays(wodDay, 7);
    const weekdayLabel = WEEKDAY_LABELS[(parseDateStr(nextWeekDay).getDay() + 6) % 7];
    if (!confirm(`要约下周${weekdayLabel}的课吗？`)) return;
    // 有真实拉到的上课时间就直接用，不用户再手填一遍；schedule 里确实没有
    // 这个 program 当天时段数据时才退回手填（老数据/极少数情况）
    let time = classTime ? formatTimeOfDay(classTime) : null;
    if (!time) {
      time = prompt("几点上课？（这个 WOD 没有同步到具体时间，需要手填一次，比如 5:30 PM）");
      if (!time) return;
    }
    const classType = titleInput.value.trim() || "训练";
    await addTodo({ title: `约 周${weekdayLabel} ${time} 的${classType}`, day: addDays(nextWeekDay, -1) });
  }

  // ---------- 保存 ----------

  bodyInput.addEventListener("input", paintPreview);
  cancelBtn.addEventListener("click", resetForm);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const fromWod = activeWod;
    const wodDay = fromWod ? fromWod.day : null;
    const wodClassTime = selectedClassTime;
    const bodyText = fromWod ? composeFromSections() : bodyInput.value.trim();
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
      wod_id: fromWod ? fromWod.id : null,
    };

    const saved = editingId ? await updateWorkout(editingId, payload) : await addWorkout(payload);

    const unlocked = new Set((await listUnlockedSkills()).map((s) => s.movement_key));
    const hits = matchSkills(body).filter((h) => !unlocked.has(h.key));
    for (const hit of hits) {
      await autoUnlockSkill(hit.key, { weightText: hit.weightText, sourceLine: hit.line, workoutId: saved.id });
    }

    records = await listAllWorkouts();
    resetForm();
    await paintHistory();
    if (hits.length > 0) alert(`已保存，自动解锁了 ${hits.length} 个动作`);
    if (fromWod) await maybeOfferBooking(wodDay, wodClassTime);
  });

  paintDayPicker();
  await paintWodPicker();
  paintPreview();
  await paintHistory();
}

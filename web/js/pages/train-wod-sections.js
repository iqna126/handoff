// 训练 tab 里"选中一个 WOD program 之后，按段落勾选/填写"这部分的状态机
// （activeWod/sectionStates/selectedClassTime + 对应的渲染逻辑）。跟
// train.js 本身的日期/表单/历史记录是两件事，自己有一整套状态，塞在同一个
// 文件里会让 render() 长到没法一屏看完，所以单独抽出来。
import { listWodsForDay } from "../data.js";
import { formatTimeOfDay, todayStr } from "../dateutils.js";
import { cleanLines, escapeHtml } from "../htmlclean.js";

// 计划写的是"4 Reps @ 70%"这种明确数字时，次数其实是教练定死的，不是
// 用户要填的信息——只有重量是用户自己要算/要写的。次数框预填这个数字，
// 省得每组都要跟着计划抄一遍；真的少做/多做了（比如力竭掉了一次）用户
// 自己改。计划写的是"3-5 Reps"这种范围、或者没有数字（比如"AMRAP"）时，
// 教练没有定死具体次数，不猜，留空跟以前一样手填。
function repsFromPlan(planText) {
  const m = (planText || "").match(/^(\d+)\s*reps?\b/i);
  return m ? m[1] : "";
}

// Wodify 有些"strength"段落标题带" + "（比如"Rope Climb + Supine Grip Bent
// Over Barbell Row + Dual Dumbbell Hammer Curls"），真机数据证实过这种
// 段落经常没有"Set N:"这种清晰的分组标记，"组数"只能靠 score 兜底猜——
// 猜不出来就默认 3，"计划"列还会把同一句"Every 4:00 x 4 Sets"重复贴三遍，
// 而且这种复合动作往往好几个器械用不同重量（杠铃一个、哑铃另一个），
// "每组一个重量框"塞不下。
//
// 但标题带"+"不等于内容一定没法结构化——如果段落本身就写了清楚的
// "Set 1: ..."/"Set 2: ..."，说明教练已经把每组的内容拆好了，这种情况
// 表格照样好用、不该被标题里的"+"连累退回自由文本。只有真的没有
// "Set N:"结构、又是多动作复合的情况，才需要退回自由文本让用户自己写。
function isSingleMovementStrength(section) {
  if (section.kind !== "strength") return false;
  const hasSetLines = cleanLines(section.lines).some((l) => /^Set\s+\d+:/i.test(l));
  return hasSetLines || !section.title.includes(" + ");
}

// 力量段：按"Set N: ..."这个模式自动预生成对应组数；识别不到就看 score
// 里有没有"(N Sets)"，再没有就默认 3 组（SPEC.md §4.2 步骤②）
function buildSetRows(section) {
  const lines = cleanLines(section.lines);
  const setLines = lines.filter((l) => /^Set\s+\d+:/i.test(l));
  if (setLines.length > 0) {
    return setLines.map((l) => {
      const m = l.match(/^Set\s+(\d+):\s*(.*)$/i);
      const plan = m[2].trim();
      return { n: Number(m[1]), plan, weight: "", reps: repsFromPlan(plan) };
    });
  }
  const scoreMatch = (section.score || "").match(/(\d+)\s*sets?/i);
  const n = scoreMatch ? Number(scoreMatch[1]) : 3;
  const planLine = lines.find((l) => l) || section.score || "";
  const reps = repsFromPlan(planLine);
  return Array.from({ length: n }, (_, i) => ({ n: i + 1, plan: planLine, weight: "", reps }));
}

function wodTitle(wod) {
  return wod.class_type || wod.title || "WOD";
}

// wodPickerEl/sectionsEl/titleInput/manualEl/bodyInput：train.js 表单里的
// 固定 DOM 节点。getRecordDay：读当前选中的记录日期（train.js 自己的状态，
// 这里只读不改）。
export function createWodSectionEditor({
  wodPickerEl,
  sectionsEl,
  titleInput,
  manualEl,
  bodyInput,
  getRecordDay,
}) {
  let activeWod = null;
  let sectionStates = null; // Map<sectionId, {checked, rows?, resultText?, modText?, freeText?}>
  let selectedClassTime = null; // 当天这个 program 具体哪个时段的课，约课提醒用

  async function paintWodPicker() {
    const recordDay = getRecordDay();
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

  // restore：改一条之前存过的 WOD 记录时，把上次每个段落勾选/填的重量
  // 次数/档位/成绩原样摆回去，而不是退回一片空白的默认状态（见
  // train.js loadIntoForm 里的说明）。restore.sections 里按 section.id 找
  // 不到的（比如那天的 WOD 内容后来变了）照常用默认值兜底。
  function enterWodMode(wod, restore) {
    activeWod = wod;
    selectedClassTime = restore?.classTime ?? ((wod.class_times || [])[0] || null);
    titleInput.value = restore?.title || wodTitle(wod);
    sectionStates = new Map();
    for (const section of wod.sections || []) {
      const saved = restore?.sections?.find((s) => s.id === section.id);
      if (saved) {
        sectionStates.set(section.id, { ...saved });
        continue;
      }
      const checked = true; // 全部默认勾选，见模块顶部说明
      if (isSingleMovementStrength(section)) {
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
  }

  function paintSections() {
    sectionsEl.innerHTML = `<button type="button" class="linklike" data-back-to-manual style="margin-bottom:10px">‹ 改为手写</button>`;
    sectionsEl
      .querySelector("[data-back-to-manual]")
      .addEventListener("click", exitWodMode);

    const times = activeWod.class_times || [];
    if (times.length > 0) {
      // 时间标签跟 chip 放同一个 flex 行里挤过：中文没有天然断词点，
      // flex 收缩会把它挤成一字一行的竖条，chip 本身也被连带撑大——
      // 标签必须单独占一行，不能跟 chip-row 共享 flex 容器
      const label = document.createElement("p");
      label.className = "entry-row__hint";
      label.style.margin = "0 0 6px";
      label.textContent = "这节课的时间：";
      sectionsEl.appendChild(label);

      const timeRow = document.createElement("div");
      timeRow.className = "chip-row";
      timeRow.style.margin = "0 0 12px";
      timeRow.innerHTML = times
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
          <span class="section-card__title">${escapeHtml(section.title)}</span>
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
    if (isSingleMovementStrength(section)) {
      body.innerHTML = `
        <table class="set-table">
          <thead><tr><th>组</th><th>计划</th><th>重量</th><th>次数</th></tr></thead>
          <tbody>
            ${state.rows
              .map(
                (r, i) => `<tr>
                  <td>${r.n}</td>
                  <td class="set-table__plan">${r.plan || "—"}</td>
                  <td><input type="text" inputmode="decimal" class="set-table__input" data-row="${i}" data-field="weight" placeholder="重量" value="${r.weight || ""}" /></td>
                  <td><input type="text" inputmode="numeric" class="set-table__input" data-row="${i}" data-field="reps" placeholder="次数" value="${r.reps || ""}" /></td>
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
                      `<button type="button" class="chip ${i === state.levelIndex ? "chip--active" : ""}" data-level="${i}">${escapeHtml(lv.name)}</button>`,
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
      // 固定 3 行是给"一两句话"那种简短备注设计的——现在多动作复合段落
      // （isSingleMovementStrength 判定为 false 的那些）也会走到这里，
      // 内容可能有十几行，固定 3 行会把大半内容挤到要来回滚动才能看到，
      // 根本没法照着编辑每一行。按实际行数撑开，给个上限避免太夸张。
      const lineCount = (state.freeText || "").split("\n").length;
      const rows = Math.min(Math.max(lineCount, 3), 14);
      body.innerHTML = `<textarea class="section-freetext" rows="${rows}">${state.freeText}</textarea>`;
      body.querySelector(".section-freetext").addEventListener("input", (e) => {
        state.freeText = e.target.value;
      });
    }
  }

  // 把结构化的段落状态拼成最终存的 body 文本——力量段把用户填的重量/次数
  // 跟这一组的计划提示拼在同一行（不拆成两行），保存下来的是一段可读的
  // 训练记录文本，不需要另外再解析。
  function composeFromSections() {
    const lines = [];
    for (const section of activeWod.sections || []) {
      const state = sectionStates.get(section.id);
      if (!state.checked) continue;
      lines.push(section.title);
      if (isSingleMovementStrength(section)) {
        for (const r of state.rows) {
          // 次数现在默认从计划里预填（见 buildSetRows/repsFromPlan），不再是
          // "用户填过东西"的信号——一组只要没填重量，就当用户没做/没记这组，
          // 跳过它，不能只看 reps 是否有值（默认预填的话永远有值，会导致
          // 用户完全没碰过的行也被当成"做过"存进记录里）
          if (!r.weight) continue;
          const weightPart = r.weight ? `${r.weight}lb` : "";
          const repsPart = r.reps ? `1x${r.reps}` : "";
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

  return {
    paintWodPicker,
    enterWodMode,
    exitWodMode,
    composeFromSections,
    get activeWod() {
      return activeWod;
    },
    get selectedClassTime() {
      return selectedClassTime;
    },
    get sectionStates() {
      return sectionStates;
    },
  };
}

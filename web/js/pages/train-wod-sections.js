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

// 只在"按组数展开成多行"之后、往每一行的计划文案里填之前去掉这个后缀——
// 不改 section 本身的数据，标题、score 等其它展示位置照常保留"x N Sets"。
function stripSetsCountSuffix(planText) {
  return (planText || "")
    .replace(/\s*[x×]\s*\d+\s*sets?\b/gi, "")
    .replace(/\s*\(\s*\d+\s*sets?\s*\)/gi, "")
    .trim();
}

// Wodify 有些"strength"段落标题带" + "（比如"Rope Climb + Supine Grip Bent
// Over Barbell Row + Dual Dumbbell Hammer Curls"），真机数据证实过这种
// 段落经常没有"Set N:"这种清晰的分组标记，"组数"只能靠 score 兜底猜——
// 猜不出来就默认 3。这种标题里一长串" + "连起来、又没有干净分隔的复合
// 动作，暂时还是退回自由文本（见下面 else 分支），不在本次修复范围内。
//
// 但"标题干净、内容里才是复合动作"这种情况不一样——真机数据证实过：标题
// 只写"Front Squat"，内容却是"5 Front Squats @ 65-70%" / "+" /
// "2/2 Turkish Get-Ups"，教练显然是把两个动作配对着做（见
// splitCompoundMovements）。这种情况表格照样好用，只是"重量"要拆成两个
// 动作各自一个输入框，不能揉成一个。
//
// 这个兜底分支展开成 N 行之后，"总共 N 组"这件事已经靠行数表达出来了，
// 计划文案里"x N Sets"/"（N Sets）"这个总组数后缀在每一行里再出现一遍
// 没有意义（真实反馈：用户看到"Every 4:00 x 5 Sets"在 5 行里各贴了一遍，
// 以为是"每组内部又要做 5 组"，见 stripSetsCountSuffix）。
//
// 标题带"+"不等于内容一定没法结构化——如果段落本身就写了清楚的
// "Set 1: ..."/"Set 2: ..."，说明教练已经把每组的内容拆好了，这种情况
// 表格照样好用、不该被标题里的"+"连累退回自由文本。只有真的没有
// "Set N:"结构、又是多动作复合的情况，才需要退回自由文本让用户自己写。
function isSingleMovementStrength(section) {
  if (section.kind !== "strength") return false;
  const hasSetLines = cleanLines(section.lines).some((l) => /^Set\s+\d+:/i.test(l));
  return hasSetLines || !section.title.includes(" + ");
}

// 复合动作目前见过两种手写形状，都要认：
// (a) "A 动作" / 独立一行"+" / "B 动作"（比如 Front Squat / + / Turkish Get-Up）
// (b) "A 动作 + B 动作"写在同一行（比如 Weighted Pull-Ups + Pull-Ups，2026-11-08
//     真机数据证实的——之前只认 (a) 这种形状，这种写法会直接漏判）
// 只见过这两动作配对的形状，真遇到三个动作或者别的写法再扩展，不先猜。
function splitCompoundMovements(lines) {
  const plusIdx = lines.findIndex((l) => l === "+");
  if (plusIdx > 0 && plusIdx < lines.length - 1) {
    return [lines[plusIdx - 1], lines[plusIdx + 1]];
  }
  for (const line of lines) {
    const parts = line.split(/\s\+\s/);
    if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
      return [parts[0].trim(), parts[1].trim()];
    }
  }
  return null;
}

// "5 Front Squats @ 65-70%" -> "Front Squats"：去掉开头的次数（"5 "/"2/2 "）
// 和末尾的负荷说明（"@ 65-70%"），当输入框的短标签用；提取不出来就原样
// 显示整行，不强求干净。
function shortMovementLabel(lineText) {
  const stripped = lineText
    .replace(/^\s*\d+(\/\d+)?\s*/, "")
    .replace(/\s*@.*$/, "")
    .trim();
  return stripped || lineText;
}

// 力量段：按"Set N: ..."这个模式自动预生成对应组数；识别不到就看 score
// 里有没有"(N Sets)"，再没有就默认 3 组（SPEC.md §4.2 步骤②）。每一行的
// `movements` 数组平时只有一项（label 留空，直接显示 plan），复合动作时
// 有两项，各自一个重量输入框——两种情况用同一个形状，渲染/保存只写一套
// 逻辑，不用到处 if 两条分支。
function buildSetRows(section) {
  const lines = cleanLines(section.lines);
  const setLines = lines.filter((l) => /^Set\s+\d+:/i.test(l));
  if (setLines.length > 0) {
    return setLines.map((l) => {
      const m = l.match(/^Set\s+(\d+):\s*(.*)$/i);
      const plan = m[2].trim();
      return { n: Number(m[1]), movements: [{ label: "", plan, weight: "" }], reps: repsFromPlan(plan) };
    });
  }

  const scoreMatch = (section.score || "").match(/(\d+)\s*sets?/i);
  const n = scoreMatch ? Number(scoreMatch[1]) : 3;

  const compound = splitCompoundMovements(lines);
  if (compound) {
    // 复合动作几个动作的次数经常不一样（比如这次 Front Squat 是 5 次、
    // Turkish Get-Up 是 2/2），不能只猜第一个动作的次数当全局次数——
    // 次数栏留空让用户自己填，不强行预填错的数字。
    return Array.from({ length: n }, (_, i) => ({
      n: i + 1,
      movements: compound.map((l) => ({ label: shortMovementLabel(l), plan: l, weight: "" })),
      reps: "",
    }));
  }

  const planLine = lines.find((l) => l) || section.score || "";
  const reps = repsFromPlan(planLine);
  const perRowPlan = stripSetsCountSuffix(planLine);
  return Array.from({ length: n }, (_, i) => ({
    n: i + 1,
    movements: [{ label: "", plan: perRowPlan, weight: "" }],
    reps,
  }));
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
      // 复合动作（movements.length > 1）要给每个动作各自一个"重量"表头/
      // 输入框；同一个 section 的所有行都来自同一个 buildSetRows 调用，
      // 形状一致，看第一行就知道要不要展开成多列
      const movementLabels = state.rows[0]?.movements.map((m) => m.label) || [""];
      const weightHeaders =
        movementLabels.length > 1
          ? movementLabels.map((l) => `<th>${escapeHtml(l)}重量</th>`).join("")
          : "<th>重量</th>";
      body.innerHTML = `
        <table class="set-table">
          <thead><tr><th>组</th><th>计划</th>${weightHeaders}<th>次数</th></tr></thead>
          <tbody>
            ${state.rows
              .map(
                (r, i) => `<tr>
                  <td>${r.n}</td>
                  <td class="set-table__plan">${escapeHtml(r.movements.map((m) => m.plan).join(" + ")) || "—"}</td>
                  ${r.movements
                    .map(
                      (m, mi) =>
                        `<td><input type="text" inputmode="decimal" class="set-table__input" data-row="${i}" data-movement="${mi}" placeholder="重量" value="${m.weight || ""}" /></td>`,
                    )
                    .join("")}
                  <td><input type="text" inputmode="numeric" class="set-table__input" data-row="${i}" data-field="reps" placeholder="次数" value="${r.reps || ""}" /></td>
                </tr>`,
              )
              .join("")}
          </tbody>
        </table>
      `;
      body.querySelectorAll("[data-movement]").forEach((input) => {
        input.addEventListener("input", () => {
          state.rows[Number(input.dataset.row)].movements[Number(input.dataset.movement)].weight =
            input.value;
        });
      });
      body.querySelectorAll("[data-field='reps']").forEach((input) => {
        input.addEventListener("input", () => {
          state.rows[Number(input.dataset.row)].reps = input.value;
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
          // 一组里但凡有一个动作填了重量就算做过这组——"完全没填任何一个
          // 动作的重量"才当用户没做/没记，跳过（不能只看 reps，次数现在
          // 默认从计划里预填，永远有值，不能当"填过东西"的信号）
          const doneMovements = r.movements.filter((m) => m.weight);
          if (doneMovements.length === 0) continue;
          const repsPart = r.reps ? `1x${r.reps}` : "";
          if (r.movements.length > 1) {
            // 复合动作：每个动作的重量分开列出来，不能揉成一行——合在一起
            // 没法知道哪个数字对应哪个动作
            const movementParts = doneMovements
              .map((m) => `${m.label || m.plan}: ${m.weight}lb`)
              .join("，");
            lines.push(`${section.title} ${movementParts} ${repsPart}`.trim());
          } else {
            const only = r.movements[0];
            const weightPart = only.weight ? `${only.weight}lb` : "";
            const planPart = only.plan ? `（计划：${only.plan}）` : "";
            lines.push(`${section.title} ${weightPart} ${repsPart} ${planPart}`.trim());
          }
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

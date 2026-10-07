// 今日 tab（SPEC.md §1）：日历（周/月视图切换，今天与选中状态分开表示）+
// 所选日期的待办（可勾选） + 训练记录（纯展示，不可跳转） + 今天的想法
// （纯展示，不在这里输入——输入统一去想法 tab，用户明确要求）。
import { renderWeekGrid, renderMonthGrid } from "../calendar.js";
import { todayStr, formatMonthTitle, formatMonthDay, addDays, addMonths } from "../dateutils.js";
import { listTodos, listWorkoutsForDay, listIdeasForDay } from "../data.js";
import { bindTodoCheckbox } from "../todorow.js";

export async function render(container) {
  let mode = "week"; // "week" | "month"
  let selected = todayStr();
  let anchor = todayStr(); // 当前周/月视图定位在哪个日期上

  container.innerHTML = `
    <div class="cal-header">
      <div class="cal-nav">
        <button type="button" class="cal-nav-btn" data-nav="-1">‹</button>
        <span class="cal-nav-title"></span>
        <button type="button" class="cal-nav-btn" data-nav="1">›</button>
      </div>
      <div class="cal-mode-toggle">
        <button type="button" class="cal-mode-btn" data-mode="week">周</button>
        <button type="button" class="cal-mode-btn" data-mode="month">月</button>
      </div>
    </div>
    <div class="cal-grid"></div>

    <section class="today-todos">
      <h2>待办</h2>
      <ul class="todo-list"></ul>
    </section>

    <section class="today-workout">
      <h2>训练</h2>
      <div class="today-workout__body"></div>
    </section>

    <section class="today-idea">
      <h2>今天的想法</h2>
      <div class="today-idea__body"></div>
    </section>
  `;

  const navTitle = container.querySelector(".cal-nav-title");
  const grid = container.querySelector(".cal-grid");
  const modeBtns = container.querySelectorAll(".cal-mode-btn");
  const todoList = container.querySelector(".today-todos .todo-list");
  const workoutBody = container.querySelector(".today-workout__body");
  const ideaBody = container.querySelector(".today-idea__body");

  function paintCalendar() {
    modeBtns.forEach((b) => b.classList.toggle("cal-mode-btn--active", b.dataset.mode === mode));
    if (mode === "week") {
      navTitle.textContent = formatMonthTitle(anchor);
      renderWeekGrid(grid, anchor, { selected, onPick: pickDate });
    } else {
      navTitle.textContent = formatMonthTitle(anchor);
      renderMonthGrid(grid, anchor, { selected, onPick: pickDate });
    }
  }

  function pickDate(dateStr) {
    selected = dateStr;
    anchor = dateStr;
    paintCalendar();
    refreshDayContent();
  }

  modeBtns.forEach((btn) =>
    btn.addEventListener("click", () => {
      mode = btn.dataset.mode;
      paintCalendar();
    }),
  );

  container.querySelectorAll(".cal-header .cal-nav-btn").forEach((btn) =>
    btn.addEventListener("click", () => {
      const dir = Number(btn.dataset.nav);
      anchor = mode === "week" ? addDays(anchor, dir * 7) : addMonths(anchor, dir);
      paintCalendar();
    }),
  );

  // 没做完的待办不该一过当天就消失——不然"提醒"这个功能就白做了（用户明确
  // 反馈过这个问题，具体场景是约课提醒：今天点了约下周的课，没点完成的话，
  // 第二天应该还在提醒，直到真做完，或者这节课已经上过了）。所以选中这天，
  // 显示的是「正好是这天的」加上「更早、还没做完、还没'过期'的」两类：
  // - 当天的：不管做没做完都要显示（能看到自己已经勾掉的）
  // - 更早的未完成项：结转过来继续提醒，除非 class_day 标着这节课已经上过了
  //   （没有 class_day 的普通待办没有这个"过期"概念，一直结转到做完为止）
  function isExpiredReminder(t) {
    return Boolean(t.class_day) && selected > t.class_day;
  }

  async function refreshDayContent() {
    const [todos, workouts] = await Promise.all([listTodos(), listWorkoutsForDay(selected)]);
    const dayTodos = todos.filter(
      (t) => t.day === selected || (t.day < selected && !t.done && !isExpiredReminder(t)),
    );

    todoList.innerHTML = "";
    if (dayTodos.length === 0) {
      todoList.innerHTML = `<li class="empty-hint">这天没有待办</li>`;
    }
    for (const t of dayTodos) {
      todoList.appendChild(renderTodoCheckRow(t, refreshDayContent, t.day !== selected));
    }

    workoutBody.innerHTML = "";
    if (workouts.length === 0) {
      workoutBody.innerHTML = `<p class="empty-hint">这天没有训练记录</p>`;
    }
    for (const w of workouts) {
      workoutBody.appendChild(renderWorkoutCard(w));
    }
  }

  // 今天的想法：纯展示，不在这里输入——想记点什么去想法 tab（跟 selected
  // 日期无关，这里固定是"今天"，不跟着日历选中的日期走）
  async function paintTodayIdea() {
    const ideas = await listIdeasForDay(todayStr());
    ideaBody.innerHTML = "";
    if (ideas.length === 0) {
      const empty = document.createElement("a");
      empty.className = "today-idea__empty";
      empty.href = "#ideas";
      empty.textContent = "今天有什么想到的想记下来的吗？去想法里写吧";
      ideaBody.appendChild(empty);
      return;
    }
    for (const idea of ideas) {
      const p = document.createElement("p");
      p.className = "today-idea__view";
      p.textContent = idea.text;
      ideaBody.appendChild(p);
    }
  }

  paintCalendar();
  await refreshDayContent();
  await paintTodayIdea();
}

// carriedOver：true 表示这一行不是"选中这天新增的"，是更早哪天没做完、
// 结转过来的——加个日期小标签，让用户看得出这是哪天欠下的，不是当天的
function renderTodoCheckRow(todo, onChange, carriedOver) {
  const li = document.createElement("li");
  li.className = "todo-row";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = todo.done;
  bindTodoCheckbox(checkbox, todo, onChange);

  const label = document.createElement("span");
  label.className = "todo-row__title";
  label.textContent = todo.title;

  li.append(checkbox, label);

  if (carriedOver) {
    const badge = document.createElement("span");
    badge.className = "todo-row__day";
    badge.textContent = `${formatMonthDay(todo.day)} 未完成`;
    li.append(badge);
  }

  return li;
}

// 纯展示：标题 + 动作行 + 肌群标签，不可点击跳转（SPEC.md §1.2 明确要求）
function renderWorkoutCard(workout) {
  const card = document.createElement("div");
  card.className = "workout-card";

  const title = document.createElement("h3");
  title.textContent = workout.title || "训练记录";
  card.appendChild(title);

  const body = document.createElement("pre");
  body.className = "workout-card__body";
  body.textContent = workout.body;
  card.appendChild(body);

  const muscles = (workout.muscles || []).filter((m) => m.key !== "cardio");
  if (muscles.length > 0) {
    const tags = document.createElement("div");
    tags.className = "muscle-tags";
    for (const m of muscles) {
      const tag = document.createElement("span");
      tag.className = "muscle-tag";
      tag.textContent = m.name;
      tags.appendChild(tag);
    }
    card.appendChild(tags);
  }

  return card;
}

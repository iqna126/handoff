// 今日 tab（SPEC.md §1）：日历（周/月视图切换，今天与选中状态分开表示）+
// 所选日期的待办（可勾选） + 训练记录（纯展示，不可跳转） + 想法快速输入
// （有内容时才出现保存按钮）。
import { renderWeekGrid, renderMonthGrid } from "../calendar.js";
import { todayStr, formatMonthTitle, addDays, addMonths } from "../dateutils.js";
import { listTodos, setTodoDone, listWorkoutsForDay, addIdea, listMarkedDays } from "../data.js";

export async function render(container) {
  let mode = "week"; // "week" | "month"
  let selected = todayStr();
  let anchor = todayStr(); // 当前周/月视图定位在哪个日期上
  let marked = new Set();

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
      <h2>想法</h2>
      <form class="idea-quick-form">
        <input type="text" class="idea-quick-input" placeholder="有什么想法？" />
        <button type="submit" hidden>保存</button>
      </form>
    </section>
  `;

  const navTitle = container.querySelector(".cal-nav-title");
  const grid = container.querySelector(".cal-grid");
  const modeBtns = container.querySelectorAll(".cal-mode-btn");
  const todoList = container.querySelector(".today-todos .todo-list");
  const workoutBody = container.querySelector(".today-workout__body");
  const ideaForm = container.querySelector(".idea-quick-form");
  const ideaInput = container.querySelector(".idea-quick-input");
  const ideaSaveBtn = ideaForm.querySelector("button[type=submit]");

  function paintCalendar() {
    modeBtns.forEach((b) => b.classList.toggle("cal-mode-btn--active", b.dataset.mode === mode));
    if (mode === "week") {
      navTitle.textContent = formatMonthTitle(anchor);
      renderWeekGrid(grid, anchor, { selected, marked, onPick: pickDate });
    } else {
      navTitle.textContent = formatMonthTitle(anchor);
      renderMonthGrid(grid, anchor, { selected, marked, onPick: pickDate });
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

  async function refreshDayContent() {
    const [todos, workouts] = await Promise.all([listTodos(), listWorkoutsForDay(selected)]);
    const dayTodos = todos.filter((t) => t.day === selected);

    todoList.innerHTML = "";
    if (dayTodos.length === 0) {
      todoList.innerHTML = `<li class="empty-hint">这天没有待办</li>`;
    }
    for (const t of dayTodos) {
      todoList.appendChild(renderTodoCheckRow(t, refreshDayContent));
    }

    workoutBody.innerHTML = "";
    if (workouts.length === 0) {
      workoutBody.innerHTML = `<p class="empty-hint">这天没有训练记录</p>`;
    }
    for (const w of workouts) {
      workoutBody.appendChild(renderWorkoutCard(w));
    }
  }

  ideaInput.addEventListener("input", () => {
    ideaSaveBtn.hidden = ideaInput.value.trim().length === 0;
  });

  ideaForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = ideaInput.value.trim();
    if (!text) return;
    await addIdea({ text, day: todayStr() });
    ideaInput.value = "";
    ideaSaveBtn.hidden = true;
  });

  marked = await listMarkedDays();
  paintCalendar();
  await refreshDayContent();
}

function renderTodoCheckRow(todo, onChange) {
  const li = document.createElement("li");
  li.className = "todo-row";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = todo.done;
  checkbox.addEventListener("change", async () => {
    await setTodoDone(todo.id, checkbox.checked);
    await onChange();
  });

  const label = document.createElement("span");
  label.className = "todo-row__title";
  label.textContent = todo.title;

  li.append(checkbox, label);
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

  const muscles = workout.muscles || [];
  if (muscles.length > 0) {
    const tags = document.createElement("div");
    tags.className = "muscle-tags";
    for (const m of muscles) {
      const tag = document.createElement("span");
      tag.className = "muscle-tag";
      tag.textContent = `${m.name} ×${m.n}`;
      tags.appendChild(tag);
    }
    card.appendChild(tags);
  }

  return card;
}

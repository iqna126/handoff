// 待办 tab（SPEC.md §2）：输入框 + 日期按钮，Enter 添加；自定义日期选择器
// （周一开始，含"今天"快捷按钮）；未完成/已完成分组；删除二次确认。
import { listTodos, addTodo, setTodoDone, deleteTodo } from "../data.js";
import { renderMonthGrid } from "../calendar.js";
import { todayStr, formatMonthDay, formatMonthTitle, addMonths } from "../dateutils.js";

export async function render(container) {
  let pickedDate = todayStr();
  let pickerMonth = todayStr();
  let pickerOpen = false;

  container.innerHTML = `
    <form class="todo-form">
      <input type="text" class="todo-input" placeholder="添加待办…" required />
      <button type="button" class="todo-date-btn"></button>
      <div class="todo-picker" hidden>
        <div class="cal-nav">
          <button type="button" class="cal-nav-btn" data-nav="-1">‹</button>
          <span class="cal-nav-title"></span>
          <button type="button" class="cal-nav-btn" data-nav="1">›</button>
        </div>
        <div class="cal-grid"></div>
        <button type="button" class="todo-picker-today">今天</button>
      </div>
    </form>
    <section>
      <h2>未完成</h2>
      <ul class="todo-list todo-list--open"></ul>
    </section>
    <section>
      <h2>已完成</h2>
      <ul class="todo-list todo-list--done"></ul>
    </section>
  `;

  const form = container.querySelector(".todo-form");
  const input = container.querySelector(".todo-input");
  const dateBtn = container.querySelector(".todo-date-btn");
  const picker = container.querySelector(".todo-picker");
  const pickerGrid = picker.querySelector(".cal-grid");
  const pickerTitle = picker.querySelector(".cal-nav-title");
  const openList = container.querySelector(".todo-list--open");
  const doneList = container.querySelector(".todo-list--done");

  function dateBtnLabel() {
    return pickedDate === todayStr() ? "今天" : formatMonthDay(pickedDate);
  }

  function paintPicker() {
    dateBtn.textContent = dateBtnLabel();
    pickerTitle.textContent = formatMonthTitle(pickerMonth);
    renderMonthGrid(pickerGrid, pickerMonth, {
      selected: pickedDate,
      onPick: (d) => {
        pickedDate = d;
        pickerOpen = false;
        picker.hidden = true;
        paintPicker();
      },
    });
  }
  paintPicker();

  dateBtn.addEventListener("click", () => {
    pickerOpen = !pickerOpen;
    picker.hidden = !pickerOpen;
    if (pickerOpen) {
      pickerMonth = pickedDate;
      paintPicker();
    }
  });

  picker.querySelectorAll(".cal-nav-btn").forEach((btn) =>
    btn.addEventListener("click", () => {
      pickerMonth = addMonths(pickerMonth, Number(btn.dataset.nav));
      paintPicker();
    }),
  );

  picker.querySelector(".todo-picker-today").addEventListener("click", () => {
    pickedDate = todayStr();
    pickerMonth = todayStr();
    pickerOpen = false;
    picker.hidden = true;
    paintPicker();
  });

  // 点选择器外面关掉它——不用全屏遮罩，避免 SPEC.md §9.1 那一堆移动端弹层坑
  document.addEventListener("click", (e) => {
    if (pickerOpen && !form.contains(e.target)) {
      pickerOpen = false;
      picker.hidden = true;
    }
  });

  async function refresh() {
    const todos = await listTodos();
    openList.innerHTML = "";
    doneList.innerHTML = "";
    for (const t of todos) {
      (t.done ? doneList : openList).appendChild(renderTodoRow(t, refresh));
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = input.value.trim();
    if (!title) return;
    await addTodo({ title, day: pickedDate });
    input.value = "";
    await refresh();
  });

  await refresh();
}

function renderTodoRow(todo, onChange) {
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

  const day = document.createElement("span");
  day.className = "todo-row__day";
  day.textContent = formatMonthDay(todo.day);

  const del = document.createElement("button");
  del.type = "button";
  del.className = "todo-row__delete";
  del.textContent = "删除";
  del.addEventListener("click", async () => {
    if (!confirm(`删除待办「${todo.title}」？`)) return;
    await deleteTodo(todo.id);
    await onChange();
  });

  li.append(checkbox, label, day, del);
  return li;
}

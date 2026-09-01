// 周一开始的日历网格，today/选中两种状态独立表示（SPEC.md §1.1）。
// 用在「今日」tab（周/月视图切换）和待办的自定义日期选择器（只用月视图）上，
// 所以拆成一个纯渲染函数，两边共用。
import {
  WEEKDAY_LABELS,
  weekDates,
  monthGridDates,
  isSameMonth,
  formatDayOfMonth,
  todayStr,
} from "./dateutils.js";

// dates: 要渲染的日期字符串数组（7 个或补齐后的整月）
// opts: { selected, refMonth: 用于判断是否"非本月"变灰, onPick(dateStr) }
export function renderDateGrid(container, dates, opts) {
  const today = todayStr();
  container.innerHTML = "";
  container.className = "cal-grid";

  for (const label of WEEKDAY_LABELS) {
    const h = document.createElement("div");
    h.className = "cal-weekday";
    h.textContent = label;
    container.appendChild(h);
  }

  for (const dateStr of dates) {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "cal-cell";
    if (opts.refMonth && !isSameMonth(dateStr, opts.refMonth)) cell.classList.add("cal-cell--dim");
    if (dateStr === today) cell.classList.add("cal-cell--today");
    if (dateStr === opts.selected) cell.classList.add("cal-cell--selected");

    const num = document.createElement("span");
    num.textContent = String(formatDayOfMonth(dateStr));
    cell.appendChild(num);

    cell.addEventListener("click", () => opts.onPick(dateStr));
    container.appendChild(cell);
  }
}

export function renderWeekGrid(container, weekAnchor, opts) {
  renderDateGrid(container, weekDates(weekAnchor), { ...opts, refMonth: null });
}

export function renderMonthGrid(container, monthAnchor, opts) {
  renderDateGrid(container, monthGridDates(monthAnchor), { ...opts, refMonth: monthAnchor });
}

// 待办 tab 和训练 tab 共用的"按钮 + 月历弹层"日期选择器（周一开始，含
// "今天"快捷按钮，点外面关闭）。两边原来各写了一份、行为要求完全一致，
// 差别只在绑定的日期状态和选中后要做的副作用，所以把这部分抽成一个小部件，
// 调用方负责提供 DOM 节点、怎么读当前日期、选中后怎么处理。
import { renderMonthGrid } from "./calendar.js";
import { todayStr, formatMonthDay, formatMonthTitle, addMonths } from "./dateutils.js";

// dateBtn/picker：`.todo-date-btn`/`.todo-picker` 这套固定结构的 DOM 节点
// outsideClickEl：点这个元素之外的地方要收起弹层
// getDate()：读当前选中的日期字符串
// onPick(dateStr)：日期被选中后的副作用（更新状态、联动刷新等），可以是 async
export function createDatePicker({ dateBtn, picker, outsideClickEl, getDate, onPick }) {
  let pickerMonth = getDate();
  let pickerOpen = false;

  const pickerGrid = picker.querySelector(".cal-grid");
  const pickerTitle = picker.querySelector(".cal-nav-title");

  function paint() {
    const current = getDate();
    dateBtn.textContent = current === todayStr() ? "今天" : formatMonthDay(current);
    pickerTitle.textContent = formatMonthTitle(pickerMonth);
    renderMonthGrid(pickerGrid, pickerMonth, {
      selected: current,
      onPick: (d) => {
        pickerOpen = false;
        picker.hidden = true;
        onPick(d);
        paint();
      },
    });
  }

  dateBtn.addEventListener("click", () => {
    pickerOpen = !pickerOpen;
    picker.hidden = !pickerOpen;
    if (pickerOpen) {
      pickerMonth = getDate();
      paint();
    }
  });

  picker.querySelectorAll(".cal-nav-btn").forEach((btn) =>
    btn.addEventListener("click", () => {
      pickerMonth = addMonths(pickerMonth, Number(btn.dataset.nav));
      paint();
    }),
  );

  picker.querySelector(".todo-picker-today").addEventListener("click", () => {
    pickerOpen = false;
    picker.hidden = true;
    pickerMonth = todayStr();
    onPick(todayStr());
    paint();
  });

  document.addEventListener("click", (e) => {
    if (pickerOpen && !outsideClickEl.contains(e.target)) {
      pickerOpen = false;
      picker.hidden = true;
    }
  });

  paint();
  // 有的调用方会在选择器自己的 onPick 之外改动日期（比如训练 tab 载入
  // 一条历史记录时直接赋值 recordDay）——这种情况下需要手动触发重绘
  return { repaint: paint };
}

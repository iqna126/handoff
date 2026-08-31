// 日期工具：全部按周一为一周的第一天（SPEC.md §1.1/§2），不依赖 <input type="date">
// 的系统语言设置——那个东西的一周起始日改不了。

export const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

export function todayStr() {
  return toDateStr(new Date());
}

export function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseDateStr(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(dateStr, n) {
  const d = parseDateStr(dateStr);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

// JS 的 getDay() 是周日=0，转成"周一=0...周日=6"方便算这周的周一在哪
function mondayIndex(jsDay) {
  return (jsDay + 6) % 7;
}

export function startOfWeek(dateStr) {
  const d = parseDateStr(dateStr);
  return addDays(dateStr, -mondayIndex(d.getDay()));
}

export function weekDates(dateStr) {
  const start = startOfWeek(dateStr);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

// 月视图：整月 + 补齐首尾成完整周（周一开始）
export function monthGridDates(dateStr) {
  const d = parseDateStr(dateStr);
  const firstOfMonth = toDateStr(new Date(d.getFullYear(), d.getMonth(), 1));
  const lastOfMonth = toDateStr(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  const gridStart = startOfWeek(firstOfMonth);
  const gridEnd = addDays(startOfWeek(lastOfMonth), 6);
  const out = [];
  let cur = gridStart;
  while (cur <= gridEnd) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

export function addMonths(dateStr, n) {
  const d = parseDateStr(dateStr);
  return toDateStr(new Date(d.getFullYear(), d.getMonth() + n, 1));
}

export function isSameMonth(dateStr, refStr) {
  const a = parseDateStr(dateStr);
  const b = parseDateStr(refStr);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export function formatMonthDay(dateStr) {
  const d = parseDateStr(dateStr);
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, "0")}`;
}

export function formatMonthTitle(dateStr) {
  const d = parseDateStr(dateStr);
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`;
}

export function formatDayOfMonth(dateStr) {
  return parseDateStr(dateStr).getDate();
}

// 想法列表用的"可读相对时间"，如 "8月25日 14:30"（SPEC.md §3）
export function formatReadableDateTime(isoString) {
  const d = new Date(isoString);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`;
}

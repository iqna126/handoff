// 还没做的 tab 先占位，诚实说明"还没做"，不假装有内容（SPEC.md §8.4 的
// 精神同样适用于开发中占位——不编造、不留空白到让人以为是 bug）。
export function render(container, label) {
  container.innerHTML = `<p class="empty-hint">${label} 还在做，先别急。</p>`;
}

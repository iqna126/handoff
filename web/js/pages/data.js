// 数据管理（我的 → 数据）：按用户勾选的分类清空，两步走——先选要清哪些，
// 再有一个专门的确认页面把要删的东西列清楚、要求勾一次"我确认"才能点
// 最终按钮。用户明确要求不需要导出/导入 JSON（那是给老版单文件 App 迁移
// 数据用的，本项目从一开始就不是迁移场景，见 DESIGN.md §10），只需要
// 清空数据这一个操作。
import { countUserData, clearUserData, CLEARABLE_TABLES } from "../data.js";
import { showAlert, showConfirm } from "../dialog.js";

export async function render(container) {
  const counts = await countUserData();
  let selected = new Set();

  function paintSelect() {
    container.innerHTML = `
      <p class="entry-row__hint" style="margin:0 0 12px">勾选要清空的内容——只清你勾的这些，账号本身不受影响。</p>
      <div class="data-clear-list"></div>
      <button type="button" class="btn ghost danger" data-next style="width:100%;margin-top:14px" disabled>下一步</button>
    `;
    const list = container.querySelector(".data-clear-list");
    list.innerHTML = Object.entries(CLEARABLE_TABLES)
      .map(
        ([table, label]) => `
        <label class="pr-scan-row">
          <input type="checkbox" data-clear-check="${table}" />
          <span class="pr-scan-row__name">${label}</span>
          <span class="pr-scan-row__vals">${counts[table]} 条</span>
        </label>`,
      )
      .join("");
    const nextBtn = container.querySelector("[data-next]");
    list.querySelectorAll("[data-clear-check]").forEach((box) => {
      box.addEventListener("change", () => {
        if (box.checked) selected.add(box.dataset.clearCheck);
        else selected.delete(box.dataset.clearCheck);
        nextBtn.disabled = selected.size === 0;
      });
    });
    nextBtn.addEventListener("click", paintConfirm);
  }

  // 确认页：把要删的东西明确列出来（分类 + 条数），要求先勾一次"我确认"
  // 才能点最终按钮，点了之后还有一道 showConfirm 弹窗兜底——这个操作不可
  // 恢复，摩擦故意比别的删除操作（比如删一条待办）多一些。
  function paintConfirm() {
    const tables = [...selected];
    container.innerHTML = `
      <button type="button" class="back-btn" data-back>‹ 重新选择</button>
      <h1 class="display sm" style="margin:10px 0;color:var(--signal)">确认清空</h1>
      <p style="line-height:1.7">以下内容将被永久删除，<strong>无法恢复</strong>：</p>
      <ul style="margin:8px 0 16px;padding-left:20px;line-height:1.8">
        ${tables.map((t) => `<li>${CLEARABLE_TABLES[t]}（${counts[t]} 条）</li>`).join("")}
      </ul>
      <label style="display:flex;align-items:center;gap:8px;margin-bottom:14px;cursor:pointer">
        <input type="checkbox" data-ack />
        <span>我确认要删除以上内容，此操作不可恢复</span>
      </label>
      <button type="button" class="btn ghost danger" data-confirm style="width:100%" disabled>永久清空</button>
    `;
    container.querySelector("[data-back]").addEventListener("click", paintSelect);
    const ackBox = container.querySelector("[data-ack]");
    const confirmBtn = container.querySelector("[data-confirm]");
    ackBox.addEventListener("change", () => {
      confirmBtn.disabled = !ackBox.checked;
    });
    confirmBtn.addEventListener("click", async () => {
      if (!(await showConfirm("真的要清空吗？这是最后一次确认。"))) return;
      confirmBtn.disabled = true;
      try {
        await clearUserData(tables);
        await showAlert("已清空");
        location.hash = "#profile";
      } catch (err) {
        confirmBtn.disabled = false;
        await showAlert(`清空失败：${err.message}`);
      }
    });
  }

  paintSelect();
}

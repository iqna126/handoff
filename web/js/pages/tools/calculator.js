// 配重计算（SPEC.md §8.2）：输入 1RM → 各百分比重量，直接算，四舍五入保留
// 两位小数——不做配片取整（用户明确要求去掉，杆重只是让人"大概心里有数"，
// 不需要精确到能不能配出来）。可从 PR 墙一键带入。
//
// 打开时用全局默认单位（我的 → 设置）起手，但这里的 LB/KG 按钮只是"临时
// 换算看一眼"，点了不会改掉全局默认——用户明确反馈过，在这里点一下 KG
// 结果把设置里的默认单位也改掉了，很意外。只有设置页自己才能改默认单位。
//
// 单位换算的核心不变量（SPEC.md §0.2）：内部只认 kgValue 这一个全精度的
// 数，input 框里的字符串只是它的显示形态。切换单位绝不能拿"界面上已经
// 四舍五入过的字符串"反推——那样滑动几次单位就会跟原始输入对不上
// （125.25 lb 会飘到 125.24 lb 这种），必须全程从 kgValue 重新格式化。
import { listPRs, getUnitPref } from "../../data.js";
import { toDisplay, fromDisplay, formatWeight, kgToLb } from "../../units.js";

const PCTS = [50, 60, 70, 75, 80, 85, 90, 95, 100, 105];

export async function render(container, seed = {}) {
  let unit = seed.unit ?? (await getUnitPref());
  let kgValue = seed.kgValue ?? null; // 唯一的真相来源，永远是 kg，永远不四舍五入

  const catalog = await fetch("/data/catalog.json").then((r) => r.json());
  const prs = await listPRs();
  const prChips = prs
    .map((p) => ({ pr: p, meta: catalog.PR_LIST.find((x) => x.k === p.movement_key) }))
    .filter((x) => x.meta);

  container.innerHTML = `
    <div class="cal-header" style="margin-bottom:14px">
      <span class="entry-row__hint">1RM 重量</span>
      <button type="button" class="unit-toggle" data-unit-toggle></button>
    </div>
    <div class="big-input">
      <input type="text" inputmode="decimal" class="calc-input" value="${kgValue == null ? "" : toDisplay(kgValue, unit)}" />
      <span class="calc-unit-label">${unit}</span>
    </div>
    <div class="chip-row calc-pr-chips"></div>
    <div class="pct-grid"></div>
  `;

  const input = container.querySelector(".calc-input");
  const unitBtn = container.querySelector("[data-unit-toggle]");
  const pctGrid = container.querySelector(".pct-grid");
  const prChipsEl = container.querySelector(".calc-pr-chips");

  function paintUnitBtn() {
    unitBtn.innerHTML = `<span class="${unit === "lb" ? "on" : ""}">LB</span> / <span class="${unit === "kg" ? "on" : ""}">KG</span>`;
  }

  function paintPrChips() {
    prChipsEl.innerHTML = prChips
      .map(
        ({ pr, meta }) =>
          `<button type="button" class="chip" data-pr="${pr.movement_key}">${meta.code} ${toDisplay(pr.kg, unit)}</button>`,
      )
      .join("");
    prChipsEl.querySelectorAll("[data-pr]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const rec = prChips.find((x) => x.pr.movement_key === btn.dataset.pr).pr;
        kgValue = rec.kg;
        input.value = toDisplay(kgValue, unit);
        paintPcts();
      });
    });
  }

  function paintPcts() {
    pctGrid.innerHTML = PCTS.map((pct) => {
      if (kgValue == null) {
        return `<div class="pct-cell ${pct === 100 ? "pct-cell--hi" : ""}">
          <div class="pct-cell__pct">${pct}%</div><div class="pct-cell__val">—</div>
        </div>`;
      }
      const kg = (kgValue * pct) / 100;
      const value = unit === "kg" ? kg : kgToLb(kg);
      return `<div class="pct-cell ${pct === 100 ? "pct-cell--hi" : ""}">
        <div class="pct-cell__pct">${pct}%</div>
        <div class="pct-cell__val">${formatWeight(value)}</div>
      </div>`;
    }).join("");
  }

  unitBtn.addEventListener("click", () => {
    const newUnit = unit === "kg" ? "lb" : "kg";
    // 只换算当前这次看的显示单位，不碰全局默认设置。kgValue 本身不用
    // 换算——它一直是 kg，只是显示格式跟着单位变；PR 显示的数字也要跟着
    // 单位变，重新渲染一整页更省事可靠。
    render(container, { unit: newUnit, kgValue }).catch((err) => {
      container.innerHTML = `<p class="error-hint">切换失败：${err.message}</p>`;
    });
  });

  input.addEventListener("input", () => {
    kgValue = fromDisplay(input.value, unit);
    paintPcts();
  });

  paintUnitBtn();
  paintPrChips();
  paintPcts();
}

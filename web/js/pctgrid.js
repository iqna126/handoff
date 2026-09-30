// PR 墙和配重计算器共用的百分比重量表。
import { kgToLb, formatWeight } from "./units.js";

const PCTS = [50, 60, 70, 75, 80, 85, 90, 95, 100, 105];

// baseKg 为 null 时（还没填 1RM）每一格都显示"—"。
export function renderPctGrid(pctGridEl, baseKg, unit) {
  pctGridEl.innerHTML = PCTS.map((pct) => {
    if (baseKg == null) {
      return `<div class="pct-cell ${pct === 100 ? "pct-cell--hi" : ""}">
        <div class="pct-cell__pct">${pct}%</div><div class="pct-cell__val">—</div>
      </div>`;
    }
    const kg = (baseKg * pct) / 100;
    const value = unit === "kg" ? kg : kgToLb(kg);
    return `<div class="pct-cell ${pct === 100 ? "pct-cell--hi" : ""}">
      <div class="pct-cell__pct">${pct}%</div>
      <div class="pct-cell__val">${formatWeight(value)}</div>
    </div>`;
  }).join("");
}

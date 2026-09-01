// 配重计算（SPEC.md §8.2）：输入 1RM → 各百分比配重，取整到实际能配出来的
// 重量（§0.3），可从 PR 墙一键带入。KG/LB 用全局单位设置（不是这个页面自己
// 单独存一份——切换要跟 PR 墙保持一致）。
//
// 单位换算的核心不变量（SPEC.md §0.2）：内部只认 kgValue 这一个全精度的
// 数，input 框里的字符串只是它的显示形态。切换单位绝不能拿"界面上已经
// 四舍五入过的字符串"反推——那样滑动几次单位就会跟原始输入对不上
// （125.25 lb 会飘到 125.24 lb 这种），必须全程从 kgValue 重新格式化。
import { listPRs, getUnitPref, setUnitPref } from "../../data.js";
import {
  toDisplay,
  fromDisplay,
  formatWeight,
  kgToLb,
  roundToPlates,
  getSavedBar,
  saveBar,
  EQUIPMENT,
} from "../../units.js";

const PCTS = [50, 60, 70, 75, 80, 85, 90, 95, 100, 105];

export async function render(container, seed = {}) {
  let unit = seed.unit ?? (await getUnitPref());
  let bar = getSavedBar(unit);
  let kgValue = seed.kgValue ?? null; // 唯一的真相来源，永远是 kg，永远不四舍五入
  let expanded = null; // 当前展开配片明细的百分比

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
    <div class="chip-row" style="margin-top:0">
      ${EQUIPMENT[unit].bars
        .map((b) => `<button type="button" class="chip" data-bar="${b}">杆 ${b}${unit}</button>`)
        .join("")}
    </div>
    <div class="pct-grid"></div>
    <div class="plate-breakdown"></div>
  `;

  const input = container.querySelector(".calc-input");
  const unitBtn = container.querySelector("[data-unit-toggle]");
  const pctGrid = container.querySelector(".pct-grid");
  const breakdown = container.querySelector(".plate-breakdown");
  const prChipsEl = container.querySelector(".calc-pr-chips");
  const barChips = container.querySelectorAll("[data-bar]");

  function targetInUnit(pct) {
    const kg = (kgValue * pct) / 100;
    return unit === "kg" ? kg : kgToLb(kg);
  }

  function paintUnitBtn() {
    unitBtn.innerHTML = `<span class="${unit === "lb" ? "on" : ""}">LB</span> / <span class="${unit === "kg" ? "on" : ""}">KG</span>`;
  }

  function paintBarChips() {
    barChips.forEach((c) => c.classList.toggle("chip--active", Number(c.dataset.bar) === bar));
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
      const { rounded } = roundToPlates(targetInUnit(pct), unit, bar);
      return `<button type="button" class="pct-cell ${pct === 100 ? "pct-cell--hi" : ""}" data-pct="${pct}">
        <div class="pct-cell__pct">${pct}%</div>
        <div class="pct-cell__val">${formatWeight(rounded)}</div>
      </button>`;
    }).join("");

    pctGrid.querySelectorAll("[data-pct]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const pct = Number(btn.dataset.pct);
        expanded = expanded === pct ? null : pct;
        paintBreakdown();
      });
    });
    paintBreakdown();
  }

  function paintBreakdown() {
    if (expanded == null || kgValue == null) {
      breakdown.textContent = "";
      return;
    }
    const { rounded, perSide } = roundToPlates(targetInUnit(expanded), unit, bar);
    const sides = perSide.length ? perSide.join(" + ") : "无（低于杆重）";
    breakdown.textContent = `${expanded}%：${formatWeight(rounded)}${unit} ＝ 杆 ${bar}${unit} ＋ 每边 ${sides}`;
  }

  unitBtn.addEventListener("click", async () => {
    const newUnit = unit === "kg" ? "lb" : "kg";
    await setUnitPref(newUnit).catch(() => {});
    // kgValue 本身不用换算——它一直是 kg，只是显示格式跟着单位变。
    // 杆重选项/PR 显示的数字也要跟着单位变，重新渲染一整页更省事可靠。
    // render() 是 async 的，这里没有 await 它（不阻塞点击），所以必须显式
    // 兜住失败，不然网络抖动时会变成没人处理的 promise rejection。
    render(container, { unit: newUnit, kgValue }).catch((err) => {
      container.innerHTML = `<p class="error-hint">切换失败：${err.message}</p>`;
    });
  });

  barChips.forEach((c) =>
    c.addEventListener("click", () => {
      bar = Number(c.dataset.bar);
      saveBar(unit, bar);
      paintBarChips();
      expanded = null;
      paintPcts();
    }),
  );

  input.addEventListener("input", () => {
    kgValue = fromDisplay(input.value, unit);
    paintPcts();
  });

  paintUnitBtn();
  paintBarChips();
  paintPrChips();
  paintPcts();
}

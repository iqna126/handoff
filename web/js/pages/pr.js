// PR 墙（SPEC.md §5）：14 个项目，1RM 输入 + 配重表（取整到实际能配出来的
// 重量，跟配重计算器共用同一套算法），KG/LB 用全局单位设置。
//
// 老版单文件 App 里有一个"从训练记录扫描 PR"的功能（§5.1），这里先不做——
// 它依赖训练记录里能解析出结构化的动作+重量，而训练记录编辑器/自动同步
// 三步流程这两条路径都还没做，扫描无源可扫，等那部分做完再回来接上。
import { listPRs, upsertPR, deletePR, getUnitPref, setUnitPref } from "../data.js";
import { toDisplay, fromDisplay, formatWeight, kgToLb, roundToPlates, getSavedBar } from "../units.js";

const PCTS = [50, 60, 70, 75, 80, 85, 90, 95, 100, 105];

export async function render(container) {
  const catalog = await fetch("/data/catalog.json").then((r) => r.json());
  let unit = await getUnitPref();
  let prs = await listPRs();
  let detailKey = null;

  function prMap() {
    const m = {};
    for (const p of prs) m[p.movement_key] = p;
    return m;
  }

  function paintList() {
    const map = prMap();
    container.innerHTML = `
      <div class="cal-header" style="margin-bottom:10px">
        <span class="entry-row__hint">${prs.length} / ${catalog.PR_LIST.length} 项有成绩</span>
        <button type="button" class="unit-toggle" data-unit-toggle>
          <span class="${unit === "lb" ? "on" : ""}">LB</span> / <span class="${unit === "kg" ? "on" : ""}">KG</span>
        </button>
      </div>
      <div class="pr-grid"></div>
    `;
    const grid = container.querySelector(".pr-grid");
    grid.innerHTML = catalog.PR_LIST.map((p) => {
      const rec = map[p.k];
      const v = rec ? toDisplay(rec.kg, unit) : null;
      return `<button type="button" class="pr-card ${v ? "" : "pr-card--blank"}" data-k="${p.k}">
        <span class="pr-card__code mono">${p.code}</span>
        <div class="pr-card__name">${p.n}</div>
        <div class="pr-card__value ${v ? "" : "pr-card__value--dash"}">${v != null ? v : "—"}</div>
      </button>`;
    }).join("");
    grid.querySelectorAll("[data-k]").forEach((btn) => {
      btn.addEventListener("click", () => {
        detailKey = btn.dataset.k;
        paintDetail();
      });
    });
    container.querySelector("[data-unit-toggle]").addEventListener("click", async () => {
      unit = unit === "kg" ? "lb" : "kg";
      await setUnitPref(unit).catch(() => {});
      paintList();
    });
  }

  function paintDetail() {
    const meta = catalog.PR_LIST.find((p) => p.k === detailKey);
    const rec = prMap()[detailKey];
    const initial = rec ? toDisplay(rec.kg, unit) : "";
    const bar = getSavedBar(unit);

    container.innerHTML = `
      <button type="button" class="back-btn" data-back>‹ PR 墙</button>
      <div class="cal-header" style="margin-bottom:6px">
        <div>
          <h1 class="display sm" style="margin:0">${meta.n}</h1>
          <span class="pr-card__code mono" style="display:inline-block;margin-top:6px">${meta.code}</span>
        </div>
      </div>
      <div class="big-input" style="margin-top:14px">
        <span style="color:var(--ink-soft);font-size:14px">1RM 重量</span>
        <input type="text" inputmode="decimal" class="pr-input" value="${initial}" />
      </div>
      <div class="pct-grid"></div>
      <div class="plate-breakdown"></div>
      <button type="button" class="btn" data-save style="width:100%;margin-top:6px">更新 PR 成绩</button>
      ${rec ? `<button type="button" class="btn ghost danger" data-remove style="width:100%;margin-top:8px">清除此项记录</button>` : ""}
    `;

    const input = container.querySelector(".pr-input");
    const pctGrid = container.querySelector(".pct-grid");
    const breakdown = container.querySelector(".plate-breakdown");
    let expanded = null;

    function paintPcts() {
      const base = fromDisplay(input.value, unit);
      pctGrid.innerHTML = PCTS.map((pct) => {
        if (base == null) {
          return `<div class="pct-cell ${pct === 100 ? "pct-cell--hi" : ""}">
            <div class="pct-cell__pct">${pct}%</div><div class="pct-cell__val">—</div>
          </div>`;
        }
        const kg = (base * pct) / 100;
        const targetInUnit = unit === "kg" ? kg : kgToLb(kg);
        const { rounded } = roundToPlates(targetInUnit, unit, bar);
        return `<button type="button" class="pct-cell ${pct === 100 ? "pct-cell--hi" : ""}" data-pct="${pct}">
          <div class="pct-cell__pct">${pct}%</div>
          <div class="pct-cell__val">${formatWeight(rounded)}</div>
        </button>`;
      }).join("");
      pctGrid.querySelectorAll("[data-pct]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const pct = Number(btn.dataset.pct);
          expanded = expanded === pct ? null : pct;
          paintBreakdown(base);
        });
      });
      paintBreakdown(base);
    }

    function paintBreakdown(base) {
      if (expanded == null || base == null) {
        breakdown.textContent = "";
        return;
      }
      const kg = (base * expanded) / 100;
      const targetInUnit = unit === "kg" ? kg : kgToLb(kg);
      const { rounded, perSide } = roundToPlates(targetInUnit, unit, bar);
      const sides = perSide.length ? perSide.join(" + ") : "无（低于杆重）";
      breakdown.textContent = `${expanded}%：${formatWeight(rounded)}${unit} ＝ 杆 ${bar}${unit} ＋ 每边 ${sides}`;
    }

    input.addEventListener("input", paintPcts);
    paintPcts();

    container.querySelector("[data-back]").addEventListener("click", () => {
      detailKey = null;
      paintList();
    });

    container.querySelector("[data-save]").addEventListener("click", async () => {
      const v = parseFloat(input.value);
      if (Number.isNaN(v) || v <= 0) {
        alert("填个数字");
        return;
      }
      const kg = fromDisplay(String(v), unit);
      const beat = rec && kg > rec.kg;
      await upsertPR(detailKey, kg);
      prs = await listPRs();
      detailKey = null;
      paintList();
      alert(beat ? "破纪录了 🎉" : "已更新");
    });

    const removeBtn = container.querySelector("[data-remove]");
    if (removeBtn) {
      removeBtn.addEventListener("click", async () => {
        if (!confirm(`清除「${meta.n}」的 PR 记录？`)) return;
        await deletePR(rec.id);
        prs = await listPRs();
        detailKey = null;
        paintList();
      });
    }
  }

  paintList();
}

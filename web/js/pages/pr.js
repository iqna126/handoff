// PR 墙（SPEC.md §5）：14 个项目，1RM 输入 + 百分比重量表（直接算，四舍
// 五入保留两位小数——不做配片取整，用户明确要求去掉）。
//
// 打开时用全局默认单位（我的 → 设置）起手，但页面上的 LB/KG 按钮只是
// "临时换算看一眼"，点了不改全局默认——用户明确反馈过，在这点一下 KG
// 会把设置里的默认单位也带着改掉，很意外。只有设置页自己才能改默认单位。
//
// 从训练记录扫描 PR（§5.1）：扫全部训练记录，找出比当前 PR 更重的成绩，
// 列出来问要不要批量更新——不需要用户重复手填，正常记录训练时 PR 自己浮出来。
import { listPRs, upsertPR, deletePR, getUnitPref, listAllWorkouts } from "../data.js";
import { toDisplay, fromDisplay, formatWeight, kgToLb } from "../units.js";
import { scanWorkoutsForPRs } from "../prscan.js";
import { showConfirm, showAlert } from "../dialog.js";

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
      <button type="button" class="btn ghost" data-scan style="width:100%;margin-bottom:10px">扫描训练记录找 PR</button>
      <p class="empty-hint" data-scan-hint hidden style="margin:0 0 10px"></p>
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
    container.querySelector("[data-unit-toggle]").addEventListener("click", () => {
      unit = unit === "kg" ? "lb" : "kg";
      paintList();
    });
    container.querySelector("[data-scan]").addEventListener("click", runScan);
  }

  // 扫描训练记录找 PR（SPEC.md §5.1）：找到比当前记录更重的，列出来问要不要
  // 批量更新；没找到更高的就在原地提示一行字，不弹窗打断——用户大概率是
  // 随手点一下看看，不是每次都真的期待有新 PR。
  async function runScan() {
    const scanBtn = container.querySelector("[data-scan]");
    const hint = container.querySelector("[data-scan-hint]");
    scanBtn.disabled = true;
    hint.hidden = true;
    try {
      const workouts = await listAllWorkouts();
      const found = scanWorkoutsForPRs(
        workouts,
        catalog.PR_LIST.map((p) => p.k),
      );
      const map = prMap();
      const candidates = catalog.PR_LIST.filter((p) => {
        const hit = found[p.k];
        if (!hit) return false;
        const current = map[p.k];
        return !current || hit.kg > current.kg;
      }).map((p) => ({ meta: p, hit: found[p.k], current: map[p.k] || null }));

      if (candidates.length === 0) {
        hint.hidden = false;
        hint.textContent = "没找到更高的重量";
        return;
      }
      paintScanResults(candidates);
    } finally {
      scanBtn.disabled = false;
    }
  }

  function paintScanResults(candidates) {
    const checked = new Set(candidates.map((c) => c.meta.k));
    container.innerHTML = `
      <button type="button" class="back-btn" data-back>‹ PR 墙</button>
      <h1 class="display sm" style="margin:10px 0">扫描到 ${candidates.length} 项新纪录</h1>
      <div class="pr-scan-list"></div>
      <button type="button" class="btn" data-confirm style="width:100%;margin-top:14px">确认更新选中项</button>
    `;
    const list = container.querySelector(".pr-scan-list");
    list.innerHTML = candidates
      .map((c) => {
        const oldVal = c.current ? toDisplay(c.current.kg, unit) : "—";
        const newVal = toDisplay(c.hit.kg, unit);
        return `<label class="pr-scan-row">
          <input type="checkbox" data-scan-check="${c.meta.k}" checked />
          <span class="pr-scan-row__name">${c.meta.n}</span>
          <span class="pr-scan-row__vals">${oldVal} → <strong>${newVal}</strong> ${unit}</span>
        </label>`;
      })
      .join("");
    list.querySelectorAll("[data-scan-check]").forEach((box) => {
      box.addEventListener("change", () => {
        if (box.checked) checked.add(box.dataset.scanCheck);
        else checked.delete(box.dataset.scanCheck);
      });
    });
    container.querySelector("[data-back]").addEventListener("click", paintList);
    container.querySelector("[data-confirm]").addEventListener("click", async () => {
      const toApply = candidates.filter((c) => checked.has(c.meta.k));
      for (const c of toApply) {
        await upsertPR(c.meta.k, c.hit.kg);
      }
      prs = await listPRs();
      paintList();
      await showAlert(toApply.length ? `已更新 ${toApply.length} 项 🎉` : "没有选中任何项");
    });
  }

  function paintDetail() {
    const meta = catalog.PR_LIST.find((p) => p.k === detailKey);
    const rec = prMap()[detailKey];
    const initial = rec ? toDisplay(rec.kg, unit) : "";

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
      <button type="button" class="btn" data-save style="width:100%;margin-top:6px">更新 PR 成绩</button>
      ${rec ? `<button type="button" class="btn ghost danger" data-remove style="width:100%;margin-top:8px">清除此项记录</button>` : ""}
    `;

    const input = container.querySelector(".pr-input");
    const pctGrid = container.querySelector(".pct-grid");

    function paintPcts() {
      const base = fromDisplay(input.value, unit);
      pctGrid.innerHTML = PCTS.map((pct) => {
        if (base == null) {
          return `<div class="pct-cell ${pct === 100 ? "pct-cell--hi" : ""}">
            <div class="pct-cell__pct">${pct}%</div><div class="pct-cell__val">—</div>
          </div>`;
        }
        const kg = (base * pct) / 100;
        const value = unit === "kg" ? kg : kgToLb(kg);
        return `<div class="pct-cell ${pct === 100 ? "pct-cell--hi" : ""}">
          <div class="pct-cell__pct">${pct}%</div>
          <div class="pct-cell__val">${formatWeight(value)}</div>
        </div>`;
      }).join("");
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
        await showAlert("填个数字");
        return;
      }
      const kg = fromDisplay(String(v), unit);
      const beat = rec && kg > rec.kg;
      await upsertPR(detailKey, kg);
      prs = await listPRs();
      detailKey = null;
      paintList();
      await showAlert(beat ? "破纪录了 🎉" : "已更新");
    });

    const removeBtn = container.querySelector("[data-remove]");
    if (removeBtn) {
      removeBtn.addEventListener("click", async () => {
        if (!(await showConfirm(`清除「${meta.n}」的 PR 记录？`))) return;
        await deletePR(rec.id);
        prs = await listPRs();
        detailKey = null;
        paintList();
      });
    }
  }

  paintList();
}

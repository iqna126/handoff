// 设置（我的 → 设置）：目前只有一项——默认重量单位。PR 墙/配重计算器
// 共用这一个全局值（getUnitPref/setUnitPref，见 data.js），这里给用户一个
// 明确、不会被误触的地方去设置/改回默认单位，而不是只能靠各页面上那个
// 顺手切换的 LB/KG 按钮（那个按钮切一下就会永久改掉全局偏好，容易在
// 随手点点的时候把默认单位改乱）。
import { getUnitPref, setUnitPref } from "../data.js";

export async function render(container) {
  let unit = await getUnitPref();

  container.innerHTML = `
    <h2>默认重量单位</h2>
    <div class="settings-unit-row"></div>
    <p class="entry-row__hint" style="margin-top:10px">PR 墙、配重计算器都跟着这个设置走。</p>
  `;

  const row = container.querySelector(".settings-unit-row");

  function paint() {
    row.innerHTML = `
      <button type="button" class="settings-unit-btn ${unit === "lb" ? "settings-unit-btn--active" : ""}" data-unit="lb">LB 磅</button>
      <button type="button" class="settings-unit-btn ${unit === "kg" ? "settings-unit-btn--active" : ""}" data-unit="kg">KG 公斤</button>
    `;
    row.querySelectorAll("[data-unit]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (btn.dataset.unit === unit) return;
        unit = btn.dataset.unit;
        paint();
        await setUnitPref(unit);
      });
    });
  }

  paint();
}

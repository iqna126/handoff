// 重量单位换算 + 配重取整（SPEC.md §0.2/§0.3）。
//
// 老版单文件 App 的换算用的是 0.4536 这个近似系数，而且每次转换都四舍五入到
// 1 位小数再存回去——来回切换单位会掉精度（180lb → 81.6kg → 179.9lb）。
// 这里改用精确系数，内部只存完整精度的 kg，显示时才做一次性的取整。
export const KG_PER_LB = 0.45359237;

export function lbToKg(lb) {
  return lb * KG_PER_LB;
}

export function kgToLb(kg) {
  return kg / KG_PER_LB;
}

// 抹掉浮点噪声，最多保留 2 位小数，不强制补 0——125.25 显示 125.25，
// 不是 125.3 也不是 125.25000000000001。
export function formatWeight(value) {
  if (value == null || Number.isNaN(value)) return "";
  const rounded = Math.round(value * 100) / 100;
  return String(rounded);
}

export function toDisplay(kg, unit) {
  return formatWeight(unit === "kg" ? kg : kgToLb(kg));
}

export function fromDisplay(value, unit) {
  const n = parseFloat(value);
  if (Number.isNaN(n)) return null;
  return unit === "kg" ? n : lbToKg(n);
}

// ---------- 配重取整（SPEC.md §0.3） ----------

export const EQUIPMENT = {
  lb: { bars: [45, 35], plates: [45, 25, 15, 10, 5, 2.5, 1.25] },
  kg: { bars: [20, 15], plates: [25, 20, 15, 10, 5, 2.5, 1.25] },
};

const BAR_KEY_PREFIX = "handoff.barWeight.";

export function getSavedBar(unit) {
  const raw = localStorage.getItem(BAR_KEY_PREFIX + unit);
  const n = raw ? Number(raw) : NaN;
  return EQUIPMENT[unit].bars.includes(n) ? n : EQUIPMENT[unit].bars[0];
}

export function saveBar(unit, bar) {
  localStorage.setItem(BAR_KEY_PREFIX + unit, String(bar));
}

// 目标重量 → 实际能配出来的重量。取最接近的，不是向下取整；
// 低于杆重直接返回杆重；配片用贪心（片值表本身就保证贪心即最优）。
export function roundToPlates(targetWeight, unit, barWeight) {
  const { plates } = EQUIPMENT[unit];
  const smallest = plates[plates.length - 1];

  if (targetWeight <= barWeight) {
    return { rounded: barWeight, perSide: [], exact: targetWeight };
  }

  const perSideExact = (targetWeight - barWeight) / 2;
  const perSideRounded = Math.round(perSideExact / smallest) * smallest;
  const rounded = barWeight + perSideRounded * 2;

  const perSide = [];
  let remaining = perSideRounded;
  for (const p of plates) {
    while (remaining >= p - 1e-9) {
      perSide.push(p);
      remaining -= p;
    }
  }

  return { rounded, perSide, exact: targetWeight };
}

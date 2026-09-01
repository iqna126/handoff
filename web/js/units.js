// 重量单位换算（SPEC.md §0.2）。
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

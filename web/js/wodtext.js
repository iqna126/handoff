// 训练记录编辑器的"一行一个动作"解析器（SPEC.md §4.3）：识别重量/组次/
// 时长，算总容量。照抄老版单文件 App 同一段逻辑（docs 分支
// reference/current-app.html 的 parseLine/parseBlock/lineVolume）——这不是
// 已删除的"整节课粘贴解析"那个功能（wodparse.js 的 parseWodText，解析
// Wodify 课表结构），是训练记录编辑器自己的、更简单的单行解析，SPEC.md
// §4 明确保留了这条路径。
const RE_WEIGHT = /(\d+(?:\.\d+)?(?:\s*\+\s*\d+(?:\.\d+)?)*)\s*(lbs?|kg|磅|公斤)/i;
const RE_COMBO = /(\d+)\s*[×x*]\s*\(\s*([\d+\s]+?)\s*\)/;
const RE_SETS = /(\d+)\s*[×x*]\s*(\d+)/;
const RE_TIME = /(\d+)\s*(mins?|minutes?|分钟|min)/i;

const normUnit = (u) => {
  const s = (u || "").toLowerCase();
  return s === "kg" || s === "公斤" ? "kg" : "lbs";
};

// 只在这个解析器内部用，跟 units.js 的精确换算是两回事——这里只是为了估算
// 训练容量，不需要 SPEC §0.2 那种"不得漂移"的精度保证
const toKg = (w, u) => (w == null ? null : u === "kg" ? w : +(w * 0.4536).toFixed(1));

export function parseLine(raw) {
  const line = (raw || "").trim();
  if (!line) return null;
  const it = {
    raw: line,
    name: "",
    weights: [],
    weight: null,
    unit: "",
    kg: null,
    sets: null,
    reps: [],
    repsTotal: null,
    minutes: null,
  };
  let rest = line;

  const mw = rest.match(RE_WEIGHT);
  if (mw) {
    it.weights = mw[1]
      .split("+")
      .map((s) => parseFloat(s.trim()))
      .filter((n) => !Number.isNaN(n));
    it.unit = normUnit(mw[2]);
    it.weight = it.weights[0];
    it.kg = toKg(it.weight, it.unit);
    rest = rest.replace(mw[0], " ");
  }
  const mc = rest.match(RE_COMBO);
  if (mc) {
    it.sets = parseInt(mc[1], 10);
    it.reps = mc[2]
      .split("+")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !Number.isNaN(n));
    rest = rest.replace(mc[0], " ");
  } else {
    const ms = rest.match(RE_SETS);
    if (ms) {
      it.sets = parseInt(ms[1], 10);
      it.reps = [parseInt(ms[2], 10)];
      rest = rest.replace(ms[0], " ");
    }
  }
  it.repsTotal = it.reps.reduce((a, b) => a + b, 0) || null;

  const mt = rest.match(RE_TIME);
  if (mt) {
    it.minutes = parseInt(mt[1], 10);
    rest = rest.replace(mt[0], " ");
  }

  it.name = rest
    .replace(/\s+/g, " ")
    .replace(/[+＋、,，-]+$/g, "")
    .trim();
  it.weightText = it.weights.length ? it.weights.join("+") + it.unit : "";
  it.repsText = it.sets ? it.sets + "×" + it.reps.join("+") : it.minutes ? it.minutes + "min" : "";
  return it;
}

export function parseBlock(text) {
  return (text || "")
    .split("\n")
    .map(parseLine)
    .filter((x) => x && x.name);
}

export function lineVolume(it) {
  if (!it.weights.length || !it.sets || !it.reps.length) return 0;
  let per = 0;
  if (it.weights.length === it.reps.length) {
    it.weights.forEach((w, i) => (per += toKg(w, it.unit) * it.reps[i]));
  } else {
    per = toKg(it.weights[0], it.unit) * it.reps.reduce((a, b) => a + b, 0);
  }
  return per * it.sets;
}

export function totalVolume(items) {
  return items.reduce((s, it) => s + lineVolume(it), 0);
}

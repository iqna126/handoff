// 动作 → 肌群映射（SPEC.md §0.1 术语表用的中文肌群名）。用规则而不是 AI：
// 结果稳定、免费、离线、零延迟。照抄老版单文件 App 的同一份映射表
// （docs 分支 reference/js/muscles.js）——长关键词优先匹配，避免
// "squat" 抢了 "front squat" 的匹配。
export const MUSCLES = {
  glute: "臀",
  quad: "股四头",
  ham: "腘绳肌",
  calf: "小腿",
  back: "背",
  chest: "胸",
  shoulder: "肩",
  arm: "手臂",
  core: "核心",
  cardio: "有氧",
};

const MAP = [
  ["back squat", ["quad", "glute", "core"]],
  ["front squat", ["quad", "glute", "core"]],
  ["overhead squat", ["quad", "glute", "shoulder", "core"]],
  ["air squat", ["quad", "glute"]],
  ["bootstrap squat", ["quad", "glute"]],
  ["pistol", ["quad", "glute", "core"]],
  ["single-leg squat", ["quad", "glute", "core"]],
  ["zercher", ["quad", "glute", "core"]],
  ["hack squat", ["quad", "glute"]],
  ["squat", ["quad", "glute"]],
  ["good morning", ["ham", "glute", "back"]],
  ["deadlift", ["ham", "glute", "back"]],
  ["hip thrust", ["glute", "ham"]],
  ["glute bridge", ["glute", "ham"]],
  ["lunge", ["quad", "glute"]],
  ["step-up", ["quad", "glute"]],
  ["step up", ["quad", "glute"]],
  ["box jump", ["quad", "glute", "calf", "cardio"]],
  ["calf raise", ["calf"]],
  ["nordic", ["ham"]],
  ["copenhagen", ["core", "glute"]],
  ["adductor", ["glute"]],
  ["frog pose", ["glute"]],

  ["bar muscle-up", ["back", "arm", "core"]],
  ["muscle-up", ["back", "arm", "core"]],
  ["muscle up", ["back", "arm", "core"]],
  ["chest-to-bar", ["back", "arm"]],
  ["chest to bar", ["back", "arm"]],
  ["pull-up", ["back", "arm"]],
  ["pull up", ["back", "arm"]],
  ["pullup", ["back", "arm"]],
  ["ring row", ["back", "arm"]],
  ["barbell row", ["back", "arm"]],
  ["bent over row", ["back", "arm"]],
  ["lat pulldown", ["back", "arm"]],
  ["pulldown", ["back", "arm"]],
  ["rope climb", ["back", "arm", "core"]],
  ["face pull", ["shoulder", "back"]],
  ["rear delt", ["shoulder", "back"]],
  ["reverse fly", ["shoulder", "back"]],
  ["shrug", ["back", "shoulder"]],

  ["bench press", ["chest", "arm", "shoulder"]],
  ["push-up", ["chest", "arm", "core"]],
  ["push up", ["chest", "arm", "core"]],
  ["pushup", ["chest", "arm", "core"]],
  ["ring dip", ["chest", "arm", "shoulder"]],
  ["dip", ["chest", "arm", "shoulder"]],
  ["chest fly", ["chest"]],
  ["pec deck", ["chest"]],
  ["handstand push-up", ["shoulder", "arm", "core"]],
  ["hspu", ["shoulder", "arm", "core"]],
  ["handstand walk", ["shoulder", "core"]],
  ["handstand", ["shoulder", "core"]],
  ["wall walk", ["shoulder", "core"]],
  ["shoulder press", ["shoulder", "arm"]],
  ["strict press", ["shoulder", "arm"]],
  ["push press", ["shoulder", "arm", "quad"]],
  ["push jerk", ["shoulder", "arm", "quad"]],
  ["split jerk", ["shoulder", "arm", "quad"]],
  ["jerk", ["shoulder", "arm", "quad"]],
  ["overhead press", ["shoulder", "arm"]],
  ["lateral raise", ["shoulder"]],
  ["side raise", ["shoulder"]],
  ["front raise", ["shoulder"]],
  ["upright row", ["shoulder", "back"]],
  ["elbow punch", ["shoulder"]],

  ["clean and jerk", ["glute", "ham", "back", "shoulder", "quad"]],
  ["power clean", ["glute", "ham", "back", "quad"]],
  ["hang clean", ["glute", "ham", "back", "quad"]],
  ["clean", ["glute", "ham", "back", "quad"]],
  ["power snatch", ["glute", "ham", "back", "shoulder"]],
  ["hang snatch", ["glute", "ham", "back", "shoulder"]],
  ["muscle snatch", ["back", "shoulder"]],
  ["snatch balance", ["shoulder", "quad", "core"]],
  ["snatch", ["glute", "ham", "back", "shoulder"]],
  ["thruster", ["quad", "glute", "shoulder", "arm"]],
  ["wall ball", ["quad", "glute", "shoulder"]],
  ["wall-ball", ["quad", "glute", "shoulder"]],
  ["wallball", ["quad", "glute", "shoulder"]],
  ["kettlebell swing", ["glute", "ham", "back", "shoulder"]],
  ["kb swing", ["glute", "ham", "back", "shoulder"]],
  ["turkish get-up", ["shoulder", "core"]],
  ["get-up", ["shoulder", "core"]],
  ["slam ball", ["back", "core", "shoulder"]],
  ["sumo deadlift high pull", ["glute", "ham", "back", "shoulder"]],
  ["sdhp", ["glute", "ham", "back", "shoulder"]],
  ["farmers carry", ["back", "core", "arm"]],
  ["burpee", ["chest", "quad", "core", "cardio"]],

  ["toes to bar", ["core", "back"]],
  ["toes-to-bar", ["core", "back"]],
  ["ttb", ["core", "back"]],
  ["knees to elbow", ["core", "back"]],
  ["knee raise", ["core"]],
  ["hanging knee", ["core"]],
  ["v-up", ["core"]],
  ["sit-up", ["core"]],
  ["sit up", ["core"]],
  ["situp", ["core"]],
  ["ghd", ["core", "ham"]],
  ["plank", ["core"]],
  ["hollow", ["core"]],
  ["l-sit", ["core", "arm"]],
  ["windshield", ["core"]],
  ["crunch", ["core"]],
  ["卷腹", ["core"]],
  ["serratus", ["core", "shoulder"]],
  ["前锯肌", ["core", "shoulder"]],

  ["run", ["cardio"]],
  ["row", ["cardio", "back"]],
  ["bike", ["cardio", "quad"]],
  ["echo bike", ["cardio"]],
  ["ski", ["cardio", "back"]],
  ["swim", ["cardio"]],
  ["double-under", ["cardio", "calf"]],
  ["double under", ["cardio", "calf"]],
  ["jump rope", ["cardio", "calf"]],
  ["cardio", ["cardio"]],
  ["stair", ["cardio", "glute"]],
  ["楼梯机", ["cardio", "glute"]],
  ["assault", ["cardio"]],

  ["深蹲", ["quad", "glute"]],
  ["硬拉", ["ham", "glute", "back"]],
  ["臀推", ["glute", "ham"]],
  ["臀中肌", ["glute"]],
  ["髋外展", ["glute"]],
  ["卧推", ["chest", "arm", "shoulder"]],
  ["推肩", ["shoulder", "arm"]],
  ["侧平举", ["shoulder"]],
  ["面拉", ["shoulder", "back"]],
  ["飞鸟", ["shoulder", "chest"]],
  ["划船", ["back", "arm"]],
  ["下拉", ["back", "arm"]],
  ["引体", ["back", "arm"]],
  ["夹胸", ["chest"]],
  ["弓步", ["quad", "glute"]],
];

const SORTED = MAP.slice().sort((a, b) => b[0].length - a[0].length);

export function musclesOfLine(text) {
  const t = (text || "").toLowerCase();
  const hit = new Set();
  for (const [kw, groups] of SORTED) {
    if (t.includes(kw)) groups.forEach((g) => hit.add(g));
  }
  return [...hit];
}

export function muscleProfile(text) {
  const counts = {};
  (text || "").split("\n").forEach((line) => {
    musclesOfLine(line).forEach((m) => (counts[m] = (counts[m] || 0) + 1));
  });
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => ({ key: k, name: MUSCLES[k], n }));
}

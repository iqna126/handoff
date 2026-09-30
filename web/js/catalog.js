// 动作/PR/技能目录（catalog.json，纯静态数据，不进 Supabase）。PR 墙、
// 技能树、配重计算器都要用，内存里缓存一份——同一次页面会话没必要每次
// 进页面都重新拉一遍。
let cached = null;

export async function loadCatalog() {
  if (!cached) {
    cached = await fetch("/data/catalog.json").then((r) => r.json());
  }
  return cached;
}

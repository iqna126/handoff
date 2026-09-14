// 从训练记录扫描 PR（SPEC.md §5.1）：复用 skillmatch.js 同一套动作识别逻辑
// （长名优先匹配、排除词守卫过滤热身/练习动作、同一记录内取更重的那次），
// 只是把命中范围收窄到 PR 墙关心的举重类动作，再跟当前 PR 比大小。
import { matchSkills } from "./skillmatch.js";
import { parseWeightTextToKg } from "./units.js";

// prKeys：PR 墙展示的动作 key 集合——skillmatch 认识的动作比 PR 墙关心的多
// （比如体操类动作），只挑这几个举重动作。返回 { key -> {kg, line, day} }，
// 同一个动作在不同天的记录里都出现过，跨记录也取重量最大的那次。
export function scanWorkoutsForPRs(workouts, prKeys) {
  const keys = new Set(prKeys);
  const best = {};
  for (const w of workouts) {
    for (const hit of matchSkills(w.body || "")) {
      if (!keys.has(hit.key)) continue;
      const kg = parseWeightTextToKg(hit.weightText);
      if (kg == null) continue;
      if (!best[hit.key] || kg > best[hit.key].kg) {
        best[hit.key] = { kg, line: hit.line, day: w.day };
      }
    }
  }
  return best;
}

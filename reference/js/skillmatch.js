/* ============================================================
   从训练记录里识别做过的动作 → 自动解锁技能树
   
   两个关键设计：
   1. 长名优先匹配，避免 "Squat" 抢了 "Front Squat"
   2. 有「排除词」守卫 —— 热身里的 "5 Back Squats (Empty Bar)"、
      "Scapular Pull-Ups"、":20 Squat Hold" 这些不算真做了这个动作
   ============================================================ */

// 这些词出现在同一行时，不算完成了该动作（热身/准备/辅助变式）
const GUARD = /(empty bar|banded|scapular|kip swing|build to|build pace|rehearse|prep|warm[\s-]*up|hold\b|stretch|pausing|pause|drill|practice|tempo hold|negative|assisted|partner|light load|focus on|suggested loading|%\s*of\b|1rm|cardio choice|bootstrap|toe touch|scorpion|arm swing|pull-apart|pull apart)/i;

// WOD 里常见写法 → 技能树的 key
// 只列出跟技能树能对上的；对不上的动作不会误报
const ALIASES = {
  air_squat:    ['air squat', 'bootstrap squat', '徒手深蹲'],
  pushup:       ['push-up', 'push up', 'pushup', '俯卧撑'],
  deadlift:     ['deadlift', '硬拉'],
  sh_press:     ['shoulder press', 'strict press', 'overhead press', '肩上推举', '推举'],
  sit_up:       ['sit-up', 'sit up', 'situp', 'abmat', '仰卧起坐'],
  ring_row:     ['ring row', '吊环划船'],
  sdhp:         ['sumo deadlift high pull', 'sdhp', '相扑高拉'],
  mb_clean:     ['medicine-ball clean', 'medicine ball clean', 'med ball clean', '药球翻'],
  burpee:       ['burpee'],

  pullup_s:     ['strict pull-up', 'strict pullup', '严格引体'],
  pullup_k:     ['kipping pull-up', 'pull-up', 'pull up', 'pullup', '引体'],
  pullup_bf:    ['butterfly pull-up', 'butterfly pullup', '蝴蝶引体'],
  c2b_s:        ['strict chest-to-bar', 'strict c2b'],
  c2b_k:        ['chest-to-bar', 'chest to bar', 'c2b', '胸碰杠'],
  dip:          ['dip'],
  ring_dip:     ['ring dip', '吊环臂屈伸'],
  bmu_k:        ['bar muscle-up', 'bar muscle up', 'bmu', '杠铃翻上'],
  bmu_s:        ['strict bar muscle-up'],
  rmu_k:        ['ring muscle-up', 'muscle-up', 'muscle up', 'rmu', '吊环翻上'],
  rmu_s:        ['strict muscle-up'],
  rope:         ['rope climb', '爬绳'],
  rope_ll:      ['legless rope climb', '无腿爬绳'],

  wall_walk:    ['wall walk', '倒立爬墙'],
  handstand:    ['handstand hold', '倒立支撑'],
  hspu_s:       ['strict handstand push-up', 'strict hspu'],
  hspu_k:       ['handstand push-up', 'hspu', '倒立推'],
  hs_walk:      ['handstand walk', '倒立行走'],

  ktoe_s:       ['knees-to-elbows', 'knees to elbows', 'knee raise', '屈膝上举'],
  ttb_s:        ['strict toes-to-bar'],
  ttb_k:        ['toes-to-bar', 'toes to bar', 'ttb', '脚碰杠'],
  l_sit:        ['l-sit', 'l sit'],
  ghd_situp:    ['ghd sit-up', 'ghd'],
  pistol:       ['pistol', 'single-leg squat', '单腿深蹲'],

  back_squat:   ['back squat', '后蹲', '深蹲'],
  front_squat:  ['front squat', '前蹲'],
  ohs:          ['overhead squat', '过头深蹲'],
  bench:        ['bench press', '卧推'],
  push_press:   ['push press', '借力推'],
  push_jerk:    ['push jerk', '借力挺'],
  split_jerk:   ['split jerk', '分腿挺'],
  thruster:     ['thruster', '推举深蹲'],

  hang_pc:      ['hang power clean'],
  power_clean:  ['power clean', '高翻'],
  hang_clean:   ['hang clean'],
  clean:        ['clean and jerk', 'clean', '翻站'],
  cj:           ['clean and jerk', 'c&j', '挺举'],

  muscle_sn:    ['muscle snatch'],
  hang_psn:     ['hang power snatch'],
  power_sn:     ['power snatch', '高抓'],
  hang_sn:      ['hang snatch', '悬垂抓'],
  snatch:       ['snatch', '抓举'],
  sn_balance:   ['snatch balance'],

  sumo_dl:      ['sumo deadlift'],
  good_morn:    ['good morning'],
  kb_swing:     ['kettlebell swing', 'kb swing', 'american kettlebell', '壶铃摆荡'],
  kb_snatch:    ['kettlebell snatch'],
  lunge_walk:   ['walking lunge', 'reverse lunge', 'alternating lunge', '弓步'],
  lunge_frl:    ['front-rack lunge', 'front rack lunge'],
  lunge_brl:    ['back-rack lunge', 'back rack lunge', 'back rack reverse lunge'],
  lunge_ohl:    ['overhead lunge', 'overhead walking lunge'],
  tgu:          ['turkish get-up', 'turkish getup'],
  farmer:       ['farmers carry', "farmer's carry"],

  single_u:     ['single-under', 'single under'],
  double_u:     ['double-under', 'double under', 'du\'s', '双摇'],
  row:          ['row erg', 'rowing', 'row,', 'row)'],
  run:          ['run', 'shuttle run', '跑步'],
  swim:         ['swim'],
  box_step:     ['box step-up', 'step-up'],
  box_jump:     ['box jump'],
  bbjo:         ['burpee box jump-over', 'burpee box jump'],
  wallball:     ['wall-ball', 'wall ball', 'wallball', '药球上抛'],
  slam_ball:    ['slam ball'],
  inv_burpee:   ['inverted burpee']
};

// 展开成 [关键词, key]，长的排前面
const FLAT = [];
Object.entries(ALIASES).forEach(([k, list]) =>
  list.forEach(kw => FLAT.push([kw.toLowerCase(), k])));
FLAT.sort((a, b) => b[0].length - a[0].length);

// 从一行里抓重量：95/65lb (43/30kg) / 100kg / 53/35lb
const W_RE = /(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*(lbs?|kg)|(\d+(?:\.\d+)?)\s*(lbs?|kg)/i;

function weightOfLine(line) {
  const m = line.match(W_RE);
  if (!m) return '';
  return m[0].trim();
}

/* 从整段训练文本识别做过的动作
   返回 [{ key, line, weightText }] —— 同一个动作只报一次，取第一次出现 */
function matchSkills(text) {
  const found = {};
  let blockWeight = '';   // 「Barbell: 95/65lb」这类处方，带给同一块里的动作
  (text || '').split('\n').forEach(rawLine => {
    const line = rawLine.trim();
    if (!line) return;

    // 装备处方行：记下重量，本身不算一个动作
    const eqm = line.match(/^(Barbell|Dumbbells?|Kettlebells?|Wall Ball|Wallball)\s*:\s*(.+)$/i);
    if (eqm) { blockWeight = eqm[2].trim(); return; }
    // 段落标题（【】开头）重置块重量
    if (/^【/.test(line)) { blockWeight = ''; }
    if (GUARD.test(line)) return;          // 热身/准备动作，不算
    const low = line.toLowerCase();

    // 一行里可能有多个动作（比如 "Burpee Pull-Ups" 记两个），
    // 但 "Back Rack Reverse Lunges" 不该同时记成 lunge_brl 和 lunge_walk。
    // 做法：长名先匹配，占住的文字区间不让短名再匹配。
    const taken = [];   // [[start, end], ...]
    const overlaps = (a, b) => taken.some(([s0, e0]) => a < e0 && b > s0);
    const hitKeys = [];
    for (const [kw, key] of FLAT) {
      const at = low.indexOf(kw);
      if (at < 0) continue;
      if (overlaps(at, at + kw.length)) continue;
      taken.push([at, at + kw.length]);
      hitKeys.push(key);
    }
    const w = weightOfLine(line) || blockWeight;
    hitKeys.forEach(key => {
      if (!found[key]) found[key] = { key, line, weightText: w };
    });
  });
  return Object.values(found);
}

module.exports = { matchSkills, ALIASES };

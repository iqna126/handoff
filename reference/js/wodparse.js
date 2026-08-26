/* ============================================================
   Wodify WOD 解析器
   把整段粘贴的课表拆成结构化 section。
   全部用规则，不依赖 AI —— Wodify 的输出标记非常稳定。
   ============================================================ */

// 段落类型
// warmup   热身
// strength 力量 / 无氧（要记每组重量）
// metcon   WOD / 有氧（要选 scaling level）
// cooldown 拉伸恢复
// accessory 附加

const SEC_WARMUP   = /^(WARM[\s-]*UP|WARMUP)\s*:?\s*$/i;
const SEC_COOLDOWN = /^(PRVN RESET|COOL[\s-]*DOWN|RESET|RECOVERY)\s*:?\s*$/i;
const SEC_ACCESSORY= /^(Optional Accessories|Accessories|Extra Credit)\b/i;

// 计分项标题：Back Squat (6 Sets) / "Business Time" (6 rounds for reps)
const COMPONENT = /^(.{2,90}?)\s*\(([^()]{2,60})\)\s*$/;
// 括号里必须像「计分方式」才算计分项标题，
// 否则 "5 Empty Barbell Back Squat (Pausing at Bottom)" 这种也会被误判。
const VALID_SCORE = /(\d+\s*[x×]\s*\d+|(\d+\s*)?(sets?|rounds?|reps?|for time|for load|for weight|for quality|amrap|emom|tabata|time|load|weight|checkmark|cal|distance|max))/i;
// scaling 块：[Business Time: Levels]
const LEVELS_BLOCK = /^\[(.+?):\s*Levels?\]/i;
// 各档位：Level 2:  Masters 55+:  Competitor:  Hotel Gym / Travel:
const LEVEL_HEAD = /^(RX|Rx|Level\s*\d+|Masters\s*\d+\+?|Competitor|Scaled|Hotel Gym\s*\/?\s*Travel|Travel|Beginner)\s*:\s*$/i;
// 处方装备：Barbell: 95/65lb (43/30kg)   Dumbbells: 2 x 35/25lb
const EQUIP = /^(Barbell|Dumbbells?|Kettlebells?|Wall Ball|Wallball|Box|Rope|Machine)\s*:\s*(.+)$/i;
// 教练说明（长文，默认折叠）
const META = /^(Goals?|Stimulus|RPE|Primary Objective|Secondary Objective|Workout Strategy|Intent|Notes|Score|Scoring)\s*[:：]?\s*(.*)$/i;
// 结束标记
const ADD_RESULT = /^Add result\b/i;
// Wodify 成绩录入区的残留：「% of 1RM Back Squat」后面会跟一个光秃秃的动作名，
// 这不是训练内容，是它的输入框标签，要丢掉
const PCT_LABEL = /^%\s*of\b/i;
const VIDEO_LABEL = /^(Video Support|Video|Demo)\s*:?\s*$/i;
// 课程头：CrossFit - Mon, Aug 24 / CrossFit Pump & Burn - Sat, Aug 22
// 课名不写死，任何「英文课名 - 星期几, 月 日」都认
const CLASS_HEAD = /^([A-Za-z][A-Za-z&/\s]{1,45}?)\s*[-–—]\s*((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\s*,?\s*.+)$/i;

// 判定是不是力量项：标题里含举重动作 + 计分方式是 Sets
const LIFT_WORDS = /(squat|deadlift|press|jerk|clean|snatch|bench|thruster|lunge|pull[\s-]?up|row(?!ing)|swing|carry|get[\s-]?up)/i;
const METCON_SCORE = /(round|amrap|for time|emom|interval|cal|tabata)/i;

// 标题直接点名了自己是热身/拉伸/附加 —— 这个优先级最高，
// 因为 Burn 课的写法是 "Warm-Up (Checkmark)"，靠计分方式判断会误判成 metcon
const TITLE_WARMUP    = /^(warm[\s-]*up|general warm|specific)/i;
const TITLE_COOLDOWN  = /^(cool[\s-]*down|prvn|reset|recovery|yoga|stretch)/i;
const TITLE_ACCESSORY = /^(optional|accessor|extra credit|midline|core work)/i;
// 「N x M」这种是典型的力量组次，比如 Front Squat (6 x 5)
const SETS_X_REPS = /^\d+\s*[x×]\s*\d+$/;

function detectKind(title, score, curSection) {
  const t = (title || '').trim();
  if (TITLE_WARMUP.test(t))    return 'warmup';
  if (TITLE_COOLDOWN.test(t))  return 'cooldown';
  if (TITLE_ACCESSORY.test(t)) return 'accessory';
  if (curSection === 'warmup')   return 'warmup';
  if (curSection === 'cooldown') return 'cooldown';
  if (curSection === 'accessory')return 'accessory';

  const sc = (score || '').trim();
  if (SETS_X_REPS.test(sc)) return 'strength';
  if (/for (load|weight)/i.test(sc)) return 'strength';
  if (METCON_SCORE.test(sc)) return 'metcon';
  if (LIFT_WORDS.test(t) && /sets?|reps?/i.test(sc)) return 'strength';
  if (LIFT_WORDS.test(t)) return 'strength';
  if (/sets?/i.test(sc)) return 'strength';
  return 'metcon';
}

function parseWodText(raw) {
  const lines = (raw || '').split('\n').map(l => l.replace(/\u00a0/g, ' ').trimEnd());
  const out = { classType: '', dateText: '', sections: [] };
  let cur = null;              // 当前 section
  let region = '';             // warmup / cooldown / accessory 区域标记
  let pendingLevels = null;    // 正在收集的 scaling 块
  let curLevel = null;
  let sid = 0;
  let dropNext = 0;            // 需要跳过的后续行数
  let inVideo = false;         // 是否进入了 Video Support 区

  const pushSection = (kind, title, score) => {
    cur = { id: 's' + (++sid), kind, title: title || '', score: score || '',
            lines: [], meta: [], equip: [], levels: [] };
    out.sections.push(cur);
    return cur;
  };

  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    const t = L.trim();
    if (!t || t === '-' || t === '—') continue;

    // 课程头
    const ch = t.match(CLASS_HEAD);
    if (ch && !out.classType) {
      out.classType = ch[1];
      out.dateText = ch[2].trim();
      continue;
    }

    // 区域切换
    if (SEC_WARMUP.test(t))    { inVideo = false; region = 'warmup';   pushSection('warmup', 'Warm-up', ''); pendingLevels = null; continue; }
    if (SEC_COOLDOWN.test(t))  { inVideo = false; region = 'cooldown'; pushSection('cooldown', t.replace(/:$/,''), ''); pendingLevels = null; continue; }
    if (SEC_ACCESSORY.test(t)) {
      region = 'accessory';
      const m = t.match(COMPONENT);
      pushSection('accessory', m ? m[1] : t, m ? m[2] : '');
      pendingLevels = null; continue;
    }

    // Add result → 当前计分项收尾
    if (ADD_RESULT.test(t)) { pendingLevels = null; curLevel = null; dropNext = 0; continue; }

    // 「% of 1RM Back Squat」是成绩录入标签，它下一行的光秃动作名也一起丢
    if (PCT_LABEL.test(t)) { dropNext = 1; continue; }
    if (dropNext > 0) { dropNext--; continue; }

    // 「Video Support:」之后全是视频链接名，不是训练内容
    if (VIDEO_LABEL.test(t)) { inVideo = true; continue; }
    if (inVideo) continue;

    // scaling 块开始
    const lb = t.match(LEVELS_BLOCK);
    if (lb) {
      // 挂到最近的一个 metcon 上；找不到就新建
      let target = [...out.sections].reverse().find(s => s.kind === 'metcon');
      if (!target) target = pushSection('metcon', lb[1], '');
      pendingLevels = target;
      curLevel = null;
      continue;
    }

    // scaling 块内部
    if (pendingLevels) {
      const lh = t.match(LEVEL_HEAD);
      if (lh) {
        curLevel = { name: lh[1].replace(/:$/,''), lines: [], equip: [] };
        pendingLevels.levels.push(curLevel);
        continue;
      }
      if (curLevel) {
        const eq = t.match(EQUIP);
        if (eq) curLevel.equip.push({ what: eq[1], value: eq[2].trim() });
        else curLevel.lines.push(t);
        continue;
      }
    }

    // 计分项标题
    const cm = t.match(COMPONENT);
    if (cm && !EQUIP.test(t) && !META.test(t)
        && VALID_SCORE.test(cm[2]) && !/^\d/.test(cm[1].trim())) {
      const title = cm[1].replace(/^["“](.+)["”]$/, '$1').trim();
      const score = cm[2].trim();
      // 正式计分项一出现，热身就算结束了 —— 后面是主课内容
      if (region === 'warmup') region = '';
      pushSection(detectKind(title, score, region), title, score);
      continue;
    }

    if (!cur) pushSection(region || 'metcon', region === 'warmup' ? 'Warm-up' : '', '');

    // 装备处方
    const eq = t.match(EQUIP);
    if (eq) { cur.equip.push({ what: eq[1], value: eq[2].trim() }); continue; }

    // 教练说明
    const mm = t.match(META);
    if (mm) { cur.meta.push(t); continue; }

    // 说明段的后续长文（上一条是 meta 且这行很长）
    if (cur.meta.length && t.length > 120) { cur.meta.push(t); continue; }

    cur.lines.push(t);
  }

  // 主 WOD 的 RX 就是它自己的 lines —— 补一个 RX 档，方便统一选择
  out.sections.forEach(s => {
    if (s.kind === 'metcon' && s.levels.length && !s.levels.some(l => /^rx$/i.test(l.name))) {
      s.levels.unshift({ name: 'RX', lines: s.lines.slice(), equip: s.equip.slice(), isRx: true });
    }
  });

  // 同名的 metcon 合并（主块 + 后面单独的 Levels 块）
  for (let i = out.sections.length - 1; i > 0; i--) {
    const a = out.sections[i];
    if (a.kind !== 'metcon') continue;
    const twin = out.sections.findIndex((b, j) =>
      j < i && b.kind === 'metcon' && b.title && b.title === a.title);
    if (twin >= 0) {
      const b = out.sections[twin];
      b.levels = b.levels.concat(a.levels);
      b.lines = b.lines.concat(a.lines);
      b.meta = b.meta.concat(a.meta);
      b.equip = b.equip.concat(a.equip);
      out.sections.splice(i, 1);
    }
  }

  // 丢掉完全空的 section
  out.sections = out.sections.filter(s =>
    s.lines.length || s.levels.length || s.meta.length || s.equip.length);

  return out;
}

module.exports = { parseWodText };

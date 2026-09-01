// 训练计时器（SPEC.md §8.3）：回合/运动/休息，间隔计时器打法。
//
// 剩余时间按结束时间戳算，不做累加——掉帧或切到后台再回来都不会走偏
// （老版单文件 App 的这部分实现是对的，直接照搬这个核心状态机）。
// 新加的是"直接输入"——老版只有 +/- 按钮，SPEC.md 变更记录里明确写了
// "只能加减太慢"，这次要求点数字直接改，支持 mm:ss 和纯数字（按秒解析）
// 两种格式。
//
// 关键约束：运行中每 100ms 重绘一次时钟，这个重绘函数只碰时钟自己的
// DOM（renderClock），绝不重新渲染参数区（renderParams 单独调用）——
// 否则会顶掉用户正在编辑的输入框内容。

const BOUNDS = {
  rounds: [1, 60],
  work: [5, 3600],
  rest: [0, 3600],
};

function clamp(n, [lo, hi]) {
  return Math.min(hi, Math.max(lo, n));
}

// "1:30" → 90；"90" → 90（纯数字按秒解析）；非法输入返回 null，
// 调用方看到 null 就保持原值不变，不报错、不清零。
function parseTimeInput(raw) {
  const s = String(raw).trim();
  if (s === "") return null;
  if (s.includes(":")) {
    const [m, sec] = s.split(":");
    const mm = parseInt(m, 10);
    const ss = parseInt(sec, 10);
    if (Number.isNaN(mm) || Number.isNaN(ss)) return null;
    return mm * 60 + ss;
  }
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? null : n;
}

function parseIntInput(raw) {
  const n = parseInt(String(raw).trim(), 10);
  return Number.isNaN(n) ? null : n;
}

function mmss(sec) {
  sec = Math.max(0, Math.ceil(sec));
  return String(Math.floor(sec / 60)).padStart(2, "0") + ":" + String(sec % 60).padStart(2, "0");
}

export function render(container) {
  const TM = {
    rounds: 8,
    work: 20,
    rest: 10,
    running: false,
    phase: "idle", // idle | work | rest | done
    round: 1,
    endAt: 0,
    left: 0,
  };
  let tick = null;
  let audioCtx = null;

  container.innerHTML = `
    <div class="timer-big">
      <div class="timer-phase"></div>
      <div class="timer-clock"></div>
      <div class="timer-round"></div>
    </div>
    <div class="timer-params">
      <div class="timer-set">
        <span>回合数</span>
        <div class="stepper">
          <button type="button" data-step="rounds:-1">－</button>
          <input type="text" inputmode="numeric" class="stepper__value" data-field="rounds" />
          <button type="button" data-step="rounds:1">＋</button>
        </div>
      </div>
      <div class="timer-set">
        <span>运动时长</span>
        <div class="stepper">
          <button type="button" data-step="work:-5">－</button>
          <input type="text" class="stepper__value" data-field="work" />
          <button type="button" data-step="work:5">＋</button>
        </div>
      </div>
      <div class="timer-set">
        <span>休息时长</span>
        <div class="stepper">
          <button type="button" data-step="rest:-5">－</button>
          <input type="text" class="stepper__value" data-field="rest" />
          <button type="button" data-step="rest:5">＋</button>
        </div>
      </div>
    </div>
    <div class="timer-total"></div>
    <div class="timer-actions">
      <button type="button" class="btn" data-start></button>
      <button type="button" class="btn ghost" data-reset>重置</button>
    </div>
  `;

  const phaseEl = container.querySelector(".timer-phase");
  const clockEl = container.querySelector(".timer-clock");
  const roundEl = container.querySelector(".timer-round");
  const bigEl = container.querySelector(".timer-big");
  const paramsEl = container.querySelector(".timer-params");
  const totalEl = container.querySelector(".timer-total");
  const startBtn = container.querySelector("[data-start]");
  const fields = {
    rounds: container.querySelector('[data-field="rounds"]'),
    work: container.querySelector('[data-field="work"]'),
    rest: container.querySelector('[data-field="rest"]'),
  };

  function beep(long) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = audioCtx || new Ctx();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = long ? 880 : 620;
      gain.gain.value = 0.18;
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + (long ? 0.5 : 0.15));
    } catch {
      // 拿不到 AudioContext（比如没有用户交互过）就静默跳过，不影响计时本身
    }
  }

  // 只画时钟本身——运行中每 100ms 调一次，绝不碰 paramsEl 里的输入框
  function renderClock() {
    bigEl.classList.toggle("timer-big--work", TM.phase === "work");
    phaseEl.textContent =
      TM.phase === "work" ? "运动" : TM.phase === "rest" ? "休息" : TM.phase === "done" ? "完成" : "准备";
    clockEl.textContent = TM.phase === "idle" ? mmss(TM.work) : TM.phase === "done" ? "00:00" : mmss(TM.left);
    roundEl.textContent =
      TM.phase === "idle" || TM.phase === "done" ? `${TM.rounds} 回合` : `第 ${TM.round} / ${TM.rounds} 回合`;
    startBtn.textContent = TM.running ? "暂停" : TM.phase === "idle" || TM.phase === "done" ? "开始" : "继续";
  }

  // 只在参数真的变了、或者锁定状态变了的时候调用，不受 100ms 定时器驱动
  function renderParams() {
    if (document.activeElement !== fields.rounds) fields.rounds.value = TM.rounds;
    if (document.activeElement !== fields.work) fields.work.value = mmss(TM.work);
    if (document.activeElement !== fields.rest) fields.rest.value = mmss(TM.rest);
    totalEl.textContent = `共 ${mmss(TM.rounds * (TM.work + TM.rest))}`;
    const locked = TM.phase !== "idle" && TM.phase !== "done";
    paramsEl.classList.toggle("timer-params--locked", locked);
  }

  function tickFn() {
    TM.left = (TM.endAt - Date.now()) / 1000;
    if (TM.left > 0) {
      renderClock();
      return;
    }
    if (TM.phase === "work") {
      if (TM.rest > 0) {
        TM.phase = "rest";
        TM.endAt = Date.now() + TM.rest * 1000;
        beep(false);
      } else if (TM.round < TM.rounds) {
        TM.round++;
        TM.endAt = Date.now() + TM.work * 1000;
        beep(false);
      } else {
        return finish();
      }
    } else if (TM.phase === "rest") {
      if (TM.round < TM.rounds) {
        TM.round++;
        TM.phase = "work";
        TM.endAt = Date.now() + TM.work * 1000;
        beep(false);
      } else {
        return finish();
      }
    }
    renderClock();
  }

  function finish() {
    TM.running = false;
    TM.phase = "done";
    TM.left = 0;
    clearInterval(tick);
    tick = null;
    beep(true);
    renderClock();
    renderParams();
  }

  function toggle() {
    if (TM.running) {
      TM.running = false;
      clearInterval(tick);
      tick = null;
      TM.left = (TM.endAt - Date.now()) / 1000;
      renderClock();
      return;
    }
    if (TM.phase === "idle" || TM.phase === "done") {
      TM.round = 1;
      TM.phase = "work";
      TM.endAt = Date.now() + TM.work * 1000;
      beep(false);
    } else {
      TM.endAt = Date.now() + TM.left * 1000; // 从暂停处续上
    }
    TM.running = true;
    tick = setInterval(tickFn, 100);
    renderClock();
    renderParams();
  }

  function reset() {
    TM.running = false;
    TM.phase = "idle";
    TM.round = 1;
    TM.left = 0;
    clearInterval(tick);
    tick = null;
    renderClock();
    renderParams();
  }

  container.querySelectorAll("[data-step]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const [field, delta] = btn.dataset.step.split(":");
      TM[field] = clamp(TM[field] + Number(delta), BOUNDS[field]);
      renderParams();
    });
  });

  // 点击自动全选，直接输入新值不必先删；Enter 收起键盘并生效；
  // 非法输入（abc、空）保持原值，不报错、不清零。
  fields.rounds.addEventListener("focus", () => fields.rounds.select());
  fields.rounds.addEventListener("keydown", (e) => e.key === "Enter" && fields.rounds.blur());
  fields.rounds.addEventListener("blur", () => {
    const n = parseIntInput(fields.rounds.value);
    if (n != null) TM.rounds = clamp(n, BOUNDS.rounds);
    renderParams();
  });

  for (const field of ["work", "rest"]) {
    fields[field].addEventListener("focus", () => fields[field].select());
    fields[field].addEventListener("keydown", (e) => e.key === "Enter" && fields[field].blur());
    fields[field].addEventListener("blur", () => {
      const n = parseTimeInput(fields[field].value);
      if (n != null) TM[field] = clamp(n, BOUNDS[field]);
      renderParams();
    });
  }

  startBtn.addEventListener("click", toggle);
  container.querySelector("[data-reset]").addEventListener("click", reset);

  // 切到后台（切 App、锁屏、接电话）等于自动暂停——不能让计时器在用户
  // 看不见的时候自己往下跑，回来发现好几轮已经"跑完"了。endAt 时间戳
  // 本身没有漂移问题，这里纯粹是产品行为选择：不可见就当暂停处理。
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && TM.running) toggle();
  });

  renderClock();
  renderParams();
}

// 入口：登录态判断 + 登录后把 App 外壳（导航 + 路由）挂起来。
import { SUPABASE_ANON_KEY } from "./config.js";
import { showAlert } from "./dialog.js";

// 发登录链接失败时，把 Supabase 的英文报错换成用户看得懂的中文。
// 内置发信有两层限流：同一个邮箱 60 秒内只能再发一次，整个项目每小时能发的
// 封数也很少——后者冷却完了照样可能被拒，所以提示里不写死"等 60 秒"。
function emailErrorMessage(err) {
  const msg = err?.message || "";
  if (
    err?.status === 429 ||
    err?.code === "over_email_send_rate_limit" ||
    /rate limit|only request this after/i.test(msg)
  ) {
    return "发送太频繁了，请过一会儿再试";
  }
  if (/not authorized/i.test(msg)) {
    return "这个邮箱暂时收不到登录邮件，请改用 Google 登录";
  }
  return msg;
}

// 点了过期、已经用过（有的邮箱会提前"预打开"链接）或无效的登录链接，Supabase
// 会带着 #error=...&error_code=otp_expired 跳回来。supabase-js 只是登录失败，
// 不会给任何提示，用户只看到一个普通的登录页——这里读出来提示一下，并把错误
// 参数从地址栏清掉，免得刷新后又弹一次、也免得被 hash 路由当成 tab 名。
// 成功登录带回来的 #access_token=... 不碰，那个要留给 supabase-js 读。
function takeAuthErrorFromUrl() {
  for (const raw of [location.hash.slice(1), location.search.slice(1)]) {
    const params = new URLSearchParams(raw);
    if (!params.get("error") && !params.get("error_code")) continue;
    history.replaceState(null, "", location.pathname);
    if (params.get("error_code") === "otp_expired") {
      return "登录链接已经失效或用过了，请重新发送一次";
    }
    return params.get("error_description") || "登录没有成功，请重新发送登录链接";
  }
  return null;
}

async function render() {
  const statusEl = document.getElementById("status");
  if (!SUPABASE_ANON_KEY) {
    // anon key 还没填时给个明确提示，而不是让 SDK 抛一个不好懂的错
    statusEl.textContent = "未配置 SUPABASE_ANON_KEY（见 web/js/config.js），先填上再看登录状态";
    return;
  }

  const authError = takeAuthErrorFromUrl();
  const auth = await import("./auth.js");
  const loginEl = document.getElementById("login");
  const appEl = document.getElementById("app");
  const emailForm = document.getElementById("email-form");
  const emailSentEl = document.getElementById("email-sent");

  let routerStarted = false;

  // 登录就能用整个 App——只有 wods（Wodify 同步来的课表内容）单独按
  // is_allowed() White-list 控制读权限（见 db/004_allowlist.sql），不在这里
  // 拦人。没有权限的账号 listWodsForDay() 会被 RLS 静默过滤成空数组，
  // train.js 的"还没有同步到 WOD 内容，可以直接手写"这个已有的兜底提示
  // 天然就覆盖了这个情况，不需要在登录这一层单独判断、单独提示。
  function paint(session) {
    loginEl.hidden = !!session;
    if (!session) {
      appEl.classList.remove("app--visible");
      statusEl.hidden = false;
      statusEl.textContent = "未登录";
      // 退出登录后重新显示邮箱表单，而不是停在"链接已发送"那一步
      emailForm.hidden = false;
      emailSentEl.hidden = true;
      return;
    }

    statusEl.hidden = true;
    statusEl.textContent = "";
    appEl.classList.add("app--visible");
    // 路由只在首次登录成功时初始化一次——多次登录/token 刷新不该重新挂载，
    // 不然正在看的 tab 内容会被打断重画
    if (!routerStarted) {
      routerStarted = true;
      import("./router.js").then(({ initRouter }) => {
        initRouter(document.getElementById("nav"), document.getElementById("main"));
      });
    }
  }

  const initialSession = await auth.getSession();
  paint(initialSession);
  // 已经登录的人再点一次旧链接（过期或用过）也会带着错误参数回来，但他本来就
  // 登录着、能正常用，这时再弹"链接失效"是误报——只在确实没登录上时提示
  if (authError && !initialSession) showAlert(authError);
  // supabase-js 会在持有内部 auth 锁时同步执行 onAuthStateChange 回调并等它
  // 返回，回调里再调用 supabase 自己的方法（比如后面路由页面里的查询）会
  // 死锁——官方文档专门警告过。所以推到下一个任务再画，让回调本身立刻返回。
  auth.onAuthChange((session) => setTimeout(() => paint(session), 0));

  document.getElementById("google-btn").addEventListener("click", () => {
    auth.signInWithGoogle().catch((err) => showAlert(err.message));
  });

  const emailSubmitBtn = emailForm.querySelector('button[type="submit"]');
  const resendBtn = document.getElementById("email-resend");

  // 重新发送的冷却时间，跟 Supabase 默认"同一个邮箱 60 秒内只能再发一次"对齐。
  // 服务端报了更准的剩余秒数时（retryAfterMs）以服务端为准。按时间戳算剩余
  // 秒数，不靠计数器，切到后台 setInterval 变慢也不会算错。
  const RESEND_COOLDOWN_MS = 60 * 1000;
  let sentTo = "";
  let cooldownUntil = 0;
  let cooldownTimer = null;

  // 刷新"重新发送"按钮：冷却中显示剩余秒数并禁用，冷却完恢复可点
  function tickResend() {
    const left = Math.ceil((cooldownUntil - Date.now()) / 1000);
    if (left > 0) {
      resendBtn.disabled = true;
      resendBtn.textContent = `重新发送（${left}s）`;
      return;
    }
    clearInterval(cooldownTimer);
    cooldownTimer = null;
    resendBtn.disabled = false;
    resendBtn.textContent = "重新发送";
  }

  // 同邮箱限流的报错会带上还要等几秒："...you can only request this after 42 seconds"
  function retryAfterMs(err) {
    const m = /after (\d+) seconds?/i.exec(err?.message || "");
    return m ? Number(m[1]) * 1000 : null;
  }

  // 开始冷却：发送成功后默认 60 秒，被同邮箱限流时按服务端给的剩余秒数
  function startCooldown(ms = RESEND_COOLDOWN_MS) {
    cooldownUntil = Date.now() + ms;
    clearInterval(cooldownTimer);
    cooldownTimer = setInterval(tickResend, 1000);
    tickResend();
  }

  function showSent(email) {
    document.getElementById("email-sent-to").textContent = email;
    emailForm.hidden = true;
    emailSentEl.hidden = false;
  }

  emailForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    // 请求在路上时禁掉按钮：连点两下会发两次，第二次撞上 60 秒的同邮箱限制，
    // 页面已经显示"已发送"了还会再弹一个报错
    if (emailSubmitBtn.disabled) return;
    // Supabase 不区分邮箱大小写，这里也统一一下，下面的"同一个邮箱"判断才准
    const email = document.getElementById("email-input").value.trim().toLowerCase();
    // 点了"换个邮箱"又填回同一个邮箱、还在冷却期内：不再发一次（一定会撞限流），
    // 直接回到"已发送"页，那里的倒计时会告诉用户还要等多久
    if (email === sentTo && Date.now() < cooldownUntil) {
      showSent(email);
      return;
    }
    emailSubmitBtn.disabled = true;
    try {
      await auth.sendEmailLink(email);
      sentTo = email;
      startCooldown();
      showSent(email);
    } catch (err) {
      // 被同邮箱限流说明不久前刚给这个邮箱发过：直接进"已发送"页按服务端给的
      // 秒数倒计时，比弹一个"太频繁"更有用
      const wait = retryAfterMs(err);
      if (wait) {
        sentTo = email;
        startCooldown(wait);
        showSent(email);
      } else {
        await showAlert(emailErrorMessage(err));
      }
    } finally {
      emailSubmitBtn.disabled = false;
    }
  });

  resendBtn.addEventListener("click", async () => {
    if (resendBtn.disabled) return;
    resendBtn.disabled = true;
    resendBtn.textContent = "发送中…";
    try {
      await auth.sendEmailLink(sentTo);
      startCooldown();
    } catch (err) {
      // 同邮箱限流：按服务端给的秒数重新倒计时，免得按钮一恢复就又被拒；
      // 其他错误（包括项目级每小时上限）不进冷却，按钮恢复可点
      const wait = retryAfterMs(err);
      if (wait) startCooldown(wait);
      else tickResend();
      await showAlert(emailErrorMessage(err));
    }
  });

  document.getElementById("email-retry").addEventListener("click", () => {
    emailSentEl.hidden = true;
    emailForm.hidden = false;
  });
}

render();

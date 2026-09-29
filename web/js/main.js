// 入口：登录态判断 + 登录后把 App 外壳（导航 + 路由）挂起来。
import { SUPABASE_ANON_KEY } from "./config.js";
import { showAlert } from "./dialog.js";

async function render() {
  const statusEl = document.getElementById("status");
  if (!SUPABASE_ANON_KEY) {
    // anon key 还没填时给个明确提示，而不是让 SDK 抛一个不好懂的错
    statusEl.textContent = "未配置 SUPABASE_ANON_KEY（见 web/js/config.js），先填上再看登录状态";
    return;
  }

  const auth = await import("./auth.js");
  const { isAllowed } = await import("./data.js");
  const loginEl = document.getElementById("login");
  const deniedEl = document.getElementById("denied");
  const appEl = document.getElementById("app");
  const emailForm = document.getElementById("email-form");
  const codeForm = document.getElementById("code-form");

  let routerStarted = false;
  // 白名单检查结果按 uid 缓存：token 静默刷新、切回标签页都会触发
  // onAuthChange，同一个人不用每次都再查一遍，未开通页也不会每次都闪回
  // "加载中…"。换了账号（先退出再登另一个）要重新查。被拒的人开通后需要
  // 刷新页面才会重新查——未开通页上写了这一句。
  let known = null; // { uid, allowed }，已经有结论的检查
  let inflight = null; // { uid, promise }，正在进行的检查，启动时两次 paint 共用一个 RPC

  function checkAccess(uid) {
    if (inflight?.uid !== uid) {
      const promise = isAllowed();
      inflight = { uid, promise };
      // 不管成功失败都清掉：成功的结论记在 known 里，失败的下次 paint 重查
      promise.finally(() => {
        if (inflight?.promise === promise) inflight = null;
      }).catch(() => {});
    }
    return inflight.promise;
  }

  // 等 RPC 的这段时间里可能已经退出或换了账号，那次 paint 会自己画，
  // 拿着旧 session 的结果就不该再往页面上写了（成功、失败两条路都要查）
  async function isStale(uid) {
    const current = await auth.getSession();
    return current?.user.id !== uid;
  }

  async function paint(session) {
    loginEl.hidden = !!session;
    if (!session) {
      known = null;
      inflight = null;
      deniedEl.hidden = true;
      appEl.classList.remove("app--visible");
      statusEl.hidden = false;
      statusEl.textContent = "未登录";
      // 退出登录后重新显示邮箱表单，而不是停在验证码那一步
      emailForm.hidden = false;
      codeForm.hidden = true;
      return;
    }

    const uid = session.user.id;
    if (known?.uid !== uid) {
      appEl.classList.remove("app--visible");
      deniedEl.hidden = true;
      statusEl.hidden = false;
      statusEl.textContent = "加载中…";
      let allowed;
      try {
        allowed = await checkAccess(uid);
      } catch (err) {
        if (await isStale(uid)) return;
        statusEl.textContent = `检查账号权限失败：${err.message}，刷新页面重试`;
        return;
      }
      if (await isStale(uid)) return;
      known = { uid, allowed };
    }

    if (!known.allowed) {
      appEl.classList.remove("app--visible");
      statusEl.hidden = true;
      document.getElementById("denied-uid").textContent = uid;
      deniedEl.hidden = false;
      return;
    }

    statusEl.hidden = true;
    statusEl.textContent = "";
    deniedEl.hidden = true;
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

  paint(await auth.getSession());
  // paint 里要 await supabase 自己的方法（is_allowed RPC、getSession）。
  // supabase-js 会在持有内部 auth 锁时同步执行 onAuthStateChange 回调并等它
  // 返回，回调里再 await supabase 方法会死锁——官方文档专门警告过。所以
  // 推到下一个任务再画，让回调本身立刻返回。
  auth.onAuthChange((session) => setTimeout(() => paint(session), 0));

  document.getElementById("denied-signout").addEventListener("click", () => {
    auth.signOut().catch((err) => showAlert(err.message));
  });

  document.getElementById("google-btn").addEventListener("click", () => {
    auth.signInWithGoogle().catch((err) => showAlert(err.message));
  });

  let pendingEmail = "";

  emailForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    pendingEmail = document.getElementById("email-input").value;
    try {
      await auth.sendEmailCode(pendingEmail);
      emailForm.hidden = true;
      codeForm.hidden = false;
    } catch (err) {
      await showAlert(err.message);
    }
  });

  codeForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = document.getElementById("code-input").value;
    try {
      await auth.verifyEmailCode(pendingEmail, code);
    } catch (err) {
      await showAlert(err.message);
    }
  });
}

render();

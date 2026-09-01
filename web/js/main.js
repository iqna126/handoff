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
  const loginEl = document.getElementById("login");
  const appEl = document.getElementById("app");
  const emailForm = document.getElementById("email-form");
  const codeForm = document.getElementById("code-form");

  let routerStarted = false;

  function paint(session) {
    statusEl.hidden = !!session;
    statusEl.textContent = session ? "" : "未登录";
    loginEl.hidden = !!session;
    appEl.classList.toggle("app--visible", !!session);
    if (!session) {
      // 退出登录后重新显示邮箱表单，而不是停在验证码那一步
      emailForm.hidden = false;
      codeForm.hidden = true;
      return;
    }
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
  auth.onAuthChange(paint);

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

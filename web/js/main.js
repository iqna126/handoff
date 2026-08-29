// 入口。目前只做登录/登出这一件事：路由、tab 切换等留到 P0 步骤 5
// （前端功能全量搭建）再加。
import { SUPABASE_ANON_KEY } from "./config.js";

async function render() {
  const statusEl = document.getElementById("status");
  if (!SUPABASE_ANON_KEY) {
    // anon key 还没填时给个明确提示，而不是让 SDK 抛一个不好懂的错
    statusEl.textContent = "未配置 SUPABASE_ANON_KEY（见 web/js/config.js），先填上再看登录状态";
    return;
  }

  const auth = await import("./auth.js");
  const loginEl = document.getElementById("login");
  const logoutBtn = document.getElementById("logout-btn");
  const emailForm = document.getElementById("email-form");
  const codeForm = document.getElementById("code-form");

  function paint(session) {
    statusEl.textContent = session ? `已登录：${session.user.email ?? session.user.id}` : "未登录";
    loginEl.hidden = !!session;
    logoutBtn.hidden = !session;
    if (!session) {
      // 退出登录后重新显示邮箱表单，而不是停在验证码那一步
      emailForm.hidden = false;
      codeForm.hidden = true;
    }
  }

  paint(await auth.getSession());
  auth.onAuthChange(paint);

  document.getElementById("google-btn").addEventListener("click", () => {
    auth.signInWithGoogle().catch((err) => alert(err.message));
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
      alert(err.message);
    }
  });

  codeForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = document.getElementById("code-input").value;
    try {
      await auth.verifyEmailCode(pendingEmail, code);
    } catch (err) {
      alert(err.message);
    }
  });

  logoutBtn.addEventListener("click", () => {
    auth.signOut().catch((err) => alert(err.message));
  });
}

render();

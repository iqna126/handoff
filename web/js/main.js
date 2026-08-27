// 入口。P0 步骤 1 只验证部署管道通不通：显示登录状态即可。
// 路由、tab 切换等留到 P0 步骤 5（前端功能全量搭建）再加。
import { SUPABASE_ANON_KEY } from "./config.js";

async function render() {
  const el = document.getElementById("status");
  if (!SUPABASE_ANON_KEY) {
    // anon key 还没填时给个明确提示，而不是让 SDK 抛一个不好懂的错
    el.textContent = "未配置 SUPABASE_ANON_KEY（见 web/js/config.js），先填上再看登录状态";
    return;
  }
  const { getSession } = await import("./auth.js");
  const session = await getSession();
  el.textContent = session ? `已登录：${session.user.email ?? session.user.id}` : "未登录";
}

render();

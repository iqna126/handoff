// Supabase 登录、会话。P0 步骤 1 只做最小验证：显示已登录/未登录。
// 完整的 Google/邮箱登录按钮见 P0 步骤 2（DESIGN.md §7.1）。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function getSession() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session;
}

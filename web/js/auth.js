// Supabase 登录、会话。Google + 邮箱登录链接都是 Supabase 原生支持，
// 前端调 SDK 即可，不需要自己写后端逻辑（DESIGN.md §7.1）。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function getSession() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session;
}

// session 变化（登录/退出/token 刷新）时回调，用来实时切换界面
export function onAuthChange(callback) {
  supabase.auth.onAuthStateChange((_event, session) => callback(session));
}

export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin },
  });
  if (error) throw error;
}

// 发登录链接：Supabase 内置发信只能用默认模板，默认模板里是一个登录链接，
// 没有 6 位验证码（要改模板得先配自己的 SMTP，记在 DESIGN.md 的 P2 里）。
// 用户点链接回到 emailRedirectTo，supabase-js 默认会从 URL 里读出 session，
// 登录态就自动接上了。emailRedirectTo 不传的话会退回项目的 Site URL（新项目
// 默认是 localhost:3000），跟 Google 登录的 redirectTo 是同一个坑。
//
// 已知的体验代价：链接在哪个浏览器里打开，就只有那个浏览器登录上。手机上从
// 主屏幕打开的 App、或者在另一台设备上点链接，原来那个页面不会跟着登录。
export async function sendEmailLink(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw error;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

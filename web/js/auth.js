// Supabase 登录、会话。Google + 邮箱验证码都是 Supabase 原生支持，
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

// 发验证码：Supabase 内置发信，走的是邮箱验证码这条路（不是魔法链接）
export async function sendEmailCode(email) {
  const { error } = await supabase.auth.signInWithOtp({ email });
  if (error) throw error;
}

export async function verifyEmailCode(email, code) {
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token: code,
    type: "email",
  });
  if (error) throw error;
  return data.session;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

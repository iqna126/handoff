// todos/ideas/workouts/wods 的读写。全部走 Supabase JS SDK 直连（不经过 handoff
// 这个 Worker——那个 Worker 只服务 wodify-pull 的写入通道，见 DESIGN.md §6.6）。
// RLS 保证 todos/ideas/workouts 只能碰自己的行；wods 是全 box 共享的只读表。
import { supabase } from "./auth.js";

export async function listTodos() {
  const { data, error } = await supabase
    .from("todos")
    .select("*")
    .order("day", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function addTodo({ title, day }) {
  const { data, error } = await supabase
    .from("todos")
    .insert({ title, day })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function setTodoDone(id, done) {
  const { error } = await supabase.from("todos").update({ done }).eq("id", id);
  if (error) throw error;
}

export async function deleteTodo(id) {
  const { error } = await supabase.from("todos").delete().eq("id", id);
  if (error) throw error;
}

export async function listIdeas() {
  const { data, error } = await supabase
    .from("ideas")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function addIdea({ text, day }) {
  const { data, error } = await supabase.from("ideas").insert({ text, day }).select().single();
  if (error) throw error;
  return data;
}

export async function deleteIdea(id) {
  const { error } = await supabase.from("ideas").delete().eq("id", id);
  if (error) throw error;
}

// 某一天全 box 共享的 WOD 内容（可能有多个 program，见 api-wodify 的 GymProgramId
// 修复）——纯展示，不可编辑，见 SPEC.md §1.2。
export async function listWodsForDay(day) {
  const { data, error } = await supabase.from("wods").select("*").eq("day", day);
  if (error) throw error;
  return data;
}

export async function listWorkoutsForDay(day) {
  const { data, error } = await supabase.from("workouts").select("*").eq("day", day);
  if (error) throw error;
  return data;
}

// 日历上要标小圆点的日期集合：有未完成待办或训练记录的那些天（SPEC.md §1.1）
export async function listMarkedDays() {
  const [{ data: todos, error: e1 }, { data: workouts, error: e2 }] = await Promise.all([
    supabase.from("todos").select("day").eq("done", false),
    supabase.from("workouts").select("day"),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  return new Set([...todos.map((t) => t.day), ...workouts.map((w) => w.day)]);
}

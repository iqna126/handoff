// todos/ideas/workouts/wods 的读写。全部走 Supabase JS SDK 直连（不经过 handoff
// 这个 Worker——那个 Worker 只服务 wodify-pull 的写入通道，见 DESIGN.md §6.6）。
// RLS 保证 todos/ideas/workouts 只能碰自己的行；wods 是全 box 共享的只读表。
import { supabase } from "./auth.js";

// 重量单位是全局设置（我的 → 设置），不是每个页面各存一份——PR 墙和配重
// 计算器要看到同一个单位，不能各转各的。默认 lb：这个场馆平时说磅的多，
// db/001_init.sql 里 profiles.unit_pref 的默认值也是 'lb'，不是老版 App
// 那个默认 kg 的习惯。
export async function getUnitPref() {
  // maybeSingle 而不是 single——profiles 行按理说注册时触发器就建好了，
  // 但触发器没跑成功、或者查询发生在行还没建好的极短窗口内，不该让整个
  // 页面直接崩掉（single() 在 0 行时会抛 "Cannot coerce..." 这个不好懂的错），
  // 退回默认单位就行。
  const { data, error } = await supabase.from("profiles").select("unit_pref").maybeSingle();
  if (error) throw error;
  return data?.unit_pref || "lb";
}

export async function setUnitPref(unit) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from("profiles").update({ unit_pref: unit }).eq("id", user.id);
  if (error) throw error;
}

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

export async function listAllWorkouts() {
  const { data, error } = await supabase
    .from("workouts")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function addWorkout({ day, title, body, items, volume, muscles }) {
  const { data, error } = await supabase
    .from("workouts")
    .insert({ day, title, body, items, volume, muscles })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateWorkout(id, { day, title, body, items, volume, muscles }) {
  const { data, error } = await supabase
    .from("workouts")
    .update({ day, title, body, items, volume, muscles })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteWorkout(id) {
  const { error } = await supabase.from("workouts").delete().eq("id", id);
  if (error) throw error;
}

export async function listPRs() {
  const { data, error } = await supabase.from("prs").select("*");
  if (error) throw error;
  return data;
}

// upsert：有就更新 kg，没有就新建（movement_key 对每个用户唯一，见 db/001_init.sql）
export async function upsertPR(movementKey, kg) {
  const { data, error } = await supabase
    .from("prs")
    .upsert({ movement_key: movementKey, kg, achieved_on: new Date().toISOString().slice(0, 10) }, {
      onConflict: "user_id,movement_key",
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deletePR(id) {
  const { error } = await supabase.from("prs").delete().eq("id", id);
  if (error) throw error;
}

export async function listUnlockedSkills() {
  const { data, error } = await supabase.from("skills").select("*");
  if (error) throw error;
  return data;
}

export async function unlockSkill(movementKey) {
  const { error } = await supabase.from("skills").upsert(
    { movement_key: movementKey, unlocked_on: new Date().toISOString().slice(0, 10), auto: false },
    { onConflict: "user_id,movement_key" },
  );
  if (error) throw error;
}

export async function lockSkill(movementKey) {
  const { error } = await supabase.from("skills").delete().eq("movement_key", movementKey);
  if (error) throw error;
}

// 保存训练记录时自动解锁（SPEC.md §6.3）——只对调用方已经确认"当前还没
// 解锁"的动作调用，所以这里用普通 insert，不用 upsert，不会覆盖掉已有的
// 手动解锁记录（比如覆盖掉用户自己填的解锁日期）。
export async function autoUnlockSkill(movementKey, { weightText, sourceLine, workoutId }) {
  const { error } = await supabase.from("skills").insert({
    movement_key: movementKey,
    unlocked_on: new Date().toISOString().slice(0, 10),
    weight_text: weightText || null,
    source_line: sourceLine || null,
    auto: true,
    workout_id: workoutId || null,
  });
  if (error) throw error;
}

export async function listWishes() {
  const { data, error } = await supabase.from("wishes").select("*");
  if (error) throw error;
  return data;
}

export async function addWish(movementKey) {
  const { error } = await supabase
    .from("wishes")
    .upsert({ movement_key: movementKey }, { onConflict: "user_id,movement_key" });
  if (error) throw error;
}

export async function removeWish(movementKey) {
  const { error } = await supabase.from("wishes").delete().eq("movement_key", movementKey);
  if (error) throw error;
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

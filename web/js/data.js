// todos/ideas/workouts/wods 的读写。全部走 Supabase JS SDK 直连（不经过 handoff
// 这个 Worker——那个 Worker 只服务 wodify-pull 的写入通道，见 DESIGN.md §6.6）。
// RLS 保证 todos/ideas/workouts 只能碰自己的行；wods 是全 box 共享的只读表。
import { supabase } from "./auth.js";

// Supabase 的 Auth（签发 JWT）和 PostgREST（校验这里每个 .from() 读写用的 JWT）
// 是两个独立组件，偶尔有窗口期的时钟漂移——刚登录/刚静默刷新 token 后立刻发
// 请求，PostgREST 有极小概率认为这个刚签发的 token"签发时间还在未来"，直接
// 拒绝（错误信息是 "JWT issued at future"），读、写请求都可能撞上，不是权限
// 问题，等这个窗口自己过去、重试一次基本必过。
//
// 真实发生过的 bug：今日 tab 勾掉一条待办，checkbox 看着是勾上了，回到待办
// tab 却还是未完成——根因就是 setTodoDone 这次写请求正好撞上这个窗口，
// Supabase 报了错，但调用方（today.js 的 change 事件）没有 catch，错误被
// 悄悄吞掉，UI 什么反馈都没给，数据库其实什么都没变。所有 supabase 读写都
// 要过这个函数，不要在这个文件外面（或这个文件里）裸调 supabase.from()。
async function run(queryFn) {
  const first = await queryFn();
  if (!first.error) return first.data;
  if (!/issued at future/i.test(first.error.message || "")) throw first.error;
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const retry = await queryFn();
  if (retry.error) throw retry.error;
  return retry.data;
}

// 重量单位是全局设置（我的 → 设置），不是每个页面各存一份——PR 墙和配重
// 计算器要看到同一个单位，不能各转各的。默认 lb：这个场馆平时说磅的多，
// db/001_init.sql 里 profiles.unit_pref 的默认值也是 'lb'，不是老版 App
// 那个默认 kg 的习惯。
export async function getUnitPref() {
  // maybeSingle 而不是 single——profiles 行按理说注册时触发器就建好了，
  // 但触发器没跑成功、或者查询发生在行还没建好的极短窗口内，不该让整个
  // 页面直接崩掉（single() 在 0 行时会抛 "Cannot coerce..." 这个不好懂的错），
  // 退回默认单位就行。
  const data = await run(() => supabase.from("profiles").select("unit_pref").maybeSingle());
  return data?.unit_pref || "lb";
}

export async function setUnitPref(unit) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await run(() => supabase.from("profiles").update({ unit_pref: unit }).eq("id", user.id));
}

export async function listTodos() {
  return run(() =>
    supabase
      .from("todos")
      .select("*")
      .order("day", { ascending: true })
      .order("created_at", { ascending: true }),
  );
}

export async function addTodo({ title, day }) {
  return run(() => supabase.from("todos").insert({ title, day }).select().single());
}

export async function setTodoDone(id, done) {
  await run(() => supabase.from("todos").update({ done }).eq("id", id));
}

export async function deleteTodo(id) {
  await run(() => supabase.from("todos").delete().eq("id", id));
}

export async function listIdeas() {
  return run(() => supabase.from("ideas").select("*").order("created_at", { ascending: false }));
}

export async function listIdeasForDay(day) {
  return run(() =>
    supabase.from("ideas").select("*").eq("day", day).order("created_at", { ascending: false }),
  );
}

export async function addIdea({ text, day }) {
  return run(() => supabase.from("ideas").insert({ text, day }).select().single());
}

export async function deleteIdea(id) {
  await run(() => supabase.from("ideas").delete().eq("id", id));
}

// 某一天全 box 共享的 WOD 内容（可能有多个 program，见 api-wodify 的 GymProgramId
// 修复）——纯展示，不可编辑，见 SPEC.md §1.2。
export async function listWodsForDay(day) {
  return run(() => supabase.from("wods").select("*").eq("day", day));
}

export async function listWorkoutsForDay(day) {
  return run(() => supabase.from("workouts").select("*").eq("day", day));
}

export async function listAllWorkouts() {
  return run(() =>
    supabase.from("workouts").select("*").order("created_at", { ascending: false }),
  );
}

export async function addWorkout({ day, title, body, items, volume, muscles, wod_id, wod_state }) {
  return run(() =>
    supabase
      .from("workouts")
      .insert({
        day,
        title,
        body,
        items,
        volume,
        muscles,
        wod_id: wod_id || null,
        wod_state: wod_state || null,
      })
      .select()
      .single(),
  );
}

export async function updateWorkout(
  id,
  { day, title, body, items, volume, muscles, wod_id, wod_state },
) {
  return run(() =>
    supabase
      .from("workouts")
      .update({
        day,
        title,
        body,
        items,
        volume,
        muscles,
        wod_id: wod_id || null,
        wod_state: wod_state || null,
      })
      .eq("id", id)
      .select()
      .single(),
  );
}

export async function deleteWorkout(id) {
  await run(() => supabase.from("workouts").delete().eq("id", id));
}

export async function listPRs() {
  return run(() => supabase.from("prs").select("*"));
}

// upsert：有就更新 kg，没有就新建（movement_key 对每个用户唯一，见 db/001_init.sql）
export async function upsertPR(movementKey, kg) {
  return run(() =>
    supabase
      .from("prs")
      .upsert(
        { movement_key: movementKey, kg, achieved_on: new Date().toISOString().slice(0, 10) },
        { onConflict: "user_id,movement_key" },
      )
      .select()
      .single(),
  );
}

export async function deletePR(id) {
  await run(() => supabase.from("prs").delete().eq("id", id));
}

export async function listUnlockedSkills() {
  return run(() => supabase.from("skills").select("*"));
}

export async function unlockSkill(movementKey) {
  await run(() =>
    supabase
      .from("skills")
      .upsert(
        { movement_key: movementKey, unlocked_on: new Date().toISOString().slice(0, 10), auto: false },
        { onConflict: "user_id,movement_key" },
      ),
  );
}

export async function lockSkill(movementKey) {
  await run(() => supabase.from("skills").delete().eq("movement_key", movementKey));
}

// 保存训练记录时自动解锁（SPEC.md §6.3）——只对调用方已经确认"当前还没
// 解锁"的动作调用，所以这里用普通 insert，不用 upsert，不会覆盖掉已有的
// 手动解锁记录（比如覆盖掉用户自己填的解锁日期）。
export async function autoUnlockSkill(movementKey, { weightText, sourceLine, workoutId }) {
  await run(() =>
    supabase.from("skills").insert({
      movement_key: movementKey,
      unlocked_on: new Date().toISOString().slice(0, 10),
      weight_text: weightText || null,
      source_line: sourceLine || null,
      auto: true,
      workout_id: workoutId || null,
    }),
  );
}

export async function listWishes() {
  return run(() => supabase.from("wishes").select("*"));
}

export async function addWish(movementKey) {
  await run(() =>
    supabase
      .from("wishes")
      .upsert({ movement_key: movementKey }, { onConflict: "user_id,movement_key" }),
  );
}

export async function removeWish(movementKey) {
  await run(() => supabase.from("wishes").delete().eq("movement_key", movementKey));
}

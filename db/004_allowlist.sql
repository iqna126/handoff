-- 注册保持开放，但只有白名单里的账号能读 wods（全 box 共享的课表内容）。
--
-- 为什么需要：wods 原来的策略是"认证用户都能读"，而 Supabase 的注册是公开的
-- （前端的 URL + anon key 设计上就是公开值，站点地址也写在公开仓库里），
-- 任何人自己注册一个账号就能读到场馆的全部课表。其他表都是 own rows，
-- 陌生账号只能碰自己的行，不需要额外处理——整个库里只有 wods 是共享数据。
--
-- 白名单按 auth.users 的 uid 记，不按邮箱：uid 是 Supabase 自己签发、写在
-- JWT 里的，不存在"这个邮箱到底验证过没有、是哪种登录方式"的判断问题。
-- 代价是只能等对方先注册，再从 Authentication → Users 里复制 uid 加进来
-- （前端的"未开通"页面会把 uid 显示给对方，方便发过来）。
--
-- 执行顺序（顺序反了会把自己挡在外面）：
--   1. 在 Supabase 控制台的 SQL Editor 里整段执行这个文件。执行前把 STEP 1 里
--      的 <你的 uid> 换成自己的 uid（Authentication → Users 里复制）。忘了换的话
--      这不是合法 uuid，STEP 1 就会报错；填了一个不存在的 uid 会撞外键报错——
--      两种情况整段都会回滚，wods 的策略不会被改。
--   2. 在 SQL Editor 里确认 select * from allowed_users; 里有自己那一行。
--   3. 然后才 push web/ 的改动。前端登录后会调 is_allowed()，这个函数还不存在
--      时所有人（包括自己）都只会看到"检查账号权限失败"，进不去 App——这是
--      故意的"失败即拒绝"，但意味着 web/ 不能比这段 SQL 先上线。
--
-- 以后加人（同样在 SQL Editor 里）：
--   insert into allowed_users (user_id, note) values ('<uid>', '<备注>');
-- 移除：
--   delete from allowed_users where user_id = '<uid>';

begin;

-- STEP 0：白名单表。开 RLS 但不建任何策略 = 客户端（anon/authenticated）
-- 既读不到也写不了，只有 SQL Editor / service_role 能改。
create table allowed_users (
  user_id    uuid primary key references auth.users on delete cascade,
  note       text,                          -- 这是谁，方便以后自己认
  created_at timestamptz default now()
);

alter table allowed_users enable row level security;
revoke all on allowed_users from anon, authenticated;

-- 当前登录的人在不在白名单里。security definer：以函数所有者身份查
-- allowed_users，绕开上面"客户端读不到"的限制，但只对外暴露一个布尔值，
-- 不暴露名单本身。search_path 设成空、里面的名字全部写全 schema，防止调用方
-- 用同名对象劫持查询（Supabase 的 linter 推荐的写法）。
create function public.is_allowed()
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (select 1 from public.allowed_users where user_id = auth.uid());
$$;

-- Supabase 默认会把 public schema 里新函数的执行权限给 anon/authenticated，
-- 这里收回来只留给 authenticated（前端登录后调它决定显示 App 还是"未开通"页）。
revoke all on function public.is_allowed() from public, anon;
grant execute on function public.is_allowed() to authenticated;

-- STEP 1：先把自己加进去，再改策略。
insert into allowed_users (user_id, note) values ('<你的 uid>', 'owner');

-- STEP 2：wods 的读权限从"所有认证用户"收紧到"白名单用户"。
-- (select ...) 包一层让 Postgres 每条查询只算一次，而不是每行算一次。
drop policy "read all" on wods;
create policy "read allowlisted" on wods
  for select to authenticated using ((select public.is_allowed()));

-- STEP 3（顺手收紧，跟 wods 无关）：public_profiles 视图（001）按创建者权限
-- 运行、绕开 profiles 的行级限制，001 只 grant 给了 authenticated，但 Supabase
-- 的默认权限会把 public schema 里新建的表/视图也给 anon——不登录、只拿公开的
-- anon key 就能列出所有用户的 id + display_name。收回 anon 的，登录用户照旧
-- 能读（以后排行榜要用）。
revoke all on public_profiles from anon;

-- STEP 4：保险——STEP 1 插入的 owner 那一行必须对应一个真实存在的账号，
-- 否则整段回滚，不提交一个谁都读不到 wods 的状态。（STEP 1 的外键其实已经
-- 挡住了不存在的 uid，这里是再确认一遍，万一以后有人改了 STEP 1 的写法。）
do $$
begin
  if not exists (
    select 1 from public.allowed_users a join auth.users u on u.id = a.user_id
    where a.note = 'owner'
  ) then
    raise exception 'owner row missing from allowed_users, refusing to lock everyone out of wods';
  end if;
end;
$$;

commit;

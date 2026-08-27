-- P0 步骤 1：核心表 + RLS + 首次登录自动建 profile 的触发器。
-- 排行榜（leaderboard_entries）是 P1 功能，见 002_leaderboard.sql，不在这里建。
-- 在 Supabase 控制台的 SQL Editor 里整段执行。

-- ============================================================
-- 5.1 用户与身份
-- ============================================================

-- 用户资料。auth.users 是 Supabase 内建的，这里只存业务字段
create table profiles (
  id           uuid primary key references auth.users on delete cascade,
  display_name text,                       -- 排行榜上显示的名字，用户自己填
  avatar_url   text,
  unit_pref    text default 'lb',          -- 'kg' | 'lb'
  created_at   timestamptz default now()
);

alter table profiles enable row level security;

create policy "read own profile" on profiles
  for select using (auth.uid() = id);

create policy "update own profile" on profiles
  for update using (auth.uid() = id)
  with check (auth.uid() = id);

-- 别人只能看 display_name（排行榜要用），不直接开放整张 profiles 表。
-- 视图默认按创建者权限运行（不是查询者），所以能绕开上面 "own profile" 的行级限制，
-- 这正是这里想要的效果——只收窄到列，不收窄到行。
create view public_profiles as
  select id, display_name from profiles;

grant select on public_profiles to authenticated;

-- 首次登录后自动建 profile：auth.users 插入时同步插入 profiles。
-- 不放在前端做，避免用户中途关页面导致没有 profile。
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 微信身份关联（二期用，现在先建好）。
-- 同一个人可以既有邮箱登录又有微信登录，都指向同一个 profiles.id
create table wechat_identities (
  user_id   uuid references auth.users on delete cascade,
  openid    text not null,                 -- 小程序内唯一
  unionid   text,                          -- 同主体下跨应用唯一
  source    text not null,                 -- 'miniprogram' | 'web'
  created_at timestamptz default now(),
  primary key (openid, source)
);

-- ============================================================
-- 5.2 业务数据
-- ============================================================

create table todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  title text not null,
  day date not null,
  done boolean default false,
  tag text,                                -- '__book_class__' 等
  class_day date,                          -- 约课提醒指向的那节课
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  text text not null,
  day date not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 全 box 共享一份，不按用户分：WOD 课表内容本身不是私有数据，
-- 同一天同一节课所有人练的是同一个东西。用户自己的训练记录在 workouts 表，按用户分。
create table wods (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  class_type text,                         -- 'CrossFit' / 'Pump & Burn'
  title text,
  raw jsonb not null,                      -- wodify-pull 拉到的原始响应，永远保留
  sections jsonb,                          -- 解析结果
  source text default 'wodify_api',        -- 目前只会是 'wodify_api'，粘贴录入路径已删除
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (day, class_type)
);

create table workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  wod_id uuid references wods on delete set null,
  day date not null,
  title text,
  body text not null,                      -- 最终的记录文字，用户可自由编辑
  items jsonb,                             -- 解析出的动作行
  volume numeric,                          -- 总容量 kg
  muscles jsonb,                           -- [{key, name, n}]
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table prs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  movement_key text not null,              -- 'back_squat'
  kg numeric not null,                     -- 一律存 kg，显示时换算
  achieved_on date,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, movement_key)
);

create table skills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  movement_key text not null,
  unlocked_on date not null,
  weight_text text,                        -- 解锁当时的重量
  source_line text,                        -- 从哪一行认出来的
  auto boolean default false,              -- 是否自动识别
  workout_id uuid references workouts on delete set null,
  created_at timestamptz default now(),
  unique (user_id, movement_key)
);

create table wishes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  movement_key text not null,
  created_at timestamptz default now(),
  unique (user_id, movement_key)
);

-- ============================================================
-- 5.3 行级权限（RLS）—— 默认全部私密
-- ============================================================

alter table todos enable row level security;
create policy "own rows" on todos
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table ideas enable row level security;
create policy "own rows" on ideas
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table workouts enable row level security;
create policy "own rows" on workouts
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table prs enable row level security;
create policy "own rows" on prs
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table skills enable row level security;
create policy "own rows" on skills
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table wishes enable row level security;
create policy "own rows" on wishes
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- wods 是全 box 共享的课表内容，不是私有数据：认证用户都能读，客户端不能写
-- （只有 Worker 的 service_role 能写，天然绕过 RLS）
alter table wods enable row level security;
create policy "read all" on wods
  for select to authenticated using (true);

alter table wechat_identities enable row level security;
create policy "own rows" on wechat_identities
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- 5.5 索引
-- ============================================================

create index on todos    (user_id, day);
create index on workouts (user_id, day desc);
-- wods 的 unique (day, class_type) 已经自带索引，不用再单独建

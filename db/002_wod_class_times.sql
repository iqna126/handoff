-- wods 表加一列，存这个 program 当天开课的具体时段（可能不止一个，比如
-- CrossFit 当天早 6 点、早 9 点、晚 5:30 都开）。约课提醒（SPEC.md §7）
-- 要让用户从真实时段里选，而不是每次都手填——之前 wodify-pull 虽然从
-- schedule 动作里读到了 StartTime，但从没往下传，wods 表也没地方存。
alter table wods add column if not exists class_times jsonb not null default '[]'::jsonb;

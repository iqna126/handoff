-- workouts 表加一列，存"这条记录是从 WOD 导入时，每个段落的勾选/填写
-- 状态"（重量/次数/选的档位/成绩/改动等），不只是拼好的 body 文字。
-- 不存这个的话，点"改"只能拿到一段拼好的文字去手改，没法退回按段落
-- 勾选/填写的界面——用户明确要求改的时候要能退回段落模式。
alter table workouts add column if not exists wod_state jsonb;

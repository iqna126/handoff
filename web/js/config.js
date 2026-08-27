// Supabase 项目配置。这两个值设计上就是公开的（靠 RLS 保护，不是靠保密），
// 可以放进前端代码，见 DESIGN.md §8。
//
// SUPABASE_ANON_KEY 还没填：去 Supabase 控制台 → Settings → API → anon public 复制过来。
export const SUPABASE_URL = "https://axeqqltpmgzgncbqmkqy.supabase.co";
export const SUPABASE_ANON_KEY = "";

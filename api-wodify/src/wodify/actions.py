"""只读约束。

Wodify 不签发只读令牌 —— 我们用的是完整会话登录，凭证层面拦不住任何写操作。
所以限制必须做在代码里，而且是两道独立的闸：

1. ACTIONS 白名单：没登记的动作调不了。
2. assert_read_only：路径里带写标记的一律拒绝，**连白名单里的也照拒**。
   这样就算有人不小心往白名单里加错了东西，也是失败关闭而不是失败放行。

要预约课程请用官方 app。本模块永不代理写操作。
"""

from __future__ import annotations

# 2026-08 改版后，所有屏幕数据动作都带上了 WodifyClient_DataFetch_WB/ 前缀。
# 但 ServiceAPI 风格的动作没有这个前缀（也没有 DataAction 中缀），
# 所以前缀不能硬编码在拼接逻辑里，必须每个动作各自写全路径。
DATA_FETCH = "WodifyClient_DataFetch_WB"

ACTIONS: dict[str, str] = {
    # 某一天的排课表：时间、教练、已约/上限、名称、时长、班级 ID
    "schedule": (
        f"{DATA_FETCH}/Schedule_OS/GetClassList_ForClient_WithReservationCounts_WB"
        "/DataActionGetClassList_ForClient_WithReservationCounts"
    ),
    # WOD 正文。注意：这个动作在直接打开 workout 页时不会触发，
    # 只有从班级详情点进去才会 —— 见 prime.WORKOUT_WALK_JS
    "workout": (f"{DATA_FETCH}/WOD_Flow/GetAllWorkoutData_WB/DataActionGetAllWorkoutData"),
    # 我自己的预约历史。一次调用返回全部，范围过滤在客户端做更划算
    "bookings": (
        f"{DATA_FETCH}/Reservation_OS/GetReservationHistory_WB/DataActionGetReservationHistory"
    ),
}

# 路径里出现这些词就意味着可能改动服务端状态
WRITE_MARKERS = (
    "create",
    "save",
    "update",
    "delete",
    "remove",
    "reserve",
    "cancel",
    "signin",
    "signout",
    "checkin",
    "purchase",
    "buy",
    "pay",
    "accept",
    "submit",
    "set",
    "add",
    "edit",
    "log",
    "post",
    "put",
)


class NotAllowed(Exception):
    """动作不在白名单里，或命中了写操作守卫。"""


def assert_read_only(path: str) -> None:
    """路径里含写标记就抛异常。白名单条目也一样要过这一关。"""
    low = path.lower()
    for marker in WRITE_MARKERS:
        # 用 / 和大小写边界做粗粒度匹配即可 —— 宁可误伤，不可漏放
        if marker in low:
            # DataAction / DataFetch 里的 "action"、"data" 不算写操作，
            # 但 "set" 会命中 "GetClassList"？不会，那是 get。
            # 真正需要豁免的只有下面这几个已知的安全词根。
            if _is_false_positive(low, marker):
                continue
            raise NotAllowed(f"写操作被拒绝：路径含 {marker!r} → {path}")


# 这些是只读路径里合法出现、但字面上撞到写标记的片段
_SAFE_SUBSTRINGS = (
    "dataaction",  # DataActionGetXxx
    "datafetch",  # WodifyClient_DataFetch_WB
    "reservationcount",  # GetClassList_..._WithReservationCounts
    "reservationhistory",
)


def _is_false_positive(low: str, marker: str) -> bool:
    for safe in _SAFE_SUBSTRINGS:
        if safe in low and marker in safe:
            return True
    return False


def resolve(name: str) -> str:
    """动作名 → 完整路径。未登记就拒绝。"""
    if name not in ACTIONS:
        raise NotAllowed(f"动作未登记：{name!r}（可用：{sorted(ACTIONS)}）")
    path = ACTIONS[name]
    assert_read_only(path)
    return path

"""Wodify 的班级列表（GetClassList）响应 → 当天开课的 program/时段，以及
把 workout 解析结果和班级时段拼成 wods 表一行的最后一步。

跟 parse.py（workout 内容解析）是两件不同的事：那边管"这个 WOD 里有什么"，
这边管"今天这个 program 什么时候上课"——约课提醒需要具体时段，workout
内容不需要，两条路径的数据形状差异大到不该塞进同一个文件里维护。
"""

from __future__ import annotations

import re

from .parse import is_real

# workout 的 Name 字段形如 "CrossFit - Mon, Aug 24" / "CrossFit Pump & Burn - Sat, Aug 22"。
# 课名不写死——用「英文课名 - 星期几」的通用模式，跟粘贴解析器曾用的规则同一个思路
_CLASS_HEAD = re.compile(r"^(.+?)\s*[-–—]\s*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)", re.I)


def class_type_from_title(title: str) -> str:
    """从 workout 的 Name 字段里抠出课名，抠不出来就返回空字符串。"""
    m = _CLASS_HEAD.match((title or "").strip())
    return m.group(1).strip() if m else ""


def parse_schedule(payload: dict) -> list[dict]:
    """把 GetClassList 的响应转成当天**每一节课**（不按 ProgramId 去重）。

    同一个 program 当天经常开好几个时段（比如 CrossFit 早 6 点、早 9 点、
    晚 5:30 都各开一场），约课提醒要知道具体是哪个时段，去重会把这些时段
    信息丢掉——去重、只留"当天有哪些不同 program"这件事交给
    ``distinct_programs()``，这里只管把原始班级列表摘出来。

    响应容器跟 workout 是同一个命名习惯（``Response.ResponseWOD.ResponseWorkout``）：
    真机抓包证实是 ``Response.ResponseClassList.Class.List``——外层 key 见过
    Class/ClassList/ScheduleList 几种叫法（不同版本/不同截面可能不一样），
    都试一遍，取第一个有 List 的。跟 workout 一样过滤 Id == "0" 的占位记录。
    """
    data = payload.get("data") or payload
    response = data.get("Response") or {}
    response_class_list = response.get("ResponseClassList") or response

    container = None
    for key in ("Class", "ClassList", "ScheduleList"):
        candidate = response_class_list.get(key)
        if isinstance(candidate, dict) and candidate.get("List"):
            container = candidate
            break
    rows = (container or {}).get("List") or []

    classes: list[dict] = []
    for row in rows:
        if not isinstance(row, dict) or not is_real(row):
            continue
        program_id = row.get("ProgramId")
        if program_id is None:
            continue
        classes.append(
            {
                "id": row.get("Id"),
                "name": row.get("Name"),
                "start_time": row.get("StartTime"),
                "program_id": str(program_id),
            }
        )
    return classes


def distinct_programs(classes: list[dict]) -> list[dict]:
    """从 parse_schedule() 的完整班级列表里去重出当天有哪些不同 program——
    查 workout 只需要每个 program 各查一次，不需要每节课都查一遍。
    保留每个 program 第一次出现的那条记录（含它的 id/name/start_time）。
    """
    seen: set[str] = set()
    out: list[dict] = []
    for c in classes:
        if c["program_id"] in seen:
            continue
        seen.add(c["program_id"])
        out.append(c)
    return out


def class_times_for_program(classes: list[dict], program_id: str) -> list[str]:
    """某个 program 当天开了几个时段，取全部 StartTime——约课提醒要让用户
    选具体哪个时段（同一个 program 当天可能不止一场课）。"""
    return [
        c["start_time"] for c in classes if c["program_id"] == program_id and c.get("start_time")
    ]


def to_wod_row(day: str, parsed: dict, raw: dict, *, class_times: list[str] | None = None) -> dict:
    """转成 wods 表的一行。原文永久保留，方便日后用更好的规则重解析。

    class_times：这个 program 当天开课的具体时段（可能不止一个），约课
    提醒（SPEC.md §7）要让用户从里面选——不传就是空列表，前端退回手填。
    """
    title = parsed["title"]
    return {
        "day": day,
        "class_type": class_type_from_title(title),
        "title": title or f"WOD {day}",
        "sections": parsed["sections"],
        "raw": raw,
        "source": "wodify_api",
        "class_times": class_times or [],
    }

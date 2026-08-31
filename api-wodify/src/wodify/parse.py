"""Wodify 的 WOD 响应 → 我们的 sections 结构。

走 API 时段落结构是**现成的**（每个组件带 IsSection 标记），
不需要那套为粘贴纯文本写的正则。

字段陷阱（每一条都曾产出「看起来合理但是错的」输出，且不报错）：

* ``Description`` 才是 metcon 的动作内容。只读 ``Name``/``Comment``
  会拿到一堆 goals 和 RPE，**却没有 workout 本身**。
* ``MeasureRepScheme`` 是力量组的组次方案，纯文本带真实换行。
* ``Id == "0"`` 是 OutSystems 的空记录占位符，读起来跟真数据一模一样，必须过滤。
* ``Notes`` 是教练说明，可长达数千字符，默认不取。

段落类型判定优先用标题关键词，跟粘贴解析器保持一致（见 SPEC）。
"""

from __future__ import annotations

import re

EMPTY_ID = "0"

# 与粘贴解析器同一套判定，保证两条路径产出的 kind 一致
_TITLE_WARMUP = re.compile(r"^(warm[\s-]*up|general warm|specific)", re.I)
_TITLE_COOLDOWN = re.compile(r"^(cool[\s-]*down|prvn|reset|recovery|yoga|stretch)", re.I)
_TITLE_ACCESSORY = re.compile(r"^(optional|accessor|extra credit|midline|core work)", re.I)
_LIFT_WORDS = re.compile(
    r"(squat|deadlift|press|jerk|clean|snatch|bench|thruster|lunge|"
    r"pull[\s-]?up|row(?!ing)|swing|carry|get[\s-]?up)",
    re.I,
)
_METCON_SCORE = re.compile(r"(round|amrap|for time|emom|interval|cal|tabata)", re.I)
# workout 的 Name 字段形如 "CrossFit - Mon, Aug 24" / "CrossFit Pump & Burn - Sat, Aug 22"。
# 课名不写死——用「英文课名 - 星期几」的通用模式，跟粘贴解析器曾用的规则同一个思路
_CLASS_HEAD = re.compile(r"^(.+?)\s*[-–—]\s*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)", re.I)


def class_type_from_title(title: str) -> str:
    """从 workout 的 Name 字段里抠出课名，抠不出来就返回空字符串。"""
    m = _CLASS_HEAD.match((title or "").strip())
    return m.group(1).strip() if m else ""


def _is_real(record: dict) -> bool:
    """过滤 OutSystems 的空记录占位符。

    Id 缺失时视为真实记录 —— 有些组件本来就不带 Id。
    只有明确等于 "0" 才判定为占位符。
    """
    rid = record.get("Id")
    return rid is None or str(rid) != EMPTY_ID


def _classify(title: str, scheme: str) -> str:
    t = (title or "").strip()
    if _TITLE_WARMUP.match(t):
        return "warmup"
    if _TITLE_COOLDOWN.match(t):
        return "cooldown"
    if _TITLE_ACCESSORY.match(t):
        return "accessory"
    s = scheme or ""
    if _METCON_SCORE.search(s) or _METCON_SCORE.search(t):
        return "metcon"
    if _LIFT_WORDS.search(t):
        return "strength"
    return "metcon"


def parse_workout(payload: dict, *, include_notes: bool = False) -> dict:
    """把 GetAllWorkoutData 的响应转成 {title, notes, sections[]}。

    拿不到内容时返回空 sections —— **不编造原因**。
    调用方自己判断要不要提示用户改用训练记录编辑器手写。
    """
    # 每一层都用 `or {}` 而不是 `.get(key, {})`：后者只在 key 缺失时才生效，
    # key 存在但值是 None（Wodify 完全可能返回 {"data": null}）时会拿到 None
    # 而不是默认值，下一步 .get() 就直接崩溃
    data = payload.get("data") or payload
    response = data.get("Response") or {}
    response_wod = response.get("ResponseWOD") or {}
    workout = response_wod.get("ResponseWorkout") or {}
    if not workout:
        return {"title": "", "notes": "", "sections": [], "empty_reason": None}

    components = (workout.get("WorkoutComponents") or {}).get("List") or []

    sections: list[dict] = []
    cur: dict | None = None

    for comp in components:
        if not isinstance(comp, dict) or not _is_real(comp):
            continue

        name = (comp.get("Name") or "").strip()
        comment = (comp.get("Comment") or "").strip()
        # metcon 的动作在 Description，不在 Name/Comment
        description = (comp.get("Description") or "").strip()
        # 力量组的组次方案，纯文本带真实换行
        scheme = (comp.get("MeasureRepScheme") or "").strip()
        is_section = bool(comp.get("IsSection"))

        if is_section:
            cur = {
                "id": f"s{len(sections) + 1}",
                "kind": _classify(name, scheme),
                "title": name,
                "score": scheme,
                "lines": [],
                "meta": [],
                "equip": [],
                "levels": [],
            }
            sections.append(cur)
            if comment:
                cur["meta"].append(comment)
            continue

        # 不是段落标记 → 归入当前段落；没有当前段落就开一个。
        # 这个分支只会在还没遇到任何段落标记时触发（一旦 cur 被设过就不会再变回
        # None），所以这里没有"继承上一个段落的 kind"这回事可言，直接归类
        if cur is None:
            cur = {
                "id": f"s{len(sections) + 1}",
                "kind": _classify(name, scheme),
                "title": name,
                "score": scheme,
                "lines": [],
                "meta": [],
                "equip": [],
                "levels": [],
            }
            sections.append(cur)
            body_lines = _lines_of(description, scheme, comment)
            cur["lines"].extend(body_lines)
            continue

        # 组件名单独成行，随后是它的内容
        if name and name != cur["title"]:
            cur["lines"].append(name)
        cur["lines"].extend(_lines_of(description, scheme, comment))

    return {
        "title": (workout.get("Name") or "").strip(),
        "notes": (workout.get("Notes") or "").strip() if include_notes else "",
        "sections": sections,
        "empty_reason": None,
    }


def _lines_of(description: str, scheme: str, comment: str) -> list[str]:
    """把一个组件的正文拆成行。

    顺序有意为之：动作内容（Description）在前，组次方案在后，
    备注最后 —— 跟课表上的阅读顺序一致。
    """
    out: list[str] = []
    for blob in (description, scheme, comment):
        if not blob:
            continue
        for line in blob.replace("\r\n", "\n").split("\n"):
            line = line.strip()
            if line:
                out.append(line)
    return out


def parse_schedule(payload: dict) -> list[dict]:
    """把 GetClassList 的响应转成当天的班级列表，按 ProgramId 去重。

    不同 program（比如 CrossFit 和 Pump & Burn）当天可能同时排课，各自的
    workout 内容完全独立——见 client.query() 的 program_id 参数、
    sync.pull_week() 的两步查询。这里只负责把 program 列表摘出来，
    真正按 program 分别查 workout 是调用方的事。

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

    seen_programs: set[str] = set()
    classes: list[dict] = []
    for row in rows:
        if not isinstance(row, dict) or not _is_real(row):
            continue
        program_id = row.get("ProgramId")
        if program_id is None:
            continue
        program_id = str(program_id)
        if program_id in seen_programs:
            continue
        seen_programs.add(program_id)
        classes.append(
            {
                "id": row.get("Id"),
                "name": row.get("Name"),
                "start_time": row.get("StartTime"),
                "program_id": program_id,
            }
        )
    return classes


def to_wod_row(day: str, parsed: dict, raw: dict) -> dict:
    """转成 wods 表的一行。原文永久保留，方便日后用更好的规则重解析。"""
    title = parsed["title"]
    return {
        "day": day,
        "class_type": class_type_from_title(title),
        "title": title or f"WOD {day}",
        "sections": parsed["sections"],
        "raw": raw,
        "source": "wodify_api",
    }

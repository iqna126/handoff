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


def to_wod_row(day: str, class_type: str, parsed: dict, raw: dict) -> dict:
    """转成 wods 表的一行。原文永久保留，方便日后用更好的规则重解析。"""
    return {
        "day": day,
        "class_type": class_type,
        "title": parsed["title"] or f"WOD {day}",
        "sections": parsed["sections"],
        "raw": raw,
        "source": "wodify_api",
    }

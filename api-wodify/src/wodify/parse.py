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

import html
import re

EMPTY_ID = "0"

# scaling 档位块：一个独立组件，Name 形如 "[No, I am Your Father: Levels]"，
# 内容（Description/Comment）是好几个档位挤在一起的富文本 HTML——见
# _attach_levels()。跟被删除的粘贴解析器（老版单文件 App 的 wodparse.js）
# 认的是同一套关键词，只是这边处理的是 API 返回的 HTML 组件，不是粘贴的
# 纯文本行。
_LEVELS_BLOCK = re.compile(r"^\[(.+?):\s*Levels?\]$", re.I)
_LEVEL_HEAD = re.compile(
    r"^(RX|Level\s*\d+|Masters\s*\d+\+?|Competitor|Scaled|Hotel Gym\s*/?\s*Travel|Travel|Beginner)"
    r"\s*:\s*(.*)$",
    re.I,
)
_BLOCK_CLOSE = re.compile(r"</(p|div|li)>", re.I)
_BR = re.compile(r"<br\s*/?>", re.I)
_TAG = re.compile(r"<[^>]+>")

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


def _classify(title: str, scheme: str, flag_kind: str | None = None) -> str:
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
    # 标题本身给不出信号时（最常见：接续上一个组件、没有自己名字的空标题
    # 组件），优先信 Wodify 自己打的类型标记，而不是直接落到下面写死的
    # "metcon" 默认值——见 _kind_from_flags 的说明。
    if flag_kind is not None:
        return flag_kind
    return "metcon"


def _kind_from_flags(comp: dict) -> str | None:
    """Wodify 给每个组件自己打的内容类型标记：IsWarmup/IsGymnastics/
    IsWeightlifting/IsMetcon。真机抓包证实这些字段确实存在，且它们自己的
    App 显然是靠这些区分展示的——不是只有 IsSection 一种分段信号。

    用来判断"这个组件要不要单独另开一个段落"：同一个 IsSection 标记
    （比如"Warm-Up:"）后面经常紧跟着真正的力量训练组件（比如
    IsWeightlifting=true 的"Romanian Deadlift (RDL)"），靠标题瞎猜会把
    它当成热身内容的一部分折起来——这是真机测试中被指出、又用真实数据
    核实过的问题，标题关键词判断不出来，只有这个标记能看出来。
    """
    if comp.get("IsWeightlifting"):
        return "strength"
    if comp.get("IsMetcon"):
        return "metcon"
    if comp.get("IsGymnastics"):
        return "strength"
    if comp.get("IsWarmup"):
        return "warmup"
    return None


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

        # scaling 档位块：不当成普通内容行追加，挂到最近一个 metcon 段落的
        # levels 字段上——不 continue 的话，这个组件的原始 HTML 会被当成
        # 普通文本重复出现一遍，跟 levels 里已经拆好的内容对不上
        levels_match = _LEVELS_BLOCK.match(name)
        if levels_match and not is_section:
            target = next((s for s in reversed(sections) if s["kind"] == "metcon"), None)
            if target is not None:
                raw_blob = "\n".join(b for b in (description, scheme, comment) if b)
                _attach_levels(target, raw_blob)
            continue

        if is_section:
            cur = {
                "id": f"s{len(sections) + 1}",
                "kind": _classify(name, scheme, _kind_from_flags(comp)),
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
            # 段落标记自己的 Description/MeasureRepScheme/Comment 往往就是这个
            # 段落的全部正文——WARM-UP/Cool-Down 这类段落经常只有一个 IsSection
            # 组件，重量、组数、视频链接全写在它自己的 Comment 里，不折进 lines
            # 就等于内容彻底消失（只进了没人读的 meta）。跟下面两个分支保持一致。
            cur["lines"].extend(_lines_of(description, scheme, comment))
            continue

        # 不是段落标记——但如果这个组件自己的类型标记跟当前段落的 kind
        # 对不上（比如当前在"warmup"段落里，这个组件却是
        # IsWeightlifting=true），说明它是被塞进同一个 IsSection 标记下面
        # 的另一类真实内容，得单独另开一个段落，不能囫囵折进当前段落里
        # （见 _kind_from_flags 的说明，这是真机数据证实过的真实问题）。
        flag_kind = _kind_from_flags(comp)
        if cur is None or (flag_kind is not None and flag_kind != cur["kind"]):
            cur = {
                "id": f"s{len(sections) + 1}",
                "kind": _classify(name, scheme, flag_kind),
                "title": name,
                "score": scheme,
                "lines": [],
                "meta": [],
                "equip": [],
                "levels": [],
            }
            sections.append(cur)
            cur["lines"].extend(_lines_of(description, scheme, comment))
            continue

        # 归入当前段落：组件名单独成行，随后是它的内容
        if name and name != cur["title"]:
            cur["lines"].append(name)
        cur["lines"].extend(_lines_of(description, scheme, comment))

    return {
        "title": (workout.get("Name") or "").strip(),
        "notes": (workout.get("Notes") or "").strip() if include_notes else "",
        "sections": sections,
        "empty_reason": None,
    }


def _html_to_lines(blob: str) -> list[str]:
    """富文本 HTML → 按段落拆开的纯文本行。

    先把块级标签的收尾换成真换行，再去标签——不然相邻的 <p> 会被粘成
    一整行没有空格（前端 web/js/htmlclean.js 的 stripHtml 是同一个道理，
    这里是 Python 版本，服务端解析 scaling 档位要用）。
    """
    text = _BLOCK_CLOSE.sub("\n", blob or "")
    text = _BR.sub("\n", text)
    text = _TAG.sub("", text)
    text = html.unescape(text)
    return [line.strip() for line in text.split("\n") if line.strip()]


def _attach_levels(section: dict, raw_blob: str) -> None:
    """把"[Xxx: Levels]"这个组件的内容拆成每个档位一段，挂到 section["levels"]。

    档位标题行形如 "Level 2:"、"Masters 55+:"、"Competitor:"，同一行冒号
    后面如果还有内容（比如 "RX: 21-15-9"）也算这个档位的第一行。识别不到
    任何档位标题就什么都不做——不编造结构。

    主 WOD 本身没有单独出现在 Levels 块里（它是 section 自己的 lines），
    补一份 RX 档进去，方便调用方"档位列表里第一个永远是 RX"这个假设成立。
    """
    lines = _html_to_lines(raw_blob)
    levels: list[dict] = []
    cur_level: dict | None = None
    for line in lines:
        m = _LEVEL_HEAD.match(line)
        if m:
            cur_level = {"name": m.group(1).strip(), "lines": []}
            levels.append(cur_level)
            rest = (m.group(2) or "").strip()
            if rest:
                cur_level["lines"].append(rest)
            continue
        if cur_level is not None:
            cur_level["lines"].append(line)

    if not levels:
        return
    if not any(lv["name"].upper() == "RX" for lv in levels):
        levels.insert(0, {"name": "RX", "lines": list(section["lines"])})
    section["levels"] = levels


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
        if not isinstance(row, dict) or not _is_real(row):
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

import pytest

from wodify import actions


class TestAllowlist:
    def test_registered_actions_resolve(self):
        for name in ("schedule", "workout", "bookings"):
            path = actions.resolve(name)
            assert path.startswith("WodifyClient")

    def test_unregistered_action_refused(self):
        with pytest.raises(actions.NotAllowed, match="未登记"):
            actions.resolve("GetSomethingElse")

    def test_every_registered_action_passes_write_guard(self):
        # 白名单里的每一条都必须自己也过得了守卫，
        # 否则说明我们登记了一个会改状态的端点
        for _name, path in actions.ACTIONS.items():
            actions.assert_read_only(path)


class TestWriteGuard:
    # 这些是 Wodify 真实存在的写端点，必须一律拒绝
    REAL_WRITE_PATHS = [
        "WodifyClient_Class/Classes/Class/ActionReserveClass",
        "WodifyClient_Class/Classes/Class/ActionCancelReservation",
        "WodifyClient_Class/Classes/Class/ActionSignInToClass",
        "WodifyClient_WOD/WOD/SaveWorkoutResult",
        "WodifyClient_Store/Store/PurchaseMembership",
        "WodifyClient_Account/Account/UpdateProfile",
        "WodifyClient_Terms/Terms/AcceptTerms",
    ]

    @pytest.mark.parametrize("path", REAL_WRITE_PATHS)
    def test_real_write_endpoints_refused(self, path):
        with pytest.raises(actions.NotAllowed):
            actions.assert_read_only(path)

    def test_guard_applies_even_to_allowlisted_entries(self):
        # 模拟「有人不小心往白名单里加了写端点」
        original = dict(actions.ACTIONS)
        actions.ACTIONS["oops"] = "WodifyClient_Class/Classes/Class/ActionReserveClass"
        try:
            with pytest.raises(actions.NotAllowed):
                actions.resolve("oops")
        finally:
            actions.ACTIONS.clear()
            actions.ACTIONS.update(original)

    def test_readonly_paths_not_falsely_refused(self):
        # 目前这两条路径压根不命中任何 WRITE_MARKERS，靠自己就能过关，
        # 不代表 _is_false_positive 豁免机制本身被测到了——那个在下面单独测
        safe = [
            "WodifyClient_DataFetch_WB/Schedule_OS/"
            "GetClassList_ForClient_WithReservationCounts_WB/"
            "DataActionGetClassList_ForClient_WithReservationCounts",
            "WodifyClient_DataFetch_WB/WOD_Flow/GetAllWorkoutData_WB/DataActionGetAllWorkoutData",
        ]
        for path in safe:
            actions.assert_read_only(path)


class TestFalsePositiveExemption:
    """直接测 _is_false_positive 的位置判定逻辑，不依赖真实的 marker/安全片段
    是否碰巧字面重合（现在这几个真实值从不重合，所以只能用构造出来的例子测）。
    """

    def test_marker_entirely_inside_a_safe_substring_is_exempt(self, monkeypatch):
        monkeypatch.setattr(actions, "_SAFE_SUBSTRINGS", ("safechunk",))
        low = "some/safechunk/path"
        assert actions._is_false_positive(low, "chunk") is True

    def test_marker_outside_any_safe_substring_is_not_exempt(self, monkeypatch):
        monkeypatch.setattr(actions, "_SAFE_SUBSTRINGS", ("safechunk",))
        low = "some/safechunk/set/path"
        assert actions._is_false_positive(low, "set") is False

    def test_marker_also_appearing_outside_a_safe_substring_is_not_exempt(self, monkeypatch):
        # "reserve" 是 "reservecount" 的字面子串——旧写法只看 marker 是否
        # 出现在某个安全片段里，会把路径里独立出现的另一个 "reserve" 也放过
        monkeypatch.setattr(actions, "_SAFE_SUBSTRINGS", ("reservecount",))
        low = "some/reservecount/reserve/path"
        assert actions._is_false_positive(low, "reserve") is False

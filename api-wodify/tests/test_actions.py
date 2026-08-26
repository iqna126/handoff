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
        for name, path in actions.ACTIONS.items():
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
        # DataAction / DataFetch / ReservationCounts 字面上撞到写标记，
        # 但它们是只读路径的合法组成部分
        safe = [
            "WodifyClient_DataFetch_WB/Schedule_OS/"
            "GetClassList_ForClient_WithReservationCounts_WB/"
            "DataActionGetClassList_ForClient_WithReservationCounts",
            "WodifyClient_DataFetch_WB/WOD_Flow/GetAllWorkoutData_WB/"
            "DataActionGetAllWorkoutData",
        ]
        for path in safe:
            actions.assert_read_only(path)

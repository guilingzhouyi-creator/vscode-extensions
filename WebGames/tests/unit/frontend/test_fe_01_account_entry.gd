# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第1卷: 账号与入口系统白模测试
# 文件路径: res://tests/unit/frontend/test_fe_01_account_entry.gd
# ==============================================================================
class_name TestFE01AccountEntry
extends RefCounted

const FeMountHelper = preload("res://tests/unit/frontend/fe_mount_test_helper.gd")

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "FE Vol 01: 账号与入口系统（登录/注册/选服/创角）"
	ServiceLocator.reset()
	ServiceLocator.set_mode("mock")

	results.append(_test_login_register_form_flow())
	results.append(_test_character_slot_selection())
	results.append(_test_server_list_selection())
	results.append(_test_mounted_real_account_entry())
	ServiceLocator.reset()

	var passed_cnt = 0
	for r in results:
		if r.get("passed", false):
			passed_cnt += 1

	return {
		"domain": domain_name,
		"passed_count": passed_cnt,
		"total_count": results.size(),
		"all_passed": (passed_cnt == results.size()),
		"results": results
	}

static func _test_login_register_form_flow() -> Dictionary:
	var mock_auth := ServiceLocator.get_instance().auth()
	if mock_auth != null:
		mock_auth.set("simulate_delay_ms", 0)
	var view = AccountEntryView.new()
	view.switch_state(AccountEntryView.EntryState.LOGIN)

	var res_empty = view.submit_login("", "123")
	var res_ok = view.submit_login("arthur", "pwd123")

	var state_ok = (view.current_state == AccountEntryView.EntryState.CHARACTER_SELECT)
	var passed = (not res_empty.success) and res_ok.success and state_ok and (view.current_account_id == "ACC_ARTHUR")
	view.free()
	return {
		"test": "TC-FE01-01: 登录/注册表单输入校验与进入角色选择状态机流转",
		"passed": passed
	}

static func _test_character_slot_selection() -> Dictionary:
	var view = AccountEntryView.new()
	view.apply_snapshot({"character_slots": [
		{"slot_id": "SLOT_01", "name": "圣骑士艾伦", "level": 15, "class": "PALADIN"},
		{"slot_id": "SLOT_02", "name": "游侠罗宾", "level": 8, "class": "RANGER"}
	]})

	var res = view.select_character_slot("SLOT_01")
	var passed = res.success and (view.selected_character_slot == "SLOT_01") and (view.character_slots.size() == 2)
	view.free()
	return {
		"test": "TC-FE01-02: 角色槽位快照加载与插槽选中交互响应",
		"passed": passed
	}

static func _test_server_list_selection() -> Dictionary:
	var view = AccountEntryView.new()
	view.switch_state(AccountEntryView.EntryState.SERVER_SELECT)

	var res = view.select_server("SERVER_01")
	var passed = res.success and (view.current_server_id == "SERVER_01") and (view.server_list.size() >= 2)
	view.free()
	return {
		"test": "TC-FE01-03: 服务器列表多节点切换与选中状态保持",
		"passed": passed
	}

static func _test_mounted_real_account_entry() -> Dictionary:
	var had_binding_registry := UIBindingRegistry.has_active_instance()
	var orphan_before := int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT))
	var mount_handle := FeMountHelper.mount_scene("res://frontend/views/account_entry/account_entry_view.tscn", "real")
	var passed := bool(mount_handle.get("ok", false))
	var mounted_view: AccountEntryView = mount_handle.get("view", null) as AccountEntryView
	var details := ""
	if mounted_view != null:
		var empty_reply := mounted_view.submit_login("", "")
		var guest_reply: Array[Dictionary] = []
		ServiceLocator.get_instance().auth().login_guest_async("fe01_e2e_device", func(auth_outcome: Dictionary) -> void:
			guest_reply.append(auth_outcome)
		)
		mounted_view.switch_state(AccountEntryView.EntryState.SERVER_SELECT)
		mounted_view.switch_state(AccountEntryView.EntryState.CHARACTER_SELECT)
		mounted_view._on_login_forgot_pressed()
		var guest_ok := (not guest_reply.is_empty()) and bool(guest_reply[0].get("success", false))
		details = "mounted=%s children=%d empty=%s guest=%s" % [str(mounted_view.is_mounted_in_tree()), mounted_view.get_child_count(), str(empty_reply), str(guest_reply)]
		passed = passed and mounted_view.is_mounted_in_tree() and mounted_view.get_child_count() > 0 and (not bool(empty_reply.get("success", true))) and guest_ok
	FeMountHelper.unmount_scene(mount_handle)
	NavManager.reset_instance()
	if not had_binding_registry:
		UIBindingRegistry.reset_instance()
	var orphan_after := int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT))
	var orphan_delta := orphan_after - orphan_before
	var all_ok := passed and (orphan_after <= orphan_before)
	if not all_ok:
		push_warning("TC-FE01-04 fail: passed=%s orphan_delta=%d %s" % [str(passed), orphan_delta, details])
	return {
		"test": "TC-FE01-04: 真场景挂载 account_entry_view.tscn（real 模式鉴权状态机与零残留）",
		"passed": all_ok,
		"details": details + " orphan_delta=%d" % orphan_delta
	}

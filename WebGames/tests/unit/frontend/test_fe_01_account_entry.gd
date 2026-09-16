# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第1卷: 账号与入口系统白模测试
# 文件路径: res://tests/unit/frontend/test_fe_01_account_entry.gd
# ==============================================================================
class_name TestFE01AccountEntry
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "FE Vol 01: 账号与入口系统（登录/注册/选服/创角）"

	results.append(_test_login_register_form_flow())
	results.append(_test_character_slot_selection())
	results.append(_test_server_list_selection())

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
	view.set_character_slots_snapshot([
		{ "slot_id": "SLOT_01", "name": "圣骑士艾伦", "level": 15, "class": "PALADIN" },
		{ "slot_id": "SLOT_02", "name": "游侠罗宾", "level": 8, "class": "RANGER" }
	])

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

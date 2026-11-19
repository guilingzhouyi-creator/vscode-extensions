# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第16卷: 系统与存档系统白模测试
# 文件路径: res://tests/unit/frontend/test_fe_16_system_save.gd
# ==============================================================================
class_name TestFE16SystemSave
extends RefCounted

const FeMountHelper = preload("res://tests/unit/frontend/fe_mount_test_helper.gd")

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "FE Vol 16: 系统与存档系统（存档管理/回放审计/GM作弊/CDKey）"

	results.append(_test_save_slots_hardcore_badge())
	results.append(_test_gm_console_toggle())
	results.append(_test_cdkey_input_submission())
	results.append(_test_mounted_real_system_save())

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

static func _test_save_slots_hardcore_badge() -> Dictionary:
	var view = SystemSaveView.new()
	view.apply_snapshot({"save_slots": [
		{ "slot_id": "SLOT_01", "char_name": "普通骑士", "is_hardcore": false },
		{ "slot_id": "SLOT_02", "char_name": "死斗狂战", "is_hardcore": true }
	]})

	var passed = (view.save_slots.size() == 2) and view.save_slots[1].is_hardcore
	view.free()
	return {
		"test": "TC-FE16-01: 存档多插槽列表加载与死斗硬核模式标红",
		"passed": passed
	}

static func _test_gm_console_toggle() -> Dictionary:
	var view = SystemSaveView.new()
	var state1 = view.toggle_gm_console()
	var state2 = view.toggle_gm_console()

	var passed = state1 and (not state2)
	view.free()
	return {
		"test": "TC-FE16-02: 管理员作弊控制台浮层快捷键展开与隐藏",
		"passed": passed
	}

static func _test_cdkey_input_submission() -> Dictionary:
	var view = SystemSaveView.new()
	var res = view.submit_cdkey_input("  kalar-2026-gift  ")

	var passed = res.success and (view.cdkey_input_text == "KALAR-2026-GIFT")
	view.free()
	return {
		"test": "TC-FE16-03: 礼包兑换码输入格式化大写与提交校验",
		"passed": passed
	}

static func _test_mounted_real_system_save() -> Dictionary:
	var orphan_before := int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT))
	var mount_handle := FeMountHelper.mount_scene("res://frontend/views/system_save/system_save_view.tscn", "real")
	var passed := bool(mount_handle.get("ok", false))
	var mounted_view: SystemSaveView = mount_handle.get("view", null) as SystemSaveView
	if mounted_view != null:
		mounted_view.apply_snapshot({"save_slots": [
			{ "slot_id": "SLOT_01", "char_name": "铁壁守卫", "is_hardcore": false }
		]})
		mounted_view._get_tabs().execute_gm_command("/help")
		var cdkey_outcome := mounted_view.submit_cdkey_input("KALAR-REAL-TEST")
		mounted_view._get_tabs().redeem_cdkey()
		passed = passed and mounted_view.is_mounted_in_tree() and mounted_view.get_child_count() > 0 and bool(cdkey_outcome.get("success", false))
	FeMountHelper.unmount_scene(mount_handle)
	var orphan_after := int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT))
	return {
		"test": "TC-FE16-04: 真场景挂载 system_save_view.tscn（real 模式存档/GM/CDKey与零残留）",
		"passed": passed and (orphan_after <= orphan_before)
	}

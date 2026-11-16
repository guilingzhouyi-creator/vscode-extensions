# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第3卷: 角色与养成系统白模测试
# 文件路径: res://tests/unit/frontend/test_fe_03_character_progression.gd
# ==============================================================================
class_name TestFE03CharacterProgression
extends RefCounted

const FeMountHelper = preload("res://tests/unit/frontend/fe_mount_test_helper.gd")

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "FE Vol 03: 角色与养成系统（面板/潜能加点/技能树/装备/背包）"

	results.append(_test_potential_allocation_preview())
	results.append(_test_equipment_slot_mount())
	results.append(_test_tab_navigation())
	results.append(_test_mounted_real_character_progression())

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

static func _test_potential_allocation_preview() -> Dictionary:
	var view = CharacterProgressionView.new()
	view.set_attributes_snapshot({ "STR": 12, "AGI": 10, "CON": 14, "INT": 8, "WIS": 10, "CHA": 10 }, 3)

	var r1 = view.preview_add_point("STR")
	var r2 = view.preview_add_point("STR")
	var r3 = view.preview_add_point("STR")
	var r_overflow = view.preview_add_point("STR")

	var passed = (r1.success and r2.success and r3.success) and (not r_overflow.success) and \
				 (view.attributes_preview["STR"] == 15) and (view.unallocated_points_preview == 0)
	view.free()
	return {
		"test": "TC-FE03-01: 六维属性加点实时试算与潜能点耗尽拦截",
		"passed": passed
	}

static func _test_equipment_slot_mount() -> Dictionary:
	var view = CharacterProgressionView.new()
	var sword_data = { "item_id": "KALAR:EQUIP:WEAPON_BLADE:STEEL_SWORD", "name": "精钢长剑", "atk": 25 }
	var res = view.equip_item_preview("MAIN_HAND", sword_data)

	var passed = res.success and (view.equipped_slots["MAIN_HAND"].item_id == sword_data.item_id)
	view.free()
	return {
		"test": "TC-FE03-02: 装备穿脱与战备槽位挂载预览状态变更",
		"passed": passed
	}

static func _test_tab_navigation() -> Dictionary:
	var view = CharacterProgressionView.new()
	view.switch_tab(CharacterProgressionView.TabType.SKILL_TREE)
	var passed = (view.current_tab == CharacterProgressionView.TabType.SKILL_TREE)
	view.free()
	return {
		"test": "TC-FE03-03: 角色养成子页签切换与导航路由自洽",
		"passed": passed
	}

static func _test_mounted_real_character_progression() -> Dictionary:
	var orphan_before := int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT))
	var mount_handle := FeMountHelper.mount_scene("res://frontend/views/character_progression/character_progression_view.tscn", "real")
	var passed := bool(mount_handle.get("ok", false))
	var mounted_view: CharacterProgressionView = mount_handle.get("view", null) as CharacterProgressionView
	if mounted_view != null:
		mounted_view.set_attributes_snapshot({ "STR": 14, "AGI": 11, "CON": 12, "INT": 9, "WIS": 10, "CHA": 10 }, 2)
		var alloc_reply := mounted_view.preview_add_point("STR")
		mounted_view._tabs._on_pot_confirm_pressed()
		mounted_view.switch_tab(CharacterProgressionView.TabType.EQUIPMENT)
		mounted_view.switch_tab(CharacterProgressionView.TabType.ATTRIBUTES)
		passed = passed and mounted_view.is_mounted_in_tree() and mounted_view.get_child_count() > 0 and bool(alloc_reply.get("success", false)) and mounted_view.attributes_preview["STR"] == 15
	FeMountHelper.unmount_scene(mount_handle)
	var orphan_after := int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT))
	return {
		"test": "TC-FE03-04: 真场景挂载 character_progression_view.tscn（real 模式潜能确认与零残留）",
		"passed": passed and (orphan_after <= orphan_before)
	}

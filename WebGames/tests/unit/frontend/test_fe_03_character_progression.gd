# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第3卷: 角色与养成系统白模测试
# 文件路径: res://tests/unit/frontend/test_fe_03_character_progression.gd
# ==============================================================================
class_name TestFE03CharacterProgression
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "FE Vol 03: 角色与养成系统（面板/潜能加点/技能树/装备/背包）"

	results.append(_test_potential_allocation_preview())
	results.append(_test_equipment_slot_mount())
	results.append(_test_tab_navigation())

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

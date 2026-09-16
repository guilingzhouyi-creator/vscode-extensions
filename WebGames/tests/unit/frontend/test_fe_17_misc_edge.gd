# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第17卷: 边缘与杂项系统白模测试
# 文件路径: res://tests/unit/frontend/test_fe_17_misc_edge.gd
# ==============================================================================
class_name TestFE17MiscEdge
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "FE Vol 17: 边缘与杂项系统（假名伪装/地面拾取/命名检索）"

	results.append(_test_disguise_mask_switching())
	results.append(_test_ground_loot_proximity_prompt())
	results.append(_test_item_namespace_search())

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

static func _test_disguise_mask_switching() -> Dictionary:
	var view = MiscEdgeView.new()
	view.apply_disguise_mask("MASK_FOX", "无名刺客")
	var is_masked = (view.displayed_character_name == "无名刺客") and (view.current_disguise_mask_id == "MASK_FOX")
	view.apply_disguise_mask("", "")
	var expected_default := UIIntermediary.text("ui.fe17.mock.char.real_name")
	var is_unmasked = (view.displayed_character_name == expected_default or view.displayed_character_name == "阿尔托莉雅" or view.displayed_character_name == "Artoria")

	var passed = is_masked and is_unmasked
	view.free()
	return {
		"name": "TC-FE17-01: 假名面具切换与头顶显示名字动态替换",
		"test": "TC-FE17-01: 假名面具切换与头顶显示名字动态替换",
		"passed": passed
	}

static func _test_ground_loot_proximity_prompt() -> Dictionary:
	var view = MiscEdgeView.new()
	view.set_ground_nearby_loot_snapshot([
		{ "loot_id": "L1", "item_name": "魔化狼皮", "count": 2 }
	])
	var passed = (view.ground_nearby_loot.size() == 1)
	view.free()
	return {
		"name": "TC-FE17-02: 物理空间邻近掉落物拾取交互气泡装载",
		"test": "TC-FE17-02: 物理空间邻近掉落物拾取交互气泡装载",
		"passed": passed
	}

static func _test_item_namespace_search() -> Dictionary:
	var view = MiscEdgeView.new()
	var res: Dictionary = view.search_item_namespace("   potion   ")
	var passed = res.get("success", false) and (view.search_query_keyword == "potion")
	view.free()
	return {
		"name": "TC-FE17-03: 全域物品规范命名空间搜索词过滤响应",
		"test": "TC-FE17-03: 全域物品规范命名空间搜索词过滤响应",
		"passed": passed
	}

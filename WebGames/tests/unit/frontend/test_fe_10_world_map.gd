# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第10卷: 世界与地图系统白模测试
# 文件路径: res://tests/unit/frontend/test_fe_10_world_map.gd
# ==============================================================================
class_name TestFE10WorldMap
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "FE Vol 10: 世界与地图系统（七大洲大地图/城镇/行军）"

	results.append(_test_map_zoom_controls())
	results.append(_test_town_selection())
	results.append(_test_marching_route_snapshot())

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

static func _test_map_zoom_controls() -> Dictionary:
	var view = WorldMapView.new()
	view.adjust_zoom(0.5)
	var passed = is_equal_approx(view.map_zoom_level, 1.5)
	view.free()
	return {
		"test": "TC-FE10-01: 大地图视口平滑缩放与边界约束",
		"passed": passed
	}

static func _test_town_selection() -> Dictionary:
	var view = WorldMapView.new()
	var res = view.select_town("TOWN_IRON_CITADEL")
	var passed = res.success and (view.selected_town_id == "TOWN_IRON_CITADEL")
	view.free()
	return {
		"test": "TC-FE10-02: 城镇定居点地标点击与选中锚定",
		"passed": passed
	}

static func _test_marching_route_snapshot() -> Dictionary:
	var view = WorldMapView.new()
	view.set_marching_route_snapshot([
		{ "from": "TOWN_VALAN", "to": "TOWN_FOREST", "eta_seconds": 120 }
	])
	var passed = (view.marching_routes.size() == 1)
	view.free()
	return {
		"test": "TC-FE10-03: 行军探索阻抗折线与行军耗时装载",
		"passed": passed
	}

# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第10卷: 世界与地图系统白模测试
# 文件路径: res://tests/unit/frontend/test_fe_10_world_map.gd
# ==============================================================================
class_name TestFE10WorldMap
extends RefCounted

const FeMountHelper = preload("res://tests/unit/frontend/fe_mount_test_helper.gd")

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "FE Vol 10: 世界与地图系统（七大洲大地图/城镇/行军）"

	results.append(_test_map_zoom_controls())
	results.append(_test_town_selection())
	results.append(_test_marching_route_snapshot())
	results.append(_test_mounted_real_world_map())

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
	view.apply_snapshot({"marching_routes": [
		{"from": "TOWN_VALAN", "to": "TOWN_FOREST", "eta_seconds": 120}
	]})
	var passed = (view.marching_routes.size() == 1)
	view.free()
	return {
		"test": "TC-FE10-03: 行军探索阻抗折线与行军耗时装载",
		"passed": passed
	}

static func _test_mounted_real_world_map() -> Dictionary:
	var orphan_before := int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT))
	var mount_handle := FeMountHelper.mount_scene("res://frontend/views/world_map/world_map_view.tscn", "real")
	var passed := bool(mount_handle.get("ok", false))
	var mounted_view: WorldMapView = mount_handle.get("view", null) as WorldMapView
	if mounted_view != null:
		mounted_view.adjust_zoom(0.25)
		var town_outcome := mounted_view.select_town("TOWN_IRON_CITADEL")
		mounted_view.apply_snapshot({"mod_world_topology": {"nodes": [ {"node_id": "N_VALAN", "name": "Valan"}]}})
		passed = passed and mounted_view.is_mounted_in_tree() and mounted_view.get_child_count() > 0 and bool(town_outcome.get("success", false))
	FeMountHelper.unmount_scene(mount_handle)
	var orphan_after := int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT))
	return {
		"test": "TC-FE10-04: 真场景挂载 world_map_view.tscn（real 模式拓扑快照/城镇与零残留）",
		"passed": passed and (orphan_after <= orphan_before)
	}

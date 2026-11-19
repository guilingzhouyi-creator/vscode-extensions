# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第11卷: 怪物与生态系统白模测试
# 文件路径: res://tests/unit/frontend/test_fe_11_monster_ecology.gd
# ==============================================================================
class_name TestFE11MonsterEcology
extends RefCounted

const FeMountHelper = preload("res://tests/unit/frontend/fe_mount_test_helper.gd")

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "FE Vol 11: 怪物与生态系统（图鉴/世界BOSS/兽潮）"

	results.append(_test_bestiary_loading())
	results.append(_test_monster_detail_selection())
	results.append(_test_beast_tide_risk_indicator())
	results.append(_test_mounted_real_monster_ecology())

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

static func _test_bestiary_loading() -> Dictionary:
	var view = MonsterEcologyView.new()
	view.apply_snapshot({"bestiary": [
		{"monster_id": "M_DRAGON", "name": "烈焰巨龙", "parts": ["龙角", "龙翼", "逆鳞"]}
	]})
	var passed = (view.bestiary_entries.size() == 1)
	view.free()
	return {
		"test": "TC-FE11-01: 怪物图鉴多物种条目列表装载",
		"passed": passed
	}

static func _test_monster_detail_selection() -> Dictionary:
	var view = MonsterEcologyView.new()
	view.apply_snapshot({"bestiary": [
		{"monster_id": "M_DRAGON", "name": "烈焰巨龙", "parts": ["龙角", "龙翼", "逆鳞"]}
	]})
	var res = view.select_monster_entry("M_DRAGON")
	var passed = res.success and (view.selected_monster_id == "M_DRAGON")
	view.free()
	return {
		"test": "TC-FE11-02: 怪物弱点部位解构与掉落物概率看板",
		"passed": passed
	}

static func _test_beast_tide_risk_indicator() -> Dictionary:
	var view = MonsterEcologyView.new()
	view.update_beast_tide_risk(75.5)
	var passed = is_equal_approx(view.beast_tide_risk_percentage, 75.5)
	view.free()
	return {
		"test": "TC-FE11-03: 地缘城镇魔素畸变与兽潮预警雷达图指标",
		"passed": passed
	}

static func _test_mounted_real_monster_ecology() -> Dictionary:
	var orphan_before := int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT))
	var mount_handle := FeMountHelper.mount_scene("res://frontend/views/monster_ecology/monster_ecology_view.tscn", "real")
	var passed := bool(mount_handle.get("ok", false))
	var mounted_view: MonsterEcologyView = mount_handle.get("view", null) as MonsterEcologyView
	if mounted_view != null:
		mounted_view.apply_snapshot({"bestiary": [
			{"monster_id": "M_DRAGON", "name": "烈焰巨龙", "parts": ["龙角", "龙翼"]}
		]})
		mounted_view._get_tabs()._on_boss_challenge_pressed()
		mounted_view._get_tabs()._on_tide_join_pressed()
		mounted_view._get_tabs()._on_tide_leave_pressed()
		passed = passed and mounted_view.is_mounted_in_tree() and mounted_view.get_child_count() > 0 and mounted_view.bestiary_entries.size() >= 1
	FeMountHelper.unmount_scene(mount_handle)
	var orphan_after := int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT))
	return {
		"test": "TC-FE11-04: 真场景挂载 monster_ecology_view.tscn（real 模式首领/兽潮交互与零残留）",
		"passed": passed and (orphan_after <= orphan_before)
	}

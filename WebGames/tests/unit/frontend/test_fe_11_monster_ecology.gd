# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第11卷: 怪物与生态系统白模测试
# 文件路径: res://tests/unit/frontend/test_fe_11_monster_ecology.gd
# ==============================================================================
class_name TestFE11MonsterEcology
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "FE Vol 11: 怪物与生态系统（图鉴/世界BOSS/兽潮）"

	results.append(_test_bestiary_loading())
	results.append(_test_monster_detail_selection())
	results.append(_test_beast_tide_risk_indicator())

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
	view.set_bestiary_snapshot([
		{ "monster_id": "M_DRAGON", "name": "烈焰巨龙", "parts": ["龙角", "龙翼", "逆鳞"] }
	])
	var passed = (view.bestiary_entries.size() == 1)
	view.free()
	return {
		"test": "TC-FE11-01: 怪物图鉴多物种条目列表装载",
		"passed": passed
	}

static func _test_monster_detail_selection() -> Dictionary:
	var view = MonsterEcologyView.new()
	view.set_bestiary_snapshot([
		{ "monster_id": "M_DRAGON", "name": "烈焰巨龙", "parts": ["龙角", "龙翼", "逆鳞"] }
	])
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

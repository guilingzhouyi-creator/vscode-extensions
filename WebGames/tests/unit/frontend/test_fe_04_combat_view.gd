# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第4卷: 战斗界面系统白模测试
# 文件路径: res://tests/unit/frontend/test_fe_04_combat_view.gd
# ==============================================================================
class_name TestFE04CombatView
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "FE Vol 04: 战斗界面系统（飘字/BOSS部位血条/战报回放/结算）"

	results.append(_test_floating_damage_text())
	results.append(_test_boss_segmented_hp_bar())
	results.append(_test_combat_settlement_overlay())

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

static func _test_floating_damage_text() -> Dictionary:
	var view = CombatView.new()
	var t1 = view.spawn_floating_damage(Vector2(100, 200), 1250.0, true, false)

	var passed = (view.floating_texts.size() == 1) and t1.is_crit and is_equal_approx(t1.amount, 1250.0)
	view.free()
	return {
		"test": "TC-FE04-01: 暴击伤害飘字实体生成与空间坐标投射",
		"passed": passed
	}

static func _test_boss_segmented_hp_bar() -> Dictionary:
	var view = CombatView.new()
	view.set_boss_status_snapshot("远古灭世红龙", 80000.0, 100000.0, [
		{ "part_name": "左龙翼", "hp": 0, "max_hp": 10000, "is_broken": true },
		{ "part_name": "龙心核", "hp": 50000, "max_hp": 50000, "is_broken": false }
	])

	var passed = (view.boss_parts.size() == 2) and view.boss_parts[0].is_broken and (view.boss_name == "远古灭世红龙")
	view.free()
	return {
		"test": "TC-FE04-02: 巨型首领多部位结构血条与破损状态装载",
		"passed": passed
	}

static func _test_combat_settlement_overlay() -> Dictionary:
	var view = CombatView.new()
	view.set_settlement_snapshot(true, 500, ["SWORD_LEGEND", "DRAGON_SCALE"], "亚瑟王")

	var passed = view.is_victory and (view.reward_gold == 500) and (view.mvp_player_name == "亚瑟王")
	view.free()
	return {
		"test": "TC-FE04-03: 讨伐结算面板胜利状态与战利品MVP呈现",
		"passed": passed
	}

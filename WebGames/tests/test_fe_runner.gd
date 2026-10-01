# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端专项测试独立运行器
# 文件路径: res://tests/test_fe_runner.gd
# 职责: 在无头 Godot 中单独执行前端架构护栏与 17 大系统白模单测
# ==============================================================================
extends SceneTree

func _initialize() -> void:
	print("\n==============================================================================")
	print("  🎨  卡拉尔世界引擎 (KALAR WORLD ENGINE) - 前端全域专项测试执行  🎨")
	print("==============================================================================\n")

	var test_classes := [
		preload("res://tests/guards/test_frontend_boundary_guard.gd"),
		preload("res://tests/unit/frontend/test_frontend_boundary.gd"),
		preload("res://tests/unit/frontend/test_fe_01_account_entry.gd"),
		preload("res://tests/unit/frontend/test_fe_02_main_hud.gd"),
		preload("res://tests/unit/frontend/test_fe_03_character_progression.gd"),
		preload("res://tests/unit/frontend/test_fe_04_combat_view.gd"),
		preload("res://tests/unit/frontend/test_fe_05_economy_trade.gd"),
		preload("res://tests/unit/frontend/test_fe_06_gacha_wish.gd"),
		preload("res://tests/unit/frontend/test_fe_07_quest_causality.gd"),
		preload("res://tests/unit/frontend/test_fe_08_mail_system.gd"),
		preload("res://tests/unit/frontend/test_fe_09_guild_social.gd"),
		preload("res://tests/unit/frontend/test_fe_10_world_map.gd"),
		preload("res://tests/unit/frontend/test_fe_11_monster_ecology.gd"),
		preload("res://tests/unit/frontend/test_fe_12_crafting_workshop.gd"),
		preload("res://tests/unit/frontend/test_fe_13_grimoire_authoring.gd"),
		preload("res://tests/unit/frontend/test_fe_14_notification_bulletin.gd"),
		preload("res://tests/unit/frontend/test_fe_15_settings_center.gd"),
		preload("res://tests/unit/frontend/test_fe_16_system_save.gd"),
		preload("res://tests/unit/frontend/test_fe_17_misc_edge.gd"),
	]

	var all_ok := true
	var total_tests := 0
	var passed_tests := 0

	for tc in test_classes:
		if tc == null:
			print("[ FAIL ] 套件加载失败 (null)")
			all_ok = false
			continue

		var res: Dictionary = tc.run_all_tests()
		var d_name: String = res.get("domain", "未知套件")
		var d_all_passed: bool = res.get("all_passed", false)
		var p_cnt: int = res.get("passed_count", 0)
		var t_cnt: int = res.get("total_count", 0)

		total_tests += t_cnt
		passed_tests += p_cnt

		if not d_all_passed:
			all_ok = false
			print("[ FAIL ] %s (%d/%d PASS)" % [d_name, p_cnt, t_cnt])
			for item in res.get("results", []):
				if not item.get("passed", false):
					print("    ❌  %s" % item.get("test", item.get("name", "未命名测试")))
		else:
			print("[ PASS ] %s (%d/%d PASS)" % [d_name, p_cnt, t_cnt])

	print("\n==============================================================================")
	if all_ok:
		print("  总计: %d/%d 测试用例通过 | 结果: ALL PASS" % [passed_tests, total_tests])
	else:
		print("  总计: %d/%d 通过 | 结果: FAIL" % [passed_tests, total_tests])
	print("==============================================================================\n")
	UIBindingRegistry.reset_instance()
	quit(0 if all_ok else 1)

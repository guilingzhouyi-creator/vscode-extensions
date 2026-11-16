# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端专项测试独立运行器
# 文件路径: res://tests/test_fe_runner.gd
# 职责: 在无头 Godot 中单独执行前端架构护栏与 17 大系统白模单测
# ==============================================================================
extends SceneTree

var _has_executed: bool = false

func _initialize() -> void:
	pass

func _process(_delta: float) -> bool:
	if _has_executed:
		return true
	_has_executed = true
	_execute_fe_suites()
	return false

func _execute_fe_suites() -> void:
	print("\n==============================================================================")
	print("  🎨  卡拉尔世界引擎 (KALAR WORLD ENGINE) - 前端全域专项测试执行  🎨")
	print("==============================================================================\n")

	var test_classes := [
		preload("res://tests/guards/test_frontend_boundary_guard.gd"),
		preload("res://tests/unit/frontend/test_frontend_boundary.gd"),
		preload("res://tests/unit/frontend/test_frontend_architecture_and_bootstrap.gd"),
		preload("res://tests/unit/frontend/test_frontend_ui_state_and_mock.gd"),
		preload("res://tests/unit/frontend/test_frontend_infrastructure.gd"),
		preload("res://tests/unit/frontend/test_frontend_robustness.gd"),
		preload("res://tests/unit/frontend/test_frontend_error_domain.gd"),
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

	var initial_orphan_count := int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT))
	var all_ok := true
	var total_tests := 0
	var passed_tests := 0

	for tc in test_classes:
		var suite_stats := _run_single_fe_suite(tc)
		total_tests += int(suite_stats.get("total", 0))
		passed_tests += int(suite_stats.get("passed", 0))
		if not bool(suite_stats.get("all_passed", false)):
			all_ok = false

	_reset_all_fe_singletons()
	var orphan_delta := maxi(0, int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT)) - initial_orphan_count)
	if orphan_delta > 0:
		all_ok = false
		print("[ FAIL ] ObjectDB / Orphan Node 泄漏检测: delta=%d" % orphan_delta)

	print("\n==============================================================================")
	if all_ok:
		print("  总计: %d/%d 测试用例通过 | 孤立节点增量: %d | 结果: ALL PASS" % [passed_tests, total_tests, orphan_delta])
	else:
		print("  总计: %d/%d 通过 | 孤立节点增量: %d | 结果: FAIL" % [passed_tests, total_tests, orphan_delta])
	print("==============================================================================\n")
	quit(0 if all_ok else 1)

## 执行单个前端测试套件并返回标准化统计字典（保持主循环控制流扁平）
func _run_single_fe_suite(test_script: Variant) -> Dictionary:
	if test_script == null:
		print("[ FAIL ] 套件加载失败 (null)")
		return {"all_passed": false, "passed": 0, "total": 0}
	var suite_result: Dictionary = test_script.run_all_tests()
	var suite_name: String = str(suite_result.get("domain", "未知套件"))
	var suite_all_passed: bool = bool(suite_result.get("all_passed", false))
	var passed_count: int = int(suite_result.get("passed_count", suite_result.get("passed", 0)))
	var total_count: int = int(suite_result.get("total_count", suite_result.get("total", 0)))
	if suite_all_passed:
		print("[ PASS ] %s (%d/%d PASS)" % [suite_name, passed_count, total_count])
		return {"all_passed": true, "passed": passed_count, "total": total_count}
	print("[ FAIL ] %s (%d/%d PASS)" % [suite_name, passed_count, total_count])
	for item_variant in suite_result.get("results", []):
		if item_variant is Dictionary and not bool((item_variant as Dictionary).get("passed", false)):
			var failed_entry := item_variant as Dictionary
			var detail_msg := str(failed_entry.get("detail", failed_entry.get("error", ""))).strip_edges()
			var case_title := str(failed_entry.get("test", failed_entry.get("name", "未命名测试")))
			print("    ❌  %s%s" % [case_title, "" if detail_msg.is_empty() else (" (%s)" % detail_msg)])
	return {"all_passed": false, "passed": passed_count, "total": total_count}

## 对称释放全部前端基础设施与领域服务单例，防止 headless 退出时触发 ObjectDB/Node 析构悬空
func _reset_all_fe_singletons() -> void:
	DialogManager.reset_instance()
	DrawerManager.reset_instance()
	ContextMenuManager.reset_instance()
	TooltipManager.reset_instance()
	ModalManager.reset_instance()
	FocusInputManager.reset_instance()
	RedDotTreeManager.reset_instance()
	UIAudioBridge.reset_instance()
	CutsceneEventBridge.reset_for_tests()
	ThemeManager.reset_instance()
	AppLifecycleFSM.reset_instance()
	ServiceLocator.clear_active_gateway()
	ServiceLocator.reset()
	RealServiceContainer.reset_instance()
	MockServiceContainer.reset_instance()
	NavManager.reset_instance()
	UIIntermediary.teardown_for_tests()
	UITextResolver.reset_instance()
	UIBindingRegistry.reset_instance()

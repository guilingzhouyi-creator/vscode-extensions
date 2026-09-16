# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端防御健壮性验收套件
# 文件路径: res://tests/unit/frontend/test_frontend_robustness.gd
# 职责: 验收 i18n 精确格式化与子串误命中反例、视图模型防御读取、导航失败栈一致性、Toast 淘汰不死循环
# ==============================================================================
class_name TestFrontendRobustness
extends TestCase

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	results.append(_test_i18n_exact_formatting())
	results.append(_test_i18n_counter_examples())
	results.append(_test_i18n_formatters_reachable())
	results.append(_test_view_model_defensive_read())
	results.append(_test_nav_stack_consistency_on_failure())
	results.append(_test_toast_eviction_no_hang())
	return TestCase.pack_results("frontend_robustness", results)

## TC-P82-S4-02：i18n 三条格式化分支（千分位 / 百分比 / 时长 / 数值对）精确可达
static func _test_i18n_exact_formatting() -> Dictionary:
	var gold := PlaceholderFiller.fill("{amount}", {"amount": 5000})
	var ok := TestCase.assert_eq(gold, "5,000", "千分位格式化生效")
	var pct := PlaceholderFiller.fill("{percent}", {"percent": 0.35})
	ok = ok and TestCase.assert_eq(pct, "35%", "百分比格式化生效")
	var dur := PlaceholderFiller.fill("{time}", {"time": 125})
	ok = ok and TestCase.assert_eq(dur, "2分05秒", "时长格式化生效")
	var pair := PlaceholderFiller.fill("{cur}/{max}", {"cur": 30, "max": 100})
	ok = ok and TestCase.assert_eq(pair, "30/100", "HP 数值对格式化生效")
	return TestCase.make_result("i18n_exact_formatting", ok)

## A / TC-P82-S4-02：子串误命中回归——展示型文本与无关键名不得被二次格式化
static func _test_i18n_counter_examples() -> Dictionary:
	var ok := TestCase.assert_eq(PlaceholderFiller.fill("{time}", {"time": "刚刚"}), "刚刚", "time=展示文本 不被时长格式化")
	ok = ok and TestCase.assert_eq(PlaceholderFiller.fill("{rate}", {"rate": "3.5000"}), "3.5000", "rate=展示文本 不被百分比格式化")
	ok = ok and TestCase.assert_eq(PlaceholderFiller.fill("{rate_limit}", {"rate_limit": 60}), "60", "rate_limit 不误命中百分比")
	ok = ok and TestCase.assert_eq(PlaceholderFiller.fill("{moderate}", {"moderate": 5}), "5", "moderate 不误命中百分比")
	ok = ok and TestCase.assert_eq(PlaceholderFiller.fill("{timestamp}", {"timestamp": "2026-09-11"}), "2026-09-11", "timestamp 不误命中时长")
	return TestCase.make_result("i18n_counter_examples", ok)

## R-02：resolve 路径须真正触达千分位格式化（单引擎收敛后不再空转）
static func _test_i18n_formatters_reachable() -> Dictionary:
	var s := UITextResolver.resolve("ui.fe05.wallet.gold", {"amount": 5000})
	var ok := TestCase.assert_true(s.contains("5,000"), "resolve 路径触达千分位格式化: %s" % s)
	return TestCase.make_result("i18n_formatters_reachable", ok)

## R-03/R-09/R-29：视图模型空值 / 非有限 / 越界防御读取零崩溃，日志有界
static func _test_view_model_defensive_read() -> Dictionary:
	var vm := CombatViewModel.new()
	vm.update_from_snapshot({"boss_parts": null})
	var ok := TestCase.assert_eq(vm.boss_parts.size(), 0, "非 Array 输入回退空数组")
	vm.update_from_snapshot({"boss_hp": NAN, "boss_max_hp": INF})
	ok = ok and TestCase.assert_true(is_finite(vm.boss_hp_current) and vm.boss_hp_current >= 0.0, "NaN/INF 防御后为有限非负值")
	for i in range(CombatViewModel.MAX_BATTLE_LOGS + 25):
		vm.append_log("dmg", "hit %d" % i)
	ok = ok and TestCase.assert_lte(vm.battle_logs.size(), CombatViewModel.MAX_BATTLE_LOGS, "战报日志有界不超上限")
	return TestCase.make_result("view_model_defensive_read", ok)

## R-04/R-05：未注册 Screen 跳转失败路径栈深不变，无孤儿节点
static func _test_nav_stack_consistency_on_failure() -> Dictionary:
	var nav := NavManager.get_instance()
	var before := nav.get_stack_depth()
	var res := nav.replace_screen("__not_registered__")
	var ok := TestCase.assert_null(res, "未注册 Screen 返回 null")
	ok = ok and TestCase.assert_eq(nav.get_stack_depth(), before, "失败路径栈深不变")
	return TestCase.make_result("nav_stack_consistency_on_failure", ok)

## R-01 / TC-P82-S4-03：连续压入超上限 Toast 不死循环，子节点数 ≤ MAX_TOASTS
static func _test_toast_eviction_no_hang() -> Dictionary:
	var tree := Engine.get_main_loop() as SceneTree
	var layer := ToastLayer.new()
	var attached := false
	if tree != null and tree.root != null:
		tree.root.add_child(layer)
		attached = true
	if attached:
		for i in range(ToastLayer.MAX_TOASTS + 1):
			layer.show_toast("burst %d" % i)
	var ok := TestCase.assert_lte(layer.get_child_count(), ToastLayer.MAX_TOASTS, "9 连发后子节点数 ≤ 上限 %d" % ToastLayer.MAX_TOASTS)
	if attached:
		tree.root.remove_child(layer)
	layer.free()
	return TestCase.make_result("toast_eviction_no_hang", ok)

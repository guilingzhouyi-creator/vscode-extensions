# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - Vol 32 多硬件输入系统单元测试
# 文件路径: res://tests/unit/domains/test_hardware_input.gd
# ==============================================================================
class_name TestHardwareInputDomain
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "Domain 32: 多硬件输入感知与自适应控制器调度系统"

	results.append(_test_device_hot_swap_and_prompt())
	results.append(_test_stick_radial_deadzone_filter())
	results.append(_test_action_rebinding())
	results.append(_test_tab_double_tap_detection())
	# Phase 55 L1 新增：死区区间倒置守卫
	results.append(_test_deadzone_inverted_config_safe())

	var passed_cnt := 0
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

static func _test_device_hot_swap_and_prompt() -> Dictionary:
	var state := InputDeviceStateAggregate.new()

	# 初始为键鼠
	var p1 = state.get_ui_button_prompt("interact") # "[E]"

	# 收到手柄摇杆事件 -> 热切换为手柄模式
	var swapped_1 = AdaptiveInputFilterSolver.handle_device_input_event(state, "JOYPAD_BUTTON", 1000)
	var p2 = state.get_ui_button_prompt("interact") # "(ButtonA)"

	# 收到键盘按下事件 -> 热切换回键鼠模式
	var swapped_2 = AdaptiveInputFilterSolver.handle_device_input_event(state, "KEYBOARD", 1050)
	var p3 = state.get_ui_button_prompt("interact") # "[E]"

	var passed = (p1 == "[E]") and swapped_1 and (p2 == "(ButtonA)") and swapped_2 and (p3 == "[E]")
	return {
		"test": "TC-INPUT-01: 键鼠与手柄毫秒级自适应热切换与 UI 提示热更新",
		"passed": passed
	}

static func _test_stick_radial_deadzone_filter() -> Dictionary:
	# 1. 处于内部死区内 (0.10 < 0.15) -> 过滤为 0
	var v_drift = Vector2(0.08, 0.06) # length = 0.10
	var filtered_drift = AdaptiveInputFilterSolver.filter_radial_deadzone(v_drift, 0.15, 0.95)

	# 2. 超过外部死区 (0.98 > 0.95) -> 饱和归一化为 1.0
	var v_full = Vector2(0.98, 0.0)
	var filtered_full = AdaptiveInputFilterSolver.filter_radial_deadzone(v_full, 0.15, 0.95)

	# 3. 中间线性重映射 (0.55 在 [0.15, 0.95] 中间 -> (0.55-0.15)/0.80 = 0.5)
	var v_mid = Vector2(0.55, 0.0)
	var filtered_mid = AdaptiveInputFilterSolver.filter_radial_deadzone(v_mid, 0.15, 0.95)

	var passed = (filtered_drift == Vector2.ZERO) and (is_equal_approx(filtered_full.length(), 1.0)) and (is_equal_approx(filtered_mid.length(), 0.5))
	return {
		"test": "TC-INPUT-02: 摇杆径向圆形死区非线性滤波与防硬件漂移",
		"passed": passed
	}

static func _test_action_rebinding() -> Dictionary:
	var state := InputDeviceStateAggregate.new()

	var ok = ActionRebindingService.rebind_action(state, "interact", "Key_F", 0)
	var p = state.get_ui_button_prompt("interact")

	var passed = ok and (p == "[F]")
	return {
		"test": "TC-INPUT-03: 玩家动作键位重映射与热应用",
		"passed": passed
	}

static func _test_tab_double_tap_detection() -> Dictionary:
	var detector := TabDoubleTapDetector.new()

	# 非 Tab 键：重置连按状态并返回非 Tab
	var r_non = detector.feed_key_press("Key_A", 1000)
	# 首次 Tab：单击
	var r1 = detector.feed_key_press("Key_Tab", 2000)
	# 窗口期（300ms）内再次 Tab：双击
	var r2 = detector.feed_key_press("Key_Tab", 2200)
	# 双击后状态重置；窗口期外按下视为新单击
	var r3 = detector.feed_key_press("Key_Tab", 10000)
	# 窗口期内再按：双击
	var r4 = detector.feed_key_press("Key_Tab", 10050)
	# 双击重置后单次 Tab：单击
	var r5 = detector.feed_key_press("Key_Tab", 10200)

	var passed = (not r_non.is_tab) and r_non.is_double_tap == false \
		and r1.is_single_tap and (not r1.is_double_tap) \
		and (not r2.is_single_tap) and r2.is_double_tap \
		and r3.is_single_tap \
		and r4.is_double_tap \
		and r5.is_single_tap
	return {
		"test": "TC-INPUT-04: Tab 键双击组合检测（窗口期/单击/双击/重置）",
		"passed": passed
	}

## L1（Phase 55）：死区区间守卫——倒置/相等配置（outer<=inner）不得除零/负 magnitude（防崩溃回归）
static func _test_deadzone_inverted_config_safe() -> Dictionary:
	# 正常区间：raw 落中段 → 线性重映射 ∈ (0,1)，无 NaN
	var normal := AdaptiveInputFilterSolver.filter_radial_deadzone(Vector2(0.5, 0.0), 0.15, 0.95)
	var normal_ok = normal.x > 0.0 and normal.x < 1.0 and normal.x == normal.x and normal.y == normal.y
	# 倒置（outer<inner）：旧实现分母 ≤0 → 除零/负 magnitude 风险；新守卫钳 EPS 后输出有界有限
	var inverted := AdaptiveInputFilterSolver.filter_radial_deadzone(Vector2(0.4, 0.0), 0.5, 0.2)
	var inverted_ok = inverted == Vector2.ZERO or (inverted.x == inverted.x and inverted.y == inverted.y)
	# 相等（outer==inner==0.5）：raw>=outer → 单位向量；raw<inner → 零向量（均不崩溃）
	var eq_hi := AdaptiveInputFilterSolver.filter_radial_deadzone(Vector2(0.6, 0.0), 0.5, 0.5)
	var eq_lo := AdaptiveInputFilterSolver.filter_radial_deadzone(Vector2(0.3, 0.0), 0.5, 0.5)
	var eq_ok = is_equal_approx(eq_hi.length(), 1.0) and eq_lo == Vector2.ZERO
	var passed = normal_ok and inverted_ok and eq_ok
	return {
		"test": "TC-INPUT-05: 死区区间倒置守卫（L1：倒置/相等配置不除零不崩溃）",
		"passed": passed
	}

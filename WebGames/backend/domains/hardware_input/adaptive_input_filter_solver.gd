# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/hardware_input/adaptive_input_filter_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/hardware_input.json | 信号: EventBus 领域广播
# 职责说明: 消除手柄硬件漂移、径向圆形死区非线性归一化与设备类型毫秒级热切换
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name AdaptiveInputFilterSolver
extends RefCounted

## 摇杆径向死区滤波：内死区归零/外死区归一/区间线性映射（Inv-VD-1 死区区间守卫）
static func filter_radial_deadzone(
	raw_stick_vector: Vector2,
	inner_deadzone: float = -1.0,
	outer_deadzone: float = -1.0
) -> Vector2:
	var cfg_inner := GameConfig.get_float("domains.hardware_input", "stick_deadzone/inner", 0.15)
	var cfg_outer := GameConfig.get_float("domains.hardware_input", "stick_deadzone/outer", 0.95)
	var inner := inner_deadzone if inner_deadzone >= 0.0 else cfg_inner
	var outer := outer_deadzone if outer_deadzone >= 0.0 else cfg_outer
	var raw_mag = raw_stick_vector.length()
	if raw_mag <= inner:
		return Vector2.ZERO

	if raw_mag >= outer:
		return raw_stick_vector.normalized()

	# L1（Phase 55）：死区区间守卫（Inv-VD-1）——outer<=inner（倒置/相等配置/热重载）时
	# 旧实现分母 ≤0 → 除零或负 magnitude（标量反向后摇杆反向）；下限 EPS 只防崩溃不改正常映射精度
	var deadzone_span := maxf(0.01, outer - inner)
	var normalized_mag = (raw_mag - inner) / deadzone_span
	return raw_stick_vector.normalized() * normalized_mag

## 设备输入事件分派：按键类型 → 活跃设备热切换（返回是否发生切换）
static func handle_device_input_event(
	state: InputDeviceStateAggregate,
	event_source_type: String,
	current_timestamp_ms: int
) -> bool:
	var prev_device = state.current_device
	match event_source_type.to_upper():
		"JOYPAD_MOTION", "JOYPAD_BUTTON":
			state.current_device = InputDeviceStateAggregate.ActiveInputDevice.GAMEPAD_CONTROLLER
		"KEYBOARD", "MOUSE_BUTTON", "MOUSE_MOTION":
			state.current_device = InputDeviceStateAggregate.ActiveInputDevice.KEYBOARD_AND_MOUSE
		"TOUCH":
			state.current_device = InputDeviceStateAggregate.ActiveInputDevice.TOUCH_SCREEN

	state.last_input_timestamp_ms = current_timestamp_ms
	return prev_device != state.current_device # 返回是否发生设备热切换

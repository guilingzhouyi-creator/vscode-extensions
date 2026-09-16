# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/hardware_input/text_interaction_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/hardware_input.json | 信号: EventBus 领域广播
# 职责说明: 文字版完备版第一交互：鼠标点击热区命中与键盘快捷键分发，全部配置驱动。 鼠标灵敏度与热区扩展比经 hardware_input.json 的 mouse/* 驱动； 快捷键绑定表经 keyboard_shortcuts/* 驱动，可经 ActionRebindingService 热更； 设备热切换经 AdaptiveInputFilterSolver 统一入口。
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name TextInteractionSolver extends RefCounted

## 鼠标点击命中：点击坐标是否落在文字热区内（配置化灵敏度扩展）
static func hit_test_mouse_click(click_pos: Vector2, hot_area: Rect2, sensitivity: float = -1.0) -> bool:
	if hot_area.size == Vector2.ZERO:
		return false
	var sens: float = sensitivity if sensitivity >= 0.0 else GameConfig.get_float("domains.hardware_input", "mouse/sensitivity_scalar", 1.0)
	var expand_ratio: float = GameConfig.get_float("domains.hardware_input", "mouse/click_hot_area_expand_ratio", 0.1)
	var expanded: Rect2 = hot_area.grow(hot_area.size.length() * (sens - 1.0) * expand_ratio)
	return expanded.has_point(click_pos)

## 键盘快捷键分发：action_name → 绑定表（配置驱动，可重绑定）
static func dispatch_shortcut(action_name: String, state: InputDeviceStateAggregate) -> Dictionary:
	if action_name.is_empty():
		return {"success": false, "error_code": "EMPTY_ACTION"}
	var bindings: Array = state.action_mappings.get(action_name, [])
	# 回退：若运行时表空，则读配置表 keyboard_shortcuts/*（零硬编码）
	if bindings.is_empty():
		bindings = GameConfig.get_array("domains.hardware_input", "keyboard_shortcuts/" + action_name, [])
		if bindings.is_empty():
			return {"success": false, "error_code": "NO_BINDING", "action": action_name}
	return {"success": true, "action": action_name, "bindings": bindings.duplicate()}

## 硬件事件统一入口：鼠标/键盘/手柄/触屏热切换（预留）
static func handle_hardware_event(state: InputDeviceStateAggregate, event_type: String, timestamp_ms: int) -> Dictionary:
	if state == null or event_type.is_empty():
		return {"success": false, "error_code": "INVALID_EVENT"}
	var switched: bool = AdaptiveInputFilterSolver.handle_device_input_event(state, event_type, timestamp_ms)
	return {"success": true, "switched": switched, "device": state.current_device}

## 文案：取快捷键提示（配置驱动，未命中回退键名）
static func shortcut_prompt(action_name: String, state: InputDeviceStateAggregate) -> String:
	var res := dispatch_shortcut(action_name, state)
	if not res.success:
		return "[%s]" % action_name
	var bindings: Array = res.bindings
	for b in bindings:
		if String(b).begins_with("Key_"):
			return "[%s]" % String(b).replace("Key_", "")
	return "[%s]" % String(bindings[0]) if not bindings.is_empty() else "[%s]" % action_name

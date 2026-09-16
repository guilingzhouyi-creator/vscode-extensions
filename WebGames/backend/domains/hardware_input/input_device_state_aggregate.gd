# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/hardware_input/input_device_state_aggregate.gd
# 架构定位: Domain Entity / Aggregate Root
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/hardware_input.json | 信号: EventBus 领域广播
# 职责说明: 监听键盘/鼠标/手柄/触屏输入状态、死区滤波配置与动作重映射表
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name InputDeviceStateAggregate
extends RefCounted

enum ActiveInputDevice {
	KEYBOARD_AND_MOUSE, # 键盘与鼠标
	GAMEPAD_CONTROLLER, # 游戏手柄 (XInput / DualShock / DirectInput)
	TOUCH_SCREEN        # 移动端/触摸屏
}

var current_device: ActiveInputDevice = ActiveInputDevice.KEYBOARD_AND_MOUSE
var last_input_timestamp_ms: int = 0
var gamepad_device_id: int = 0

# 摇杆滤波配置
var stick_deadzone_inner: float = GameConfig.get_float("domains.hardware_input", "stick_deadzone/inner", 0.15)       # 内部死区 (防物理漂移)
var stick_deadzone_outer: float = GameConfig.get_float("domains.hardware_input", "stick_deadzone/outer", 0.95)       # 外部死区 (全速饱和)
var mouse_sensitivity_scalar: float = GameConfig.get_float("domains.hardware_input", "mouse/sensitivity_scalar", 1.0)

# 动作按键映射字典 (action_name -> Array[String])
var action_mappings: Dictionary = {
	"move_north": ["Key_W", "Joypad_Up"],
	"move_south": ["Key_S", "Joypad_Down"],
	"move_east": ["Key_D", "Joypad_Right"],
	"move_west": ["Key_A", "Joypad_Left"],
	"interact": ["Key_E", "Joypad_ButtonA"],
	"open_inventory": ["Key_I", "Joypad_ButtonY"],
	"cast_spell": ["Key_Q", "Joypad_ButtonX"]
}

# Tab 双击组合检测器（聊天命令智能补全联动，窗口期配置驱动）
var tab_double_tap: TabDoubleTapDetector = TabDoubleTapDetector.new()

## 按当前设备输出 UI 按键提示（手柄/键鼠各自首选绑定，空映射占位）
func get_ui_button_prompt(action_name: String) -> String:
	var bindings: Array = action_mappings.get(action_name, [])
	if bindings.is_empty():
		return "[?]"
	if current_device == ActiveInputDevice.GAMEPAD_CONTROLLER:
		for b in bindings:
			if b.begins_with("Joypad_"):
				return "(%s)" % b.replace("Joypad_", "")
		return "(A)"
	else:
		for b in bindings:
			if b.begins_with("Key_"):
				return "[%s]" % b.replace("Key_", "")
		return "[E]"

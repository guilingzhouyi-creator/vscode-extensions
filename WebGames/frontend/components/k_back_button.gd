# ==============================================================================
# 模块归属: 前端通用组件层 (Frontend · Reusable UI Components)
# 文件路径: res://frontend/components/k_back_button.gd
# 架构定位: Reusable Atomic Component (KBackButton)
# 依赖与触发: 上游: 页面视图控制器 | 下游: DesignTokens, UIAudioBridge, NavManager
# 职责说明: 统一封装返回按钮视觉风格、防连击拦截与点击音效，点击后按配置触发导航栈回退。
# 退出语义与设计依据: 原子组件单一职责与防连击交互契约
# ==============================================================================

## KBackButton：通用返回导航按钮组件
class_name KBackButton
extends Button

signal back_pressed()

@export var back_transition: int = NavTypes.TransitionType.SLIDE_RIGHT
@export var play_sound: bool = true
@export var auto_pop: bool = true

var _last_press_time: float = -100.0

func _ready() -> void:
	text = UIIntermediary.text("ui.common.back")
	_apply_style()
	pressed.connect(_on_pressed)
	mouse_entered.connect(_on_mouse_entered)

func _apply_style() -> void:
	var button_style := StyleBoxFlat.new()
	button_style.bg_color = DesignTokens.COLOR_SURFACE_CARD
	button_style.set_corner_radius_all(4)
	add_theme_stylebox_override("normal", button_style)
	add_theme_color_override("font_color", DesignTokens.COLOR_TEXT_SECONDARY)

func _on_mouse_entered() -> void:
	if not disabled and play_sound:
		UIAudioBridge.get_instance().play_hover()

func _on_pressed() -> void:
	var current_time: float = float(Time.get_ticks_msec()) / 1000.0
	if current_time - _last_press_time < DesignTokens.DEBOUNCE_DELAY:
		return # 防连击拦截
	_last_press_time = current_time

	if play_sound:
		UIAudioBridge.get_instance().play_click()

	back_pressed.emit()

	if auto_pop:
		NavManager.get_instance().pop_screen(back_transition)

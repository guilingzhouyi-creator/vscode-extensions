# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端通用组件: 返回按钮 (KBackButton)
# 文件路径: res://frontend/components/k_back_button.gd
# 职责: 统一封装返回按钮视觉风格、防连击与点击音效，点击后触发 ViewRouter 回退
# ==============================================================================
class_name KBackButton
extends Button

const DesignTokens = preload("res://frontend/theme/design_tokens.gd")
const UIAudioBridge = preload("res://frontend/ui_infrastructure/ui_audio_bridge.gd")
const NavTypes = preload("res://frontend/navigation/nav_types.gd")
const NavManager = preload("res://frontend/navigation/nav_manager.gd")

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
	var style := StyleBoxFlat.new()
	style.bg_color = DesignTokens.COLOR_SURFACE_CARD
	style.set_corner_radius_all(4)
	add_theme_stylebox_override("normal", style)
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

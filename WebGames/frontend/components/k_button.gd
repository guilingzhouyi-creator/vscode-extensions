# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端通用组件: 标准交互按钮 (KButton)
# 文件路径: res://frontend/components/k_button.gd
# 职责: 统一封装按钮视觉风格、防重复快速连击 (Debounce) 与全局 UI 音效派发
# ==============================================================================
class_name KButton
extends Button

const DesignTokens = preload("res://frontend/theme/design_tokens.gd")
const UIAudioBridge = preload("res://frontend/ui_infrastructure/ui_audio_bridge.gd")

enum StyleVariant {
	PRIMARY,
	SECONDARY,
	DANGER,
	FLAT
}

signal debounced_pressed()

@export var variant: StyleVariant = StyleVariant.PRIMARY
@export var play_sound: bool = true
@export var debounce_sec: float = DesignTokens.DEBOUNCE_DELAY

var is_loading: bool = false:
	set(val):
		if is_loading == val:
			return
		is_loading = val
		if is_loading:
			_orig_text = text
			_was_disabled = disabled
			text = UIIntermediary.text("ui.common.processing")
			disabled = true
		else:
			text = _orig_text
			disabled = _was_disabled

var _orig_text: String = ""
var _was_disabled: bool = false
var _last_press_time: float = -100.0

func _ready() -> void:
	_orig_text = text
	pressed.connect(_on_internal_pressed)
	mouse_entered.connect(_on_mouse_entered)
	_apply_style_variant()

func _apply_style_variant() -> void:
	var style := StyleBoxFlat.new()
	style.set_corner_radius_all(4)

	match variant:
		StyleVariant.PRIMARY:
			style.bg_color = DesignTokens.COLOR_PRIMARY
			add_theme_color_override("font_color", DesignTokens.COLOR_TEXT_PRIMARY)
		StyleVariant.SECONDARY:
			style.bg_color = DesignTokens.COLOR_SURFACE_CARD
			add_theme_color_override("font_color", DesignTokens.COLOR_TEXT_SECONDARY)
		StyleVariant.DANGER:
			style.bg_color = DesignTokens.COLOR_ERROR
			add_theme_color_override("font_color", DesignTokens.COLOR_TEXT_PRIMARY)
		StyleVariant.FLAT:
			style.bg_color = Color.TRANSPARENT
			add_theme_color_override("font_color", DesignTokens.COLOR_TEXT_SECONDARY)

	add_theme_stylebox_override("normal", style)

func _on_internal_pressed() -> void:
	if is_loading:
		return

	var current_time: float = float(Time.get_ticks_msec()) / 1000.0
	if current_time - _last_press_time < debounce_sec:
		return # 防连击拦截

	_last_press_time = current_time

	if play_sound:
		UIAudioBridge.get_instance().play_click()

	debounced_pressed.emit()

func _on_mouse_entered() -> void:
	if not disabled and play_sound:
		UIAudioBridge.get_instance().play_hover()

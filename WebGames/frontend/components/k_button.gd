# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端通用组件: 标准交互按钮 (KButton)
# 文件路径: res://frontend/components/k_button.gd
# 职责: 统一封装按钮视觉风格、防重复快速连击 (Debounce) 与全局 UI 音效派发
# ==============================================================================
class_name KButton
extends Button

const DesignTokens = preload("res://frontend/theme/design_tokens.gd")
const UIAudioBridge = preload("res://frontend/ui_infrastructure/ui_audio_bridge.gd")
const UIIntermediary = preload("res://frontend/i18n/ui_intermediary.gd")

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
	mouse_exited.connect(_on_mouse_exited)
	_apply_style_variant()

func _exit_tree() -> void:
	if pressed.is_connected(_on_internal_pressed):
		pressed.disconnect(_on_internal_pressed)
	if mouse_entered.is_connected(_on_mouse_entered):
		mouse_entered.disconnect(_on_mouse_entered)
	if mouse_exited.is_connected(_on_mouse_exited):
		mouse_exited.disconnect(_on_mouse_exited)

func _apply_style_variant() -> void:
	var style_normal := StyleBoxFlat.new()
	var style_hover := StyleBoxFlat.new()
	var style_pressed := StyleBoxFlat.new()
	var style_disabled := StyleBoxFlat.new()

	for style in [style_normal, style_hover, style_pressed, style_disabled]:
		style.set_corner_radius_all(4)

	match variant:
		StyleVariant.PRIMARY:
			style_normal.bg_color = DesignTokens.COLOR_PRIMARY
			style_hover.bg_color = DesignTokens.COLOR_PRIMARY_HOVER
			style_pressed.bg_color = DesignTokens.COLOR_PRIMARY.darkened(0.15)
			style_disabled.bg_color = DesignTokens.COLOR_SURFACE_CARD
			add_theme_color_override("font_color", DesignTokens.COLOR_TEXT_PRIMARY)
		StyleVariant.SECONDARY:
			style_normal.bg_color = DesignTokens.COLOR_SURFACE_CARD
			style_hover.bg_color = DesignTokens.COLOR_SURFACE_CARD.lightened(0.1)
			style_pressed.bg_color = DesignTokens.COLOR_SURFACE_CARD.darkened(0.1)
			style_disabled.bg_color = DesignTokens.COLOR_SURFACE_CARD
			add_theme_color_override("font_color", DesignTokens.COLOR_TEXT_SECONDARY)
		StyleVariant.DANGER:
			style_normal.bg_color = DesignTokens.COLOR_ERROR
			style_hover.bg_color = DesignTokens.COLOR_ERROR.lightened(0.1)
			style_pressed.bg_color = DesignTokens.COLOR_ERROR.darkened(0.15)
			style_disabled.bg_color = DesignTokens.COLOR_SURFACE_CARD
			add_theme_color_override("font_color", DesignTokens.COLOR_TEXT_PRIMARY)
		StyleVariant.FLAT:
			style_normal.bg_color = Color.TRANSPARENT
			style_hover.bg_color = DesignTokens.COLOR_FLAT_HOVER
			style_pressed.bg_color = DesignTokens.COLOR_FLAT_PRESSED
			style_disabled.bg_color = Color.TRANSPARENT
			add_theme_color_override("font_color", DesignTokens.COLOR_TEXT_SECONDARY)

	add_theme_stylebox_override("normal", style_normal)
	add_theme_stylebox_override("hover", style_hover)
	add_theme_stylebox_override("pressed", style_pressed)
	add_theme_stylebox_override("disabled", style_disabled)
	add_theme_color_override("font_disabled_color", DesignTokens.COLOR_TEXT_DISABLED)

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
	modulate = DesignTokens.COLOR_HOVER_MODULATE

func _on_mouse_exited() -> void:
	modulate = Color.WHITE

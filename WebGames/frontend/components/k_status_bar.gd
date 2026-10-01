# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端通用组件: 状态进度条 (KStatusBar)
# 文件路径: res://frontend/components/k_status_bar.gd
# 职责: 统一封装进度条与数值标签的组合展示，提供单一刷新入口与 i18n 标题绑定
# ==============================================================================
class_name KStatusBar
extends Control

const DesignTokens = preload("res://frontend/theme/design_tokens.gd")

signal value_changed(current: float, maximum: float)

@export var label_key: String = ""
@export var show_text: bool = true
@export var bar_color: Color = DesignTokens.COLOR_PRIMARY

var _vbox: VBoxContainer
var _lbl_title: Label
var _hbox: HBoxContainer
var _progress_bar: ProgressBar
var _lbl_value: Label

func _ready() -> void:
	set_anchors_and_offsets_preset(PRESET_FULL_RECT)
	mouse_filter = MOUSE_FILTER_IGNORE

	_vbox = VBoxContainer.new()
	_vbox.set_anchors_and_offsets_preset(PRESET_FULL_RECT)
	_vbox.add_theme_constant_override("separation", DesignTokens.SPACING_XS)
	add_child(_vbox)

	_lbl_title = Label.new()
	_lbl_title.add_theme_font_size_override("font_size", DesignTokens.FONT_SIZE_BODY)
	_lbl_title.add_theme_color_override("font_color", DesignTokens.COLOR_TEXT_SECONDARY)
	_lbl_title.mouse_filter = MOUSE_FILTER_IGNORE
	_vbox.add_child(_lbl_title)

	_hbox = HBoxContainer.new()
	_hbox.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_hbox.add_theme_constant_override("separation", DesignTokens.SPACING_SM)
	_vbox.add_child(_hbox)

	_progress_bar = ProgressBar.new()
	_progress_bar.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_progress_bar.min_value = 0.0
	_progress_bar.max_value = 100.0
	_progress_bar.value = 0.0
	_apply_bar_style()
	_hbox.add_child(_progress_bar)

	_lbl_value = Label.new()
	_lbl_value.add_theme_font_size_override("font_size", DesignTokens.FONT_SIZE_BODY)
	_lbl_value.add_theme_color_override("font_color", DesignTokens.COLOR_TEXT_PRIMARY)
	_lbl_value.mouse_filter = MOUSE_FILTER_IGNORE
	_lbl_value.visible = show_text
	_hbox.add_child(_lbl_value)

	if not label_key.is_empty():
		UIIntermediary.resolve(_lbl_title, label_key)

func _apply_bar_style() -> void:
	var bg_style := StyleBoxFlat.new()
	bg_style.bg_color = DesignTokens.COLOR_SURFACE_CARD
	bg_style.set_corner_radius_all(3)
	bg_style.set_border_width_all(1)
	bg_style.border_color = DesignTokens.COLOR_BORDER_DEFAULT
	_progress_bar.add_theme_stylebox_override("background", bg_style)

	var fill_style := StyleBoxFlat.new()
	fill_style.bg_color = bar_color
	fill_style.set_corner_radius_all(3)
	_progress_bar.add_theme_stylebox_override("fill", fill_style)

func set_progress(current: float, maximum: float) -> void:
	var safe_max: float = maxf(maximum, 1.0)
	_progress_bar.max_value = safe_max
	_progress_bar.value = clampf(current, 0.0, safe_max)
	if _lbl_value != null and show_text:
		_lbl_value.text = "%.0f / %.0f" % [current, maximum]
	value_changed.emit(current, maximum)

func set_label_text(text: String) -> void:
	if _lbl_title != null:
		_lbl_title.text = text

func get_progress_bar() -> ProgressBar:
	return _progress_bar

static func create_bar(current: float, maximum: float, minimum_size: Vector2 = Vector2.ZERO) -> ProgressBar:
	var bar := ProgressBar.new()
	bar.min_value = 0.0
	bar.max_value = maxf(maximum, 1.0)
	bar.value = clampf(current, bar.min_value, bar.max_value)
	bar.custom_minimum_size = minimum_size
	return bar

## 静态方法：为任意 ProgressBar + Label 组合刷新进度（无需替换为 KStatusBar 节点即可使用）
static func refresh_bar(bar: ProgressBar, label: Label, current: float, maximum: float) -> void:
	if bar != null and is_instance_valid(bar):
		bar.value = current
		bar.max_value = maximum
	if label != null and is_instance_valid(label):
		label.text = "%.0f / %.0f" % [current, maximum]

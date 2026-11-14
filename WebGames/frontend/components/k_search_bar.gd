# ==============================================================================
# 模块归属: 前端通用组件层 (Frontend · Reusable UI Components)
# 文件路径: res://frontend/components/k_search_bar.gd
# 架构定位: Reusable Atomic Component (KSearchBar)
# 依赖与触发: 上游: 列表过滤与图鉴搜索界面 | 下游: DesignTokens, UIIntermediary
# 职责说明: 封装 LineEdit 与一键清除按钮，提供输入去抖回调、空白归一化与长度门槛过滤。
# 退出语义与设计依据: 高频输入去抖节流与零冗余信号派发契约
# ==============================================================================

## KSearchBar：带输入去抖与一键清空的通用搜索栏组件
class_name KSearchBar
extends Control

const DesignTokens = preload("res://frontend/theme/design_tokens.gd")

signal search_changed(query: String)
signal search_cleared()

@export var placeholder_key: String = "ui.common.search"
@export var debounce_sec: float = 0.3
@export var min_query_length: int = 0

var _hbox: HBoxContainer
var _line_edit: LineEdit
var _clear_button: Button

var _pending_query: String = ""
var _debounce_remaining: float = 0.0

func _ready() -> void:
	set_anchors_and_offsets_preset(PRESET_FULL_RECT)
	mouse_filter = MOUSE_FILTER_IGNORE

	_hbox = HBoxContainer.new()
	_hbox.set_anchors_and_offsets_preset(PRESET_FULL_RECT)
	_hbox.add_theme_constant_override("separation", DesignTokens.SPACING_XS)
	add_child(_hbox)

	_line_edit = LineEdit.new()
	_line_edit.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_line_edit.clear_button_enabled = false
	_line_edit.add_theme_font_size_override("font_size", DesignTokens.FONT_SIZE_BODY)
	_line_edit.add_theme_color_override("font_color", DesignTokens.COLOR_TEXT_PRIMARY)
	_line_edit.add_theme_color_override("font_uneditable_color", DesignTokens.COLOR_TEXT_DISABLED)
	_line_edit.add_theme_color_override("font_placeholder_color", DesignTokens.COLOR_TEXT_MUTED)
	_apply_input_style()
	_hbox.add_child(_line_edit)

	_clear_button = Button.new()
	_clear_button.text = "x"
	_clear_button.custom_minimum_size = Vector2(28, 28)
	_clear_button.add_theme_font_size_override("font_size", DesignTokens.FONT_SIZE_BODY)
	_clear_button.add_theme_color_override("font_color", DesignTokens.COLOR_TEXT_SECONDARY)
	_clear_button.add_theme_color_override("font_hover_color", DesignTokens.COLOR_TEXT_PRIMARY)
	_clear_button.visible = false
	_hbox.add_child(_clear_button)

	UIIntermediary.resolve_placeholder(_line_edit, placeholder_key)
	_line_edit.text_changed.connect(_on_text_changed)
	_clear_button.pressed.connect(clear)
	set_process(false)

static var _shared_input_style: StyleBoxFlat = null

func _apply_input_style() -> void:
	if _shared_input_style == null:
		var style := StyleBoxFlat.new()
		style.bg_color = DesignTokens.COLOR_SURFACE_CARD
		style.set_border_width_all(1)
		style.border_color = DesignTokens.COLOR_BORDER_DEFAULT
		style.set_corner_radius_all(3)
		style.content_margin_left = DesignTokens.SPACING_SM
		style.content_margin_right = DesignTokens.SPACING_SM
		_shared_input_style = style
	_line_edit.add_theme_stylebox_override("normal", _shared_input_style)
	_line_edit.add_theme_stylebox_override("focus", _shared_input_style)

func _process(delta: float) -> void:
	if _debounce_remaining > 0.0:
		_debounce_remaining -= delta
		if _debounce_remaining <= 0.0:
			_emit_debounced()
	else:
		set_process(false)

func _on_text_changed() -> void:
	var raw_text := _line_edit.text
	var query := raw_text.strip_edges().to_lower()
	_pending_query = query
	_debounce_remaining = debounce_sec
	_clear_button.visible = not raw_text.is_empty()
	set_process(true)

func _emit_debounced() -> void:
	_debounce_remaining = 0.0
	set_process(false)
	if _pending_query.length() < min_query_length:
		if _pending_query.is_empty():
			search_cleared.emit()
		return
	if _pending_query.is_empty():
		search_cleared.emit()
	else:
		search_changed.emit(_pending_query)

## 获取当前去空白并小写归一化后的搜索关键词
func get_query() -> String:
	return _line_edit.text.strip_edges().to_lower()

## 更新输入框占位文本的 i18n 键并立即解析刷新
func set_placeholder(key: String) -> void:
	placeholder_key = key
	if _line_edit != null:
		UIIntermediary.resolve_placeholder(_line_edit, key)

## 清空输入文本与待触发去抖计时器，并发出清空信号
func clear() -> void:
	_line_edit.text = ""
	_pending_query = ""
	_debounce_remaining = 0.0
	set_process(false)
	_clear_button.visible = false
	search_cleared.emit()

## 将键盘输入焦点聚焦至搜索框
func focus() -> void:
	_line_edit.grab_focus()

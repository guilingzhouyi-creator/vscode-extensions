# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端通用组件: 搜索输入栏 (KSearchBar)
# 文件路径: res://frontend/components/k_search_bar.gd
# 职责: 封装 LineEdit + 清除按钮，提供防抖搜索回调与输入归一化
# ==============================================================================
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
var _btn_clear: Button

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

	_btn_clear = Button.new()
	_btn_clear.text = "x"
	_btn_clear.custom_minimum_size = Vector2(28, 28)
	_btn_clear.add_theme_font_size_override("font_size", DesignTokens.FONT_SIZE_BODY)
	_btn_clear.add_theme_color_override("font_color", DesignTokens.COLOR_TEXT_SECONDARY)
	_btn_clear.add_theme_color_override("font_hover_color", DesignTokens.COLOR_TEXT_PRIMARY)
	_btn_clear.visible = false
	_hbox.add_child(_btn_clear)

	UIIntermediary.resolve_placeholder(_line_edit, placeholder_key)
	_line_edit.text_changed.connect(_on_text_changed)
	_btn_clear.pressed.connect(clear)

func _apply_input_style() -> void:
	var style := StyleBoxFlat.new()
	style.bg_color = DesignTokens.COLOR_SURFACE_CARD
	style.set_border_width_all(1)
	style.border_color = DesignTokens.COLOR_BORDER_DEFAULT
	style.set_corner_radius_all(3)
	style.content_margin_left = DesignTokens.SPACING_SM
	style.content_margin_right = DesignTokens.SPACING_SM
	_line_edit.add_theme_stylebox_override("normal", style)
	_line_edit.add_theme_stylebox_override("focus", style)

func _process(delta: float) -> void:
	if _debounce_remaining > 0.0:
		_debounce_remaining -= delta
		if _debounce_remaining <= 0.0:
			_emit_debounced()

func _on_text_changed() -> void:
	var raw := _line_edit.text
	var query := raw.strip_edges().to_lower()
	_pending_query = query
	_debounce_remaining = debounce_sec
	_btn_clear.visible = not raw.is_empty()

func _emit_debounced() -> void:
	_debounce_remaining = 0.0
	if _pending_query.length() < min_query_length:
		if _pending_query.is_empty():
			search_cleared.emit()
		return
	if _pending_query.is_empty():
		search_cleared.emit()
	else:
		search_changed.emit(_pending_query)

func get_query() -> String:
	return _line_edit.text.strip_edges().to_lower()

func set_placeholder(key: String) -> void:
	placeholder_key = key
	if _line_edit != null:
		UIIntermediary.resolve_placeholder(_line_edit, key)

func clear() -> void:
	_line_edit.text = ""
	_pending_query = ""
	_debounce_remaining = 0.0
	_btn_clear.visible = false
	search_cleared.emit()

func focus() -> void:
	_line_edit.grab_focus()

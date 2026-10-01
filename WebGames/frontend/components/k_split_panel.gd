# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端通用组件: 分栏面板 (KSplitPanel)
# 文件路径: res://frontend/components/k_split_panel.gd
# 职责: 统一封装左列表 + 右详情的分栏布局，提供左右内容挂载点与占比控制
# ==============================================================================
class_name KSplitPanel
extends Control

const DesignTokens = preload("res://frontend/theme/design_tokens.gd")

signal item_selected(index: int)

@export var left_ratio: float = 0.4
@export var min_left_width: float = 200.0
@export var separator_visible: bool = true

var _hbox: HBoxContainer
var _left_panel: PanelContainer
var _separator: VSeparator
var _right_panel: PanelContainer

func _ready() -> void:
	set_anchors_and_offsets_preset(PRESET_FULL_RECT)
	_hbox = HBoxContainer.new()
	_hbox.set_anchors_and_offsets_preset(PRESET_FULL_RECT)
	add_child(_hbox)

	_left_panel = PanelContainer.new()
	_left_panel.custom_minimum_size = Vector2(min_left_width, 0.0)
	_left_panel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_apply_panel_style(_left_panel, DesignTokens.COLOR_SURFACE_PANEL)
	_hbox.add_child(_left_panel)

	_separator = VSeparator.new()
	_separator.visible = separator_visible
	_separator.add_theme_stylebox_override("separator", _make_separator_style())
	_hbox.add_child(_separator)

	_right_panel = PanelContainer.new()
	_right_panel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_apply_panel_style(_right_panel, DesignTokens.COLOR_SURFACE_PANEL)
	_hbox.add_child(_right_panel)

func _apply_panel_style(panel: PanelContainer, bg_color: Color) -> void:
	var style := StyleBoxFlat.new()
	style.bg_color = bg_color
	style.set_border_width_all(1)
	style.border_color = DesignTokens.COLOR_BORDER_DEFAULT
	style.set_corner_radius_all(0)
	style.content_margin_left = DesignTokens.SPACING_SM
	style.content_margin_right = DesignTokens.SPACING_SM
	style.content_margin_top = DesignTokens.SPACING_SM
	style.content_margin_bottom = DesignTokens.SPACING_SM
	panel.add_theme_stylebox_override("panel", style)

func _make_separator_style() -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = DesignTokens.COLOR_BORDER_DEFAULT
	return style

func get_left_panel() -> Control:
	return _left_panel

func get_right_panel() -> Control:
	return _right_panel

func set_left_content(node: Control) -> void:
	for child in _left_panel.get_children():
		_left_panel.remove_child(child)
	_left_panel.add_child(node)

func set_right_content(node: Control) -> void:
	for child in _right_panel.get_children():
		_right_panel.remove_child(child)
	_right_panel.add_child(node)

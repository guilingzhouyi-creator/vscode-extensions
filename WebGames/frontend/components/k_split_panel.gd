# ==============================================================================
# 模块归属: 前端通用组件层 (Frontend · Reusable UI Components)
# 文件路径: res://frontend/components/k_split_panel.gd
# 架构定位: Reusable Layout Component (KSplitPanel)
# 依赖与触发: 上游: 主从详情界面与列表视图 | 下游: DesignTokens
# 职责说明: 统一封装左列表 + 右详情的分栏布局容器，提供左右内容插槽挂载与分隔线控制。
# 退出语义与设计依据: 表现层通用布局容器解耦与子节点安全替换契约
# ==============================================================================

## KSplitPanel：通用左右双栏自适应布局组件
class_name KSplitPanel
extends Control

@export var left_ratio: float = 0.4
@export var min_left_width: float = 200.0
@export var separator_visible: bool = true

var _split_row: HBoxContainer
var _left_panel: PanelContainer
var _separator: VSeparator
var _right_panel: PanelContainer

func _ready() -> void:
	set_anchors_and_offsets_preset(PRESET_FULL_RECT)
	_split_row = HBoxContainer.new()
	_split_row.set_anchors_and_offsets_preset(PRESET_FULL_RECT)
	add_child(_split_row)

	_left_panel = PanelContainer.new()
	_left_panel.custom_minimum_size = Vector2(min_left_width, 0.0)
	_left_panel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_apply_panel_style(_left_panel, DesignTokens.COLOR_SURFACE_PANEL)
	_split_row.add_child(_left_panel)

	_separator = VSeparator.new()
	_separator.visible = separator_visible
	_separator.add_theme_stylebox_override("separator", _make_separator_style())
	_split_row.add_child(_separator)

	_right_panel = PanelContainer.new()
	_right_panel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_apply_panel_style(_right_panel, DesignTokens.COLOR_SURFACE_PANEL)
	_split_row.add_child(_right_panel)

func _apply_panel_style(target_panel: PanelContainer, background_color: Color) -> void:
	var panel_style := StyleBoxFlat.new()
	panel_style.bg_color = background_color
	panel_style.set_border_width_all(1)
	panel_style.border_color = DesignTokens.COLOR_BORDER_DEFAULT
	panel_style.set_corner_radius_all(0)
	panel_style.content_margin_left = DesignTokens.SPACING_SM
	panel_style.content_margin_right = DesignTokens.SPACING_SM
	panel_style.content_margin_top = DesignTokens.SPACING_SM
	panel_style.content_margin_bottom = DesignTokens.SPACING_SM
	target_panel.add_theme_stylebox_override("panel", panel_style)

func _make_separator_style() -> StyleBoxFlat:
	var separator_style := StyleBoxFlat.new()
	separator_style.bg_color = DesignTokens.COLOR_BORDER_DEFAULT
	return separator_style

## 获取左侧分栏面板控件
func get_left_panel() -> Control:
	return _left_panel

## 获取右侧分栏面板控件
func get_right_panel() -> Control:
	return _right_panel

## 替换左侧分栏内挂载的子节点内容（先移除既有子节点，不释放外部所有权）
func set_left_content(content_control: Control) -> void:
	for child_node in _left_panel.get_children():
		_left_panel.remove_child(child_node)
	_left_panel.add_child(content_control)

## 替换右侧分栏内挂载的子节点内容（先移除既有子节点，不释放外部所有权）
func set_right_content(content_control: Control) -> void:
	for child_node in _right_panel.get_children():
		_right_panel.remove_child(child_node)
	_right_panel.add_child(content_control)

# ==============================================================================
# 模块归属: 前端通用组件层 (Frontend · Reusable UI Components)
# 文件路径: res://frontend/components/k_badge.gd
# 架构定位: Reusable Atomic Component (KBadge)
# 依赖与触发: 上游: 宿主按钮与菜单项 | 下游: RedDotTreeManager, DesignTokens
# 职责说明: 响应 RedDotTreeManager 路径状态变更，自动显示/隐藏红点或数字徽章（>99 折叠为 99+）。
# 退出语义与设计依据: 原子组件状态单向订阅与节点树退出自动解绑契约
# ==============================================================================

## KBadge：树状红点通知数字徽标组件
class_name KBadge
extends Control

signal count_changed(count: int)

@export var red_dot_path: String = "":
	set(value):
		red_dot_path = value
		_refresh_from_manager()

@export var show_count: bool = true
@export var severity_level: int = 0 # 0: ERROR 红, 1: WARNING 黄, 2: INFO 蓝

var _badge_panel: PanelContainer
var _count_label: Label

func _ready() -> void:
	custom_minimum_size = Vector2(16, 16)
	mouse_filter = MOUSE_FILTER_IGNORE
	_setup_ui()

	RedDotTreeManager.get_instance().red_dot_changed.connect(_on_red_dot_changed)
	_refresh_from_manager()

func _exit_tree() -> void:
	if RedDotTreeManager.get_instance().red_dot_changed.is_connected(_on_red_dot_changed):
		RedDotTreeManager.get_instance().red_dot_changed.disconnect(_on_red_dot_changed)

func _setup_ui() -> void:
	_badge_panel = PanelContainer.new()
	_badge_panel.set_anchors_and_offsets_preset(PRESET_FULL_RECT)
	_badge_panel.mouse_filter = MOUSE_FILTER_IGNORE

	var badge_style := StyleBoxFlat.new()
	badge_style.bg_color = _get_severity_color()
	badge_style.set_corner_radius_all(8)
	_badge_panel.add_theme_stylebox_override("panel", badge_style)
	add_child(_badge_panel)

	_count_label = Label.new()
	_count_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_count_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_count_label.add_theme_font_size_override("font_size", DesignTokens.FONT_SIZE_CAPTION)
	_count_label.add_theme_color_override("font_color", DesignTokens.COLOR_TEXT_PRIMARY)
	_count_label.mouse_filter = MOUSE_FILTER_IGNORE
	_badge_panel.add_child(_count_label)

func _get_severity_color() -> Color:
	match severity_level:
		0: return DesignTokens.COLOR_ERROR
		1: return DesignTokens.COLOR_WARNING
		2: return DesignTokens.COLOR_INFO
		_: return DesignTokens.COLOR_ERROR

func _refresh_from_manager() -> void:
	if red_dot_path.is_empty():
		visible = false
		return

	var count: int = RedDotTreeManager.get_instance().get_count(red_dot_path)
	_apply_count(count)

func _apply_count(count: int) -> void:
	if count <= 0:
		visible = false
		count_changed.emit(count)
		return

	visible = true
	if _count_label != null:
		if show_count:
			_count_label.text = "99+" if count > 99 else str(count)
		else:
			_count_label.text = ""

	count_changed.emit(count)

func _on_red_dot_changed(path: String, count: int) -> void:
	if path == red_dot_path:
		_apply_count(count)

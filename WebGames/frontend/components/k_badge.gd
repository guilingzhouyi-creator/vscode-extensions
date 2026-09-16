# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端通用组件: 树状红点徽标 (KBadge)
# 文件路径: res://frontend/components/k_badge.gd
# 职责: 响应 RedDotTreeManager 路径状态变更，自动显示/隐藏红点或数字徽章
# ==============================================================================
class_name KBadge
extends Control

const DesignTokens = preload("res://frontend/theme/design_tokens.gd")
const RedDotTreeManager = preload("res://frontend/ui_infrastructure/red_dot_tree_manager.gd")

@export var red_dot_path: String = "":
	set(val):
		red_dot_path = val
		_refresh_from_manager()

@export var show_count: bool = true

var _panel: PanelContainer
var _lbl_count: Label

func _ready() -> void:
	custom_minimum_size = Vector2(16, 16)
	mouse_filter = MOUSE_FILTER_IGNORE
	_setup_ui()

	RedDotTreeManager.get_instance().red_dot_changed.connect(_on_red_dot_changed)
	_refresh_from_manager()

func _setup_ui() -> void:
	_panel = PanelContainer.new()
	_panel.set_anchors_and_offsets_preset(PRESET_FULL_RECT)
	_panel.mouse_filter = MOUSE_FILTER_IGNORE

	var style := StyleBoxFlat.new()
	style.bg_color = DesignTokens.COLOR_ERROR
	style.set_corner_radius_all(8)
	_panel.add_theme_stylebox_override("panel", style)
	add_child(_panel)

	_lbl_count = Label.new()
	_lbl_count.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_lbl_count.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_lbl_count.add_theme_font_size_override("font_size", DesignTokens.FONT_SIZE_CAPTION)
	_lbl_count.add_theme_color_override("font_color", DesignTokens.COLOR_TEXT_PRIMARY)
	_lbl_count.mouse_filter = MOUSE_FILTER_IGNORE
	_panel.add_child(_lbl_count)

func _refresh_from_manager() -> void:
	if red_dot_path.is_empty():
		visible = false
		return

	var count: int = RedDotTreeManager.get_instance().get_count(red_dot_path)
	_apply_count(count)

func _apply_count(count: int) -> void:
	if count <= 0:
		visible = false
		return

	visible = true
	if _lbl_count != null:
		if show_count:
			_lbl_count.text = "99+" if count > 99 else str(count)
		else:
			_lbl_count.text = ""

func _on_red_dot_changed(path: String, count: int) -> void:
	if path == red_dot_path:
		_apply_count(count)

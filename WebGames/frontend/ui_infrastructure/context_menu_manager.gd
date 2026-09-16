# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - UI基础设施: 上下文右键菜单管理器
# 文件路径: res://frontend/ui_infrastructure/context_menu_manager.gd
# 职责: 管理任意屏幕坐标弹出的快捷上下文菜单（装备操作、玩家互动菜单）
# ==============================================================================
class_name ContextMenuManager
extends Node

const DesignTokens = preload("res://frontend/theme/design_tokens.gd")

signal menu_shown(pos: Vector2)
signal menu_hidden()

static var _instance: ContextMenuManager
static func get_instance() -> ContextMenuManager:
	if _instance == null:
		_instance = load("res://frontend/ui_infrastructure/context_menu_manager.gd").new()
		_instance.name = "ContextMenuManager"
	return _instance

var _layer: CanvasLayer
var _container: Control
var _menu_panel: PanelContainer
var _dismiss_catcher: Control

func bind_layer(layer: CanvasLayer, container: Control = null) -> void:
	_layer = layer
	_container = container if container != null else _ensure_fallback_container(layer)

## 创建/复用 layer 下的缺省承载容器（Control 类型安全，幂等）
func _ensure_fallback_container(layer: CanvasLayer) -> Control:
	if layer == null:
		return null
	var fallback_name := "ContextMenuManagerFallbackContainer"
	var existing := layer.get_node_or_null(fallback_name)
	if existing is Control:
		return existing
	var fallback := Control.new()
	fallback.name = fallback_name
	fallback.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	fallback.mouse_filter = Control.MOUSE_FILTER_IGNORE
	layer.add_child(fallback)
	return fallback

func show_menu(pos: Vector2, items: Array) -> Control:
	hide_menu()
	if _container == null:
		return null

	_dismiss_catcher = Control.new()
	_dismiss_catcher.name = "ContextMenuDismissCatcher"
	_dismiss_catcher.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_dismiss_catcher.gui_input.connect(_on_dismiss_input)
	_container.add_child(_dismiss_catcher)

	_menu_panel = PanelContainer.new()
	_menu_panel.name = "ContextMenuPanel"

	var style := StyleBoxFlat.new()
	style.bg_color = DesignTokens.COLOR_SURFACE_CARD
	style.set_corner_radius_all(4)
	style.border_width_bottom = 1
	style.border_width_left = 1
	style.border_width_right = 1
	style.border_width_top = 1
	style.border_color = DesignTokens.COLOR_PRIMARY
	_menu_panel.add_theme_stylebox_override("panel", style)

	var list := VBoxContainer.new()
	list.add_theme_constant_override("separation", DesignTokens.SPACING_XS)
	_menu_panel.add_child(list)

	for raw_item in items:
		if not (raw_item is Dictionary):
			continue
		var item: Dictionary = raw_item
		var btn := Button.new()
		btn.text = str(item.get("label", UIIntermediary.text("ui.common.menu.default_option")))
		btn.disabled = bool(item.get("disabled", false))
		btn.custom_minimum_size = Vector2(120, 28)

		var cb: Callable = item.get("callback", Callable())
		btn.pressed.connect(func():
			hide_menu()
			if cb.is_valid():
				cb.call()
		)
		list.add_child(btn)

	_container.add_child(_menu_panel)
	# 入参为画布全局坐标，转换为容器本地坐标后赋值，兼容非全屏偏移容器
	_menu_panel.position = _container.get_global_transform().affine_inverse() * pos

	menu_shown.emit(pos)
	return _menu_panel

func hide_menu() -> void:
	var had_menu := _menu_panel != null or _dismiss_catcher != null
	if _menu_panel != null:
		_menu_panel.queue_free()
		_menu_panel = null
	if _dismiss_catcher != null:
		_dismiss_catcher.queue_free()
		_dismiss_catcher = null
	if had_menu:
		menu_hidden.emit()

func is_menu_open() -> bool:
	return _menu_panel != null

func _on_dismiss_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed:
		hide_menu()

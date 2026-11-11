# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - UI基础设施: 边缘侧滑抽屉管理器
# 文件路径: res://frontend/ui_infrastructure/drawer_manager.gd
# 职责: 管理从屏幕左/右/底侧滑出的抽屉面板（快速背包、任务速查、队伍面板）
# ==============================================================================
class_name DrawerManager
extends Node

const DesignTokens = preload("res://frontend/theme/design_tokens.gd")

enum EdgeSide {
	LEFT,
	RIGHT,
	BOTTOM,
	TOP
}

signal drawer_opened(drawer: Control, side: EdgeSide)
signal drawer_closed(drawer: Control)

static var _instance: DrawerManager
static func get_instance() -> DrawerManager:
	if _instance == null:
		_instance = DrawerManager.new()
		_instance.name = "DrawerManager"
	return _instance

var _layer: CanvasLayer
var _container: Control
var _active_drawer: Control
var _backdrop: ColorRect

func bind_layer(layer: CanvasLayer, container: Control = null) -> void:
	_layer = layer
	_container = container if container != null else ModalManager.ensure_fallback_container(layer, "DrawerManagerFallbackContainer")
	_backdrop = ModalManager.ensure_backdrop_for_container(_container, _backdrop, "DrawerBackdrop", _on_backdrop_input)

## 打开抽屉
func open_drawer(drawer: Control, side: EdgeSide = EdgeSide.RIGHT) -> bool:
	if drawer == null:
		return false

	if _active_drawer != null and _active_drawer != drawer:
		close_drawer(_active_drawer)

	if _container != null and drawer.get_parent() != _container:
		_container.add_child(drawer)

	_active_drawer = drawer
	drawer.visible = true

	# 设置锚点
	match side:
		EdgeSide.LEFT:
			drawer.set_anchors_and_offsets_preset(Control.PRESET_LEFT_WIDE)
		EdgeSide.RIGHT:
			drawer.set_anchors_and_offsets_preset(Control.PRESET_RIGHT_WIDE)
		EdgeSide.BOTTOM:
			drawer.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_WIDE)
		EdgeSide.TOP:
			drawer.set_anchors_and_offsets_preset(Control.PRESET_TOP_WIDE)

	if _backdrop != null:
		_backdrop.visible = true
		if drawer.get_parent() == _container:
			_container.move_child(_backdrop, max(0, drawer.get_index() - 1))

	drawer_opened.emit(drawer, side)
	return true

## 关闭当前抽屉
func close_drawer(drawer: Control = null) -> void:
	var target: Control = drawer if drawer != null else _active_drawer
	if target == null:
		return

	if target == _active_drawer:
		_active_drawer = null

	target.visible = false
	if _backdrop != null:
		_backdrop.visible = false

	drawer_closed.emit(target)

func get_active_drawer() -> Control:
	return _active_drawer

func is_drawer_open() -> bool:
	return _active_drawer != null

func _on_backdrop_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		close_drawer()

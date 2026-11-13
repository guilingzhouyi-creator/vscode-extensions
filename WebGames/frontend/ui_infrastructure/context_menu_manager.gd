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
		_instance = ContextMenuManager.new()
		_instance.name = "ContextMenuManager"
	return _instance

var _layer: CanvasLayer
var _container: Control
var _menu_panel: PanelContainer
var _menu_list: VBoxContainer
var _dismiss_catcher: Control

static var _shared_menu_style: StyleBoxFlat = null

func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		if _menu_panel != null and is_instance_valid(_menu_panel) and not _menu_panel.is_inside_tree():
			_menu_panel.free()
		if _dismiss_catcher != null and is_instance_valid(_dismiss_catcher) and not _dismiss_catcher.is_inside_tree():
			_dismiss_catcher.free()
		_menu_panel = null
		_menu_list = null
		_dismiss_catcher = null

func bind_layer(layer: CanvasLayer, container: Control = null) -> void:
	_layer = layer
	_container = container if container != null else ModalManager.ensure_fallback_container(layer, "ContextMenuManagerFallbackContainer")

func _ensure_menu_nodes() -> void:
	if _dismiss_catcher == null or not is_instance_valid(_dismiss_catcher):
		_dismiss_catcher = Control.new()
		_dismiss_catcher.name = "ContextMenuDismissCatcher"
		_dismiss_catcher.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		_dismiss_catcher.gui_input.connect(_on_dismiss_input)
	if _dismiss_catcher.get_parent() != _container:
		if _dismiss_catcher.get_parent() != null:
			_dismiss_catcher.get_parent().remove_child(_dismiss_catcher)
		_container.add_child(_dismiss_catcher)

	if _menu_panel == null or not is_instance_valid(_menu_panel):
		_menu_panel = PanelContainer.new()
		_menu_panel.name = "ContextMenuPanel"
		if _shared_menu_style == null:
			var style := StyleBoxFlat.new()
			style.bg_color = DesignTokens.COLOR_SURFACE_CARD
			style.set_corner_radius_all(4)
			style.set_border_width_all(1)
			style.border_color = DesignTokens.COLOR_PRIMARY
			_shared_menu_style = style
		_menu_panel.add_theme_stylebox_override("panel", _shared_menu_style)
		_menu_list = VBoxContainer.new()
		_menu_list.add_theme_constant_override("separation", DesignTokens.SPACING_XS)
		_menu_panel.add_child(_menu_list)
	if _menu_panel.get_parent() != _container:
		if _menu_panel.get_parent() != null:
			_menu_panel.get_parent().remove_child(_menu_panel)
		_container.add_child(_menu_panel)

func show_menu(pos: Vector2, items: Array) -> Control:
	hide_menu()
	if _container == null:
		return null

	_ensure_menu_nodes()
	_dismiss_catcher.visible = true
	_menu_panel.visible = true

	var active_idx: int = 0
	for raw_item in items:
		if not (raw_item is Dictionary):
			continue
		_configure_menu_item_button(active_idx, raw_item as Dictionary)
		active_idx += 1
	for j in range(active_idx, _menu_list.get_child_count()):
		(_menu_list.get_child(j) as Control).visible = false

	# 入参为画布全局坐标，转换为容器本地坐标后赋值，兼容非全屏偏移容器
	_menu_panel.position = _container.get_global_transform().affine_inverse() * pos

	menu_shown.emit(pos)
	return _menu_panel

func _configure_menu_item_button(idx: int, item: Dictionary) -> void:
	var btn: Button = null
	if idx < _menu_list.get_child_count():
		btn = _menu_list.get_child(idx) as Button
		btn.visible = true
	else:
		btn = Button.new()
		btn.custom_minimum_size = Vector2(120, 28)
		btn.pressed.connect(_on_menu_item_pressed.bind(btn))
		_menu_list.add_child(btn)
	btn.text = str(item.get("label", UIIntermediary.text("ui.common.menu.default_option")))
	btn.disabled = bool(item.get("disabled", false))
	btn.set_meta("_menu_cb", item.get("callback", Callable()))

func _on_menu_item_pressed(btn: Button) -> void:
	var cb: Variant = btn.get_meta("_menu_cb", Callable())
	hide_menu()
	if cb is Callable and (cb as Callable).is_valid():
		(cb as Callable).call()

func hide_menu() -> void:
	var had_menu := is_menu_open()
	if _menu_panel != null and is_instance_valid(_menu_panel):
		_menu_panel.visible = false
	if _dismiss_catcher != null and is_instance_valid(_dismiss_catcher):
		_dismiss_catcher.visible = false
	if had_menu:
		menu_hidden.emit()

func is_menu_open() -> bool:
	return _menu_panel != null and is_instance_valid(_menu_panel) and _menu_panel.visible

func _on_dismiss_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed:
		hide_menu()

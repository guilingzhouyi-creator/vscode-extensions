# ==============================================================================
# 模块归属: Frontend / UIInfrastructure
# 文件路径: res://frontend/ui_infrastructure/context_menu_manager.gd
# 架构定位: UI 基础设施上下文菜单管理器，负责动态构建与复用全局右键操作菜单及外围点击关闭
# 依赖与触发: 依赖 DesignTokens 与 ModalManager 容器回退助手，由 AppRoot 绑定并在菜单触发时显示
# 职责说明: 管理任意屏幕坐标弹出的快捷上下文菜单（装备操作、玩家互动菜单）
# 退出语义与设计依据: 节点销毁前主动释放未挂载的菜单与遮罩实例；关闭或点击外部区域仅隐藏并复用按钮池
# ==============================================================================
## ContextMenuManager：上下文右键菜单管理器，负责菜单定位、按钮复用池与点击收起控制
class_name ContextMenuManager
extends Node

const DesignTokens = preload("res://frontend/theme/design_tokens.gd")

signal menu_shown(menu_position: Vector2)
signal menu_hidden()

static var _instance: ContextMenuManager
## 获取上下文菜单管理器全局单例
static func get_instance() -> ContextMenuManager:
	if _instance == null:
		_instance = ContextMenuManager.new()
		_instance.name = "ContextMenuManager"
	return _instance

var _target_layer: CanvasLayer
var _menu_container: Control
var _menu_panel: PanelContainer
var _menu_list: VBoxContainer
var _dismiss_catcher: Control

static var _shared_menu_style: StyleBoxFlat = null

func _notification(notification_type: int) -> void:
	if notification_type == NOTIFICATION_PREDELETE:
		if _menu_panel != null and is_instance_valid(_menu_panel) and not _menu_panel.is_inside_tree():
			_menu_panel.free()
		if _dismiss_catcher != null and is_instance_valid(_dismiss_catcher) and not _dismiss_catcher.is_inside_tree():
			_dismiss_catcher.free()
		_menu_panel = null
		_menu_list = null
		_dismiss_catcher = null

## 绑定菜单承载的 CanvasLayer 与容器节点
func bind_layer(target_layer: CanvasLayer, target_container: Control = null) -> void:
	_target_layer = target_layer
	_menu_container = target_container if target_container != null else ModalManager.ensure_fallback_container(target_layer, "ContextMenuManagerFallbackContainer")

func _ensure_menu_nodes() -> void:
	if _dismiss_catcher == null or not is_instance_valid(_dismiss_catcher):
		_dismiss_catcher = Control.new()
		_dismiss_catcher.name = "ContextMenuDismissCatcher"
		_dismiss_catcher.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		_dismiss_catcher.gui_input.connect(_on_dismiss_input)
	if _dismiss_catcher.get_parent() != _menu_container:
		if _dismiss_catcher.get_parent() != null:
			_dismiss_catcher.get_parent().remove_child(_dismiss_catcher)
		_menu_container.add_child(_dismiss_catcher)

	if _menu_panel == null or not is_instance_valid(_menu_panel):
		_menu_panel = PanelContainer.new()
		_menu_panel.name = "ContextMenuPanel"
		if _shared_menu_style == null:
			var menu_style := StyleBoxFlat.new()
			menu_style.bg_color = DesignTokens.COLOR_SURFACE_CARD
			menu_style.set_corner_radius_all(4)
			menu_style.set_border_width_all(1)
			menu_style.border_color = DesignTokens.COLOR_PRIMARY
			_shared_menu_style = menu_style
		_menu_panel.add_theme_stylebox_override("panel", _shared_menu_style)
		_menu_list = VBoxContainer.new()
		_menu_list.add_theme_constant_override("separation", DesignTokens.SPACING_XS)
		_menu_panel.add_child(_menu_list)
	if _menu_panel.get_parent() != _menu_container:
		if _menu_panel.get_parent() != null:
			_menu_panel.get_parent().remove_child(_menu_panel)
		_menu_container.add_child(_menu_panel)

## 在指定全局坐标处显示上下文菜单项列表
func show_menu(menu_position: Vector2, menu_entries: Array) -> Control:
	hide_menu()
	if _menu_container == null:
		return null

	_ensure_menu_nodes()
	_dismiss_catcher.visible = true
	_menu_panel.visible = true

	var active_index: int = 0
	for raw_entry in menu_entries:
		if not (raw_entry is Dictionary):
			continue
		_configure_menu_item_button(active_index, raw_entry as Dictionary)
		active_index += 1
	for hidden_index in range(active_index, _menu_list.get_child_count()):
		(_menu_list.get_child(hidden_index) as Control).visible = false

	# 入参为画布全局坐标，转换为容器本地坐标后赋值，兼容非全屏偏移容器
	_menu_panel.position = _menu_container.get_global_transform().affine_inverse() * menu_position

	menu_shown.emit(menu_position)
	return _menu_panel

func _configure_menu_item_button(item_index: int, menu_entry: Dictionary) -> void:
	var menu_button: Button = null
	if item_index < _menu_list.get_child_count():
		menu_button = _menu_list.get_child(item_index) as Button
		menu_button.visible = true
	else:
		menu_button = Button.new()
		menu_button.custom_minimum_size = Vector2(120, 28)
		menu_button.pressed.connect(_on_menu_item_pressed.bind(menu_button))
		_menu_list.add_child(menu_button)
	menu_button.text = str(menu_entry.get("label", UIIntermediary.text("ui.common.menu.default_option")))
	menu_button.disabled = bool(menu_entry.get("disabled", false))
	menu_button.set_meta("_menu_cb", menu_entry.get("callback", Callable()))

func _on_menu_item_pressed(menu_button: Button) -> void:
	var menu_callback: Variant = menu_button.get_meta("_menu_cb", Callable())
	hide_menu()
	if menu_callback is Callable and (menu_callback as Callable).is_valid():
		(menu_callback as Callable).call()

## 隐藏当前打开的上下文菜单并关闭外部点击捕获
func hide_menu() -> void:
	var was_menu_open := is_menu_open()
	if _menu_panel != null and is_instance_valid(_menu_panel):
		_menu_panel.visible = false
	if _dismiss_catcher != null and is_instance_valid(_dismiss_catcher):
		_dismiss_catcher.visible = false
	if was_menu_open:
		menu_hidden.emit()

## 查询上下文菜单当前是否处于可见状态
func is_menu_open() -> bool:
	return _menu_panel != null and is_instance_valid(_menu_panel) and _menu_panel.visible

func _on_dismiss_input(input_event: InputEvent) -> void:
	if input_event is InputEventMouseButton and input_event.pressed:
		hide_menu()

# ==============================================================================
# 模块归属: Frontend / UIInfrastructure
# 文件路径: res://frontend/ui_infrastructure/modal_manager.gd
# 架构定位: UI 基础设施模态弹窗管理器，维护全局弹窗栈、背景点击遮罩与共享遮罩创建助手
# 依赖与触发: 依赖 DesignTokens 与 EventBusCore，由 AppRoot 绑定并供 DialogManager 与视图调用
# 职责说明: 管理全屏业务模态弹窗（背包、合成、抽卡等），提供暗色遮罩、弹窗栈与点击拦截
# 退出语义与设计依据: 关闭弹窗时从栈顶或指定槽位移除并释放节点，同时动态对齐剩余栈顶下方遮罩可见性
# ==============================================================================
## ModalManager：全局模态弹窗栈管理器，负责弹窗堆栈调度、暗色遮罩维护与共享容器构建
class_name ModalManager
extends Node

signal modal_opened(modal: Control)
signal modal_closed(modal: Control)

static var _instance: ModalManager
## 获取模态弹窗管理器全局单例
static func get_instance() -> ModalManager:
	if _instance == null:
		_instance = ModalManager.new()
		_instance.name = "ModalManager"
	return _instance

## 安全剥离并同步释放模态或UI基础设施托管节点（共享供各 UI 管理器 teardown 复用）
static func detach_and_free_node(target_node: Variant) -> void:
	if target_node == null or not is_instance_valid(target_node):
		return
	if not (target_node is Node):
		return
	var node := target_node as Node
	var parent_node := node.get_parent()
	if parent_node != null:
		parent_node.remove_child(node)
	node.free()

## 重置模态弹窗管理器静态单例并同步释放残留弹窗与遮罩节点
static func reset_instance() -> void:
	if _instance != null and is_instance_valid(_instance):
		for modal_node in _instance._modal_stack:
			detach_and_free_node(modal_node)
		_instance._modal_stack.clear()
		_instance._dismiss_flags.clear()
		detach_and_free_node(_instance._backdrop)
		_instance._backdrop = null
		_instance._modal_container = null
		_instance._modal_layer = null
		detach_and_free_node(_instance)
	_instance = null

var _modal_layer: CanvasLayer
var _modal_container: Control
var _modal_stack: Array[Control] = []
var _dismiss_flags: Array[bool] = []
var _backdrop: ColorRect

## 绑定宿重视口层（container 缺省时在 layer 下自动创建全屏承载容器，保证类型安全与幂等重绑）
func bind_layer(layer: CanvasLayer, container: Control = null) -> void:
	_modal_layer = layer
	_modal_container = container if container != null else ensure_fallback_container(layer, "ModalManagerFallbackContainer")
	_backdrop = ensure_backdrop_for_container(_modal_container, _backdrop, "ModalBackdrop", _on_backdrop_input)

## 创建/复用 layer 下的缺省承载容器（Control 类型安全，幂等）
static func ensure_fallback_container(layer: CanvasLayer, fallback_name: String) -> Control:
	if layer == null:
		return null
	var existing := layer.get_node_or_null(fallback_name)
	if existing is Control:
		return existing
	var fallback := Control.new()
	fallback.name = fallback_name
	fallback.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	fallback.mouse_filter = Control.MOUSE_FILTER_IGNORE
	layer.add_child(fallback)
	return fallback

## 确保容器下全局暗色遮罩存在且对齐容器变化（UI 基础设施层共享，支持幂等重绑）
static func ensure_backdrop_for_container(
	container: Control,
	existing_backdrop: Variant,
	backdrop_name: String,
	on_input: Callable
) -> ColorRect:
	if container == null or not is_instance_valid(container):
		return existing_backdrop as ColorRect if (existing_backdrop != null and is_instance_valid(existing_backdrop)) else null
	if existing_backdrop != null and is_instance_valid(existing_backdrop) and existing_backdrop is ColorRect and existing_backdrop.get_parent() == container:
		return existing_backdrop
	if existing_backdrop != null and is_instance_valid(existing_backdrop):
		detach_and_free_node(existing_backdrop)
	var backdrop := ColorRect.new()
	backdrop.name = backdrop_name
	backdrop.color = DesignTokens.COLOR_BACKDROP_MASK
	backdrop.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	backdrop.mouse_filter = Control.MOUSE_FILTER_STOP
	backdrop.visible = false
	if on_input.is_valid():
		backdrop.gui_input.connect(on_input)
	container.add_child(backdrop)
	return backdrop

## 打开模态弹窗（同一实例重复打开时提升为栈顶，避免栈内重复与悬空键）
func open_modal(modal: Control, dismiss_on_backdrop: bool = false) -> bool:
	if modal == null:
		EventBusCore.get_instance().emit_log("warn", "ModalManager: cannot open null modal control")
		return false

	if _modal_container != null and modal.get_parent() != _modal_container:
		_modal_container.add_child(modal)
		modal.set_anchors_and_offsets_preset(Control.PRESET_CENTER)

	var existing_index := _modal_stack.find(modal)
	if existing_index >= 0:
		_modal_stack.remove_at(existing_index)
		_dismiss_flags.remove_at(existing_index)

	_modal_stack.append(modal)
	_dismiss_flags.append(dismiss_on_backdrop)
	modal.visible = true

	_update_backdrop()

	modal_opened.emit(modal)
	return true

## 关闭指定或最顶层模态
func close_modal(modal: Control = null) -> void:
	if _modal_stack.is_empty():
		return

	var target_modal: Control = modal if modal != null else _modal_stack.back()
	var modal_index := _modal_stack.find(target_modal)
	if modal_index >= 0:
		_modal_stack.remove_at(modal_index)
		_dismiss_flags.remove_at(modal_index)
		target_modal.visible = false
		modal_closed.emit(target_modal)
		target_modal.queue_free()

	_update_backdrop()

## 关闭所有模态弹窗
func close_all_modals() -> void:
	while not _modal_stack.is_empty():
		close_modal()

## 获取当前已打开的模态弹窗数量
func get_modal_count() -> int:
	return _modal_stack.size()

## 获取位于弹窗栈最顶层的当前活跃模态控件
func get_top_modal() -> Control:
	return _modal_stack.back() if not _modal_stack.is_empty() else null

func _update_backdrop() -> void:
	if _backdrop == null:
		return
	if _modal_stack.is_empty():
		_backdrop.visible = false
	else:
		_backdrop.visible = true
		# 确保 backdrop 位于最顶层 modal 的正下方
		var top_modal: Control = _modal_stack.back() if not _modal_stack.is_empty() else null
		if top_modal != null and top_modal.get_parent() == _modal_container:
			_modal_container.move_child(_backdrop, max(0, top_modal.get_index() - 1))

func _on_backdrop_input(input_event: InputEvent) -> void:
	if input_event is InputEventMouseButton and input_event.pressed and input_event.button_index == MOUSE_BUTTON_LEFT:
		if not _dismiss_flags.is_empty() and _dismiss_flags.back():
			close_modal()

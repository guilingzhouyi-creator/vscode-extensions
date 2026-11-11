# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - UI基础设施: 模态弹窗管理器
# 文件路径: res://frontend/ui_infrastructure/modal_manager.gd
# 职责: 管理全屏业务模态弹窗（背包、合成、抽卡等），提供暗色遮罩、弹窗栈与点击拦截
# ==============================================================================
class_name ModalManager
extends Node

const DesignTokens = preload("res://frontend/theme/design_tokens.gd")

signal modal_opened(modal: Control)
signal modal_closed(modal: Control)

static var _instance: ModalManager
static func get_instance() -> ModalManager:
	if _instance == null:
		_instance = ModalManager.new()
		_instance.name = "ModalManager"
	return _instance

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
	existing_backdrop: ColorRect,
	backdrop_name: String,
	on_input: Callable
) -> ColorRect:
	if container == null:
		return existing_backdrop
	if existing_backdrop != null and is_instance_valid(existing_backdrop) and existing_backdrop.get_parent() == container:
		return existing_backdrop
	if existing_backdrop != null and is_instance_valid(existing_backdrop):
		existing_backdrop.queue_free()
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

	var existing_idx := _modal_stack.find(modal)
	if existing_idx >= 0:
		_modal_stack.remove_at(existing_idx)
		_dismiss_flags.remove_at(existing_idx)

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

	var target: Control = modal if modal != null else _modal_stack.back()
	var idx := _modal_stack.find(target)
	if idx >= 0:
		_modal_stack.remove_at(idx)
		_dismiss_flags.remove_at(idx)
		target.visible = false
		modal_closed.emit(target)
		target.queue_free()

	_update_backdrop()

## 关闭所有模态弹窗
func close_all_modals() -> void:
	while not _modal_stack.is_empty():
		close_modal()

func get_modal_count() -> int:
	return _modal_stack.size()

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

func _on_backdrop_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		if not _dismiss_flags.is_empty() and _dismiss_flags.back():
			close_modal()

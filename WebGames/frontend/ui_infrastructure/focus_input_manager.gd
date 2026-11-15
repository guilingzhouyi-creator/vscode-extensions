# ==============================================================================
# 模块归属: Frontend / UIInfrastructure
# 文件路径: res://frontend/ui_infrastructure/focus_input_manager.gd
# 架构定位: UI 基础设施焦点管理单例，维护模态弹窗场景下的 Focus Trap 历史栈与恢复
# 依赖与触发: 依赖 Godot Control / Viewport GUI 焦点接口，由模态弹窗或视图控制器入栈/出栈调用
# 职责说明: 管理模态弹窗打开时的 FocusTrap 焦点捕获与关闭后的原焦点恢复
# 退出语义与设计依据: 出栈前先校验历史焦点控件有效性（is_instance_valid 且仍在树内），防止悬空节点抢焦异常
# ==============================================================================
## FocusInputManager：键鼠与手柄焦点栈管理器，负责 Focus Trap 捕获与历史焦点恢复
class_name FocusInputManager
extends RefCounted

static var _instance: FocusInputManager
## 获取焦点输入管理器全局单例
static func get_instance() -> FocusInputManager:
	if _instance == null:
		_instance = FocusInputManager.new()
	return _instance

## 重置焦点输入管理器静态单例并清空历史焦点栈
static func reset_instance() -> void:
	if _instance != null:
		_instance._focus_history.clear()
		_instance._active_traps.clear()
	_instance = null

var _focus_history: Array[Control] = []
var _active_traps: Array[Control] = []

## 压入焦点陷阱 (Focus Trap) 并聚焦目标
func push_focus_trap(container: Control, default_focus: Control = null) -> void:
	if container == null:
		return

	# 记录当前视口中的活跃焦点
	var viewport := container.get_viewport()
	if viewport != null:
		var current_focus := viewport.gui_get_focus_owner()
		_focus_history.append(current_focus)
	else:
		_focus_history.append(null)

	_active_traps.append(container)

	if default_focus != null and default_focus.is_inside_tree():
		default_focus.grab_focus()
	elif container.is_inside_tree():
		var first_focusable := _find_first_focusable(container)
		if first_focusable != null:
			first_focusable.grab_focus()

## 弹出焦点陷阱并恢复先前焦点
func pop_focus_trap() -> void:
	if not _active_traps.is_empty():
		_active_traps.pop_back()

	if not _focus_history.is_empty():
		var previous_focus: Control = _focus_history.pop_back()
		if previous_focus != null and is_instance_valid(previous_focus) and previous_focus.is_inside_tree():
			previous_focus.grab_focus()

## 获取当前激活的焦点陷阱嵌套深度
func get_trap_depth() -> int:
	return _active_traps.size()

func _find_first_focusable(search_node: Node) -> Control:
	if search_node is Control:
		var control_node: Control = search_node
		if control_node.focus_mode != Control.FOCUS_NONE and control_node.visible:
			return control_node

	for child_node in search_node.get_children():
		var focusable_control := _find_first_focusable(child_node)
		if focusable_control != null:
			return focusable_control
	return null

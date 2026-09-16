# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - UI基础设施: 键鼠与手柄焦点管理器
# 文件路径: res://frontend/ui_infrastructure/focus_input_manager.gd
# 职责: 管理模态弹窗打开时的 FocusTrap 焦点捕获与关闭后的原焦点恢复
# ==============================================================================
class_name FocusInputManager
extends RefCounted

static var _instance: FocusInputManager
static func get_instance() -> FocusInputManager:
	if _instance == null:
		_instance = load("res://frontend/ui_infrastructure/focus_input_manager.gd").new()
	return _instance

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

func get_trap_depth() -> int:
	return _active_traps.size()

func _find_first_focusable(node: Node) -> Control:
	if node is Control:
		var ctrl: Control = node
		if ctrl.focus_mode != Control.FOCUS_NONE and ctrl.visible:
			return ctrl

	for child in node.get_children():
		var found := _find_first_focusable(child)
		if found != null:
			return found
	return null

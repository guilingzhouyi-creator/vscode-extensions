# ==============================================================================
# 模块归属: Frontend / Presentation
# 文件路径: res://frontend/presentation/base/base_screen.gd
# 架构定位: 前端表现层全屏界面基类，规范一级视图生命周期、信号托管与状态容器挂载
# 依赖与触发: 由各一级功能视图继承，由 NavManager 注入参数并驱动进退场回调
# 职责说明: 规范全屏一级视图的标准生命周期时序、统一快照注入入口与五态容器挂载点
# 退出语义与设计依据: 退场或析构时批量解绑托管信号与防抖状态，防止悬空 Callable 回调泄漏
# ==============================================================================
## BaseScreen：全屏一级界面抽象基类，统一生命周期、信号托管与五态容器入口
class_name BaseScreen
extends Control

const UIStateContainerClass = preload("res://frontend/presentation/common/ui_state_container.gd")
const NavTypes = preload("res://frontend/navigation/nav_types.gd")
const NavManager = preload("res://frontend/navigation/nav_manager.gd")

var screen_id: String = ""
var navigation_params: Dictionary = {}
var snapshot: Dictionary = {}
var ui_state_container: Control = null
var _owned_subcontroller: Node = null
var _managed_connections: Array[Dictionary] = []
var _action_cooldown_milliseconds: Dictionary = {}

## 注册受 BaseScreen 生命周期托管的信号连接（幂等防重连，节点销毁时自动对称断开）
func connect_managed(target_signal: Signal, target_callable: Callable, flags: int = 0) -> void:
	var source_object: Object = target_signal.get_object()
	if source_object == null or not is_instance_valid(source_object):
		return
	if target_signal.is_connected(target_callable):
		return
	target_signal.connect(target_callable, flags)
	_managed_connections.append({
		"signal_name": target_signal.get_name(),
		"source_ref": weakref(source_object),
		"target": target_callable
	})

## 判定指定动作键是否处于冷却防抖窗口内（默认窗口 0ms 不拦截；非零可用于高频提交防连击）
func try_consume_action_cooldown(action_key: String, cooldown_milliseconds: int = 180) -> bool:
	if cooldown_milliseconds <= 0 or action_key.is_empty():
		return true
	var current_milliseconds: int = Time.get_ticks_msec()
	var previous_milliseconds: int = int(_action_cooldown_milliseconds.get(action_key, -cooldown_milliseconds))
	if current_milliseconds - previous_milliseconds < cooldown_milliseconds:
		return false
	_action_cooldown_milliseconds[action_key] = current_milliseconds
	return true

## 检查当前视图节点是否已挂载至场景树或父级导航宿主容器内
func is_mounted_in_tree() -> bool:
	return is_inside_tree() or get_parent() != null

## 安全断开由本视图登记的全部托管信号连接（幂等、防已释放对象悬空）
func disconnect_managed_signals() -> void:
	for connection_entry in _managed_connections:
		var source_weak_reference: Variant = connection_entry.get("source_ref")
		if not (source_weak_reference is WeakRef):
			continue
		var source_object: Variant = (source_weak_reference as WeakRef).get_ref()
		if source_object == null or not is_instance_valid(source_object):
			continue
		var signal_name: StringName = connection_entry.get("signal_name", &"")
		var target_callable: Callable = connection_entry.get("target", Callable())
		if target_callable.is_valid() and (source_object as Object).is_connected(signal_name, target_callable):
			(source_object as Object).disconnect(signal_name, target_callable)
	_managed_connections.clear()
	_action_cooldown_milliseconds.clear()

## 页面被推入激活时调用
func on_screen_enter(screen_parameters: Dictionary = {}) -> void:
	navigation_params = screen_parameters.duplicate()

## 将导航参数中的会话与世界上下文同步到视图实例属性（单源收敛，消除各屏重复赋值）
func _sync_navigation_context_properties(screen_parameters: Dictionary, extra_key_map: Dictionary = {}) -> void:
	if screen_parameters.has("account_id") and "current_account_id" in self:
		set("current_account_id", str(screen_parameters.get("account_id", "")))
	if screen_parameters.has("token") and "current_session_token" in self:
		set("current_session_token", str(screen_parameters.get("token", "")))
	for navigation_key in extra_key_map.keys():
		if screen_parameters.has(navigation_key):
			var target_property := str(extra_key_map[navigation_key])
			if target_property in self:
				set(target_property, str(screen_parameters.get(navigation_key, "")))

## 页面被弹出或销毁时调用（默认清理本视图 i18n 绑定，防悬挂引用）
func on_screen_exit() -> void:
	UIIntermediary.clear_view_bindings(self)

## 统一返回上一视图（供子类或标题栏组件调用）
func back(transition_type: int = NavTypes.TransitionType.SLIDE_RIGHT) -> void:
	NavManager.get_instance().pop_screen(transition_type)

## 页面被后置遮盖挂起时调用 (如上面弹出了全屏新页面)
func on_screen_suspend() -> void:
	pass

## 上层页面关闭，本页面重新获得焦点时调用
func on_screen_resume() -> void:
	pass

## 统一业务数据入口：所有业务数据必须经此注入（视图严禁自读业务 mock 与后端配置）
func apply_snapshot(snapshot_payload: Dictionary) -> void:
	snapshot = snapshot_payload.duplicate(true)
	_render_from_snapshot()

## 子类渲染映射钩子：只允许将快照字段映射到节点，禁止业务计算与随机判定
func _render_from_snapshot() -> void:
	pass

## 注册由本视图独占持有的子控制器（页面销毁时自动安全释放）
func _register_owned_subcontroller(controller: Node) -> Node:
	_owned_subcontroller = controller
	return controller

## 子类扩展清理钩子（销毁前最先触发）
func _on_predelete_cleanup() -> void:
	pass

## 根节点销毁时自动清理视图动态绑定与非树上子控制器
func _notification(notification_type: int) -> void:
	if notification_type == NOTIFICATION_PREDELETE:
		_on_predelete_cleanup()
		disconnect_managed_signals()
		UIIntermediary.clear_view_bindings(self)
		if is_instance_valid(_owned_subcontroller) and not _owned_subcontroller.is_inside_tree():
			_owned_subcontroller.free()
		_owned_subcontroller = null

## 懒加载五态容器（Loading / Ready / Empty / Error 与重试回调）
func get_ui_state_container() -> Control:
	if ui_state_container == null or not is_instance_valid(ui_state_container):
		ui_state_container = UIStateContainerClass.new()
		ui_state_container.name = "UIStateContainer"
		ui_state_container.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		ui_state_container.mouse_filter = Control.MOUSE_FILTER_IGNORE
		add_child(ui_state_container)
		if ui_state_container.is_node_ready():
			ui_state_container.set_state(UIStateContainerClass.State.READY)
		else:
			ui_state_container.ready.connect(_on_ui_state_container_ready, CONNECT_ONE_SHOT)
	return ui_state_container

func _on_ui_state_container_ready() -> void:
	if ui_state_container != null and is_instance_valid(ui_state_container):
		ui_state_container.set_state(UIStateContainerClass.State.READY)

## 展示加载态（数据拉取中）
func show_loading_state() -> void:
	get_ui_state_container().set_state(UIStateContainerClass.State.LOADING)

## 展示就绪态（数据渲染完成）
func show_ready_state() -> void:
	get_ui_state_container().set_state(UIStateContainerClass.State.READY)

## 展示空数据态
func show_empty_state() -> void:
	get_ui_state_container().set_state(UIStateContainerClass.State.EMPTY)

## 展示错误态并绑定重试回调
func show_error_state(message: String = "", retry_callback: Callable = Callable()) -> void:
	var container: Control = get_ui_state_container()
	if not message.is_empty():
		container.set_error_message(message)
	container.bind_retry_callback(retry_callback)
	container.set_state(UIStateContainerClass.State.ERROR)

## 通用 K-组件单例/懒加载装配助手（泛化解耦，避免各子面板模板复制）
func _ensure_page_header(current: Control, header_script: Script, title_key: String, host_view: Control = null) -> Control:
	if current == null:
		current = header_script.new() as Control
		current.set("title_key", title_key)
		var target_host: Control = host_view if host_view != null else self
		current.connect("back_pressed", Callable(target_host, "back"))
	return current

func _ensure_split_panel(current: Control, split_script: Script, split_ratio: float = 0.35) -> Control:
	if current == null:
		current = split_script.new() as Control
		current.set("left_ratio", split_ratio)
	return current

func _ensure_currency_bar(current: Control, bar_script: Script, show_gold: bool = false, show_crystals: bool = false) -> Control:
	if current == null:
		current = bar_script.new() as Control
		if show_gold:
			current.set("show_gold", true)
		if show_crystals:
			current.set("show_crystals", true)
	return current

func _ensure_search_bar(current: Control, search_script: Script, placeholder_key: String = "") -> Control:
	if current == null:
		current = search_script.new() as Control
		if not placeholder_key.is_empty():
			current.set("placeholder_key", placeholder_key)
	return current

func _ensure_state_panel(current: Control, state_script: Script) -> Control:
	if current == null:
		current = state_script.new() as Control
	return current

func _ensure_status_bar(current: Control, bar_script: Script, label_key: String = "") -> Control:
	if current == null:
		current = bar_script.new() as Control
		if not label_key.is_empty():
			current.set("label_key", label_key)
	return current

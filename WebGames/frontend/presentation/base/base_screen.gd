# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端表现层: 全屏一级界面抽象基类
# 文件路径: res://frontend/presentation/base/base_screen.gd
# 职责: 规范全屏一级视图的标准生命周期时序、统一快照注入入口与五态容器挂载点
# ==============================================================================
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

## 页面被推入激活时调用
func on_screen_enter(params: Dictionary = {}) -> void:
	navigation_params = params.duplicate()

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
func apply_snapshot(payload: Dictionary) -> void:
	snapshot = payload.duplicate(true)
	_render_from_snapshot()

## 子类渲染映射钩子：只允许将快照字段映射到节点，禁止业务计算与随机判定
func _render_from_snapshot() -> void:
	pass

## 注册由本视图独占持有的子控制器（页面销毁时自动安全释放）
func _register_owned_subcontroller(ctrl: Node) -> Node:
	_owned_subcontroller = ctrl
	return ctrl

## 子类扩展清理钩子（销毁前最先触发）
func _on_predelete_cleanup() -> void:
	pass

## 根节点销毁时自动清理视图动态绑定与非树上子控制器
func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		_on_predelete_cleanup()
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

func _ensure_split_panel(current: Control, split_script: Script, ratio: float = 0.35) -> Control:
	if current == null:
		current = split_script.new() as Control
		current.set("left_ratio", ratio)
	return current

func _ensure_currency_bar(current: Control, bar_script: Script, show_gold: bool = false, show_crystals: bool = false) -> Control:
	if current == null:
		current = bar_script.new() as Control
		if show_gold:
			current.set("show_gold", true)
		if show_crystals:
			current.set("show_crystals", true)
	return current

func _ensure_search_bar(current: Control, search_script: Script, ph_key: String = "") -> Control:
	if current == null:
		current = search_script.new() as Control
		if not ph_key.is_empty():
			current.set("placeholder_key", ph_key)
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

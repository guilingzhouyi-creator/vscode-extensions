# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端表现层: 全屏一级界面抽象基类
# 文件路径: res://frontend/presentation/base/base_screen.gd
# 职责: 规范全屏一级视图的标准生命周期时序、统一快照注入入口与五态容器挂载点
# ==============================================================================
class_name BaseScreen
extends Control

const UIStateContainerClass = preload("res://frontend/presentation/common/ui_state_container.gd")

var screen_id: String = ""
var navigation_params: Dictionary = {}
var snapshot: Dictionary = {}
var ui_state_container: Control = null

## 页面被推入激活时调用
func on_screen_enter(params: Dictionary = {}) -> void:
	navigation_params = params.duplicate()

## 页面被弹出或销毁时调用（默认清理本视图 i18n 绑定，防悬挂引用）
func on_screen_exit() -> void:
	UIIntermediary.clear_view_bindings(self)

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

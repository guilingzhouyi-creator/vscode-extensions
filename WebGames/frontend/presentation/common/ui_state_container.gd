# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端表现层: 通用 UI 状态机容器
# 文件路径: res://frontend/presentation/common/ui_state_container.gd
# 职责: 统一呈现 INITIAL, LOADING, READY, EMPTY, ERROR 五大核心可视化状态
# ==============================================================================
class_name UIStateContainer
extends Control

enum State {
	INITIAL,
	LOADING,
	READY,
	EMPTY,
	ERROR
}

## 当前状态（私有，读经 get_state()；写经 set_state() 保证可见性同步）
var _current_state: State = State.INITIAL
var retry_callback: Callable

var loading_node: Control
var ready_node: Control
var empty_node: Control
var error_node: Control

var error_label: Label
var retry_button: Button

func _ready() -> void:
	_setup_internal_nodes()
	set_state(State.INITIAL)

## 读取当前状态
func get_state() -> State:
	return _current_state

## 构建内部基础展示节点
func _setup_internal_nodes() -> void:
	# 寻找场景树中预定义的子节点或代码动态生成
	loading_node = get_node_or_null("LoadingView") as Control
	ready_node = get_node_or_null("ReadyView") as Control
	empty_node = get_node_or_null("EmptyView") as Control
	error_node = get_node_or_null("ErrorView") as Control

	if loading_node == null:
		loading_node = _create_placeholder_view(UIIntermediary.text("ui.common.state.loading"), DesignTokens.COLOR_ACCENT_DEFAULT)
		loading_node.name = "LoadingView"
		add_child(loading_node)

	if empty_node == null:
		empty_node = _create_placeholder_view(UIIntermediary.text("ui.common.state.empty"), DesignTokens.COLOR_TEXT_MUTED_DEFAULT)
		empty_node.name = "EmptyView"
		add_child(empty_node)

	if error_node == null:
		var err_container := VBoxContainer.new()
		err_container.name = "ErrorView"
		err_container.alignment = BoxContainer.ALIGNMENT_CENTER
		err_container.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)

		error_label = Label.new()
		error_label.text = UIIntermediary.text("ui.common.state.error")
		error_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		error_label.add_theme_color_override("font_color", DesignTokens.COLOR_DANGER_DEFAULT)
		err_container.add_child(error_label)

		retry_button = Button.new()
		retry_button.text = UIIntermediary.text("ui.common.state.retry")
		retry_button.pressed.connect(_on_retry_pressed)
		err_container.add_child(retry_button)

		error_node = err_container
		add_child(error_node)

## 切换状态并更新可见性
func set_state(new_state: State) -> void:
	_current_state = new_state
	if loading_node:
		loading_node.visible = (new_state == State.LOADING)
	if ready_node:
		ready_node.visible = (new_state == State.READY)
	if empty_node:
		empty_node.visible = (new_state == State.EMPTY)
	if error_node:
		error_node.visible = (new_state == State.ERROR)

## 绑定用户自定义业务展示节点为 READY 节点
## 归属校验：节点必须位于本容器子树（非同树节点无法受 visible 控制），否则自动收养
func set_ready_view(node: Control) -> void:
	if node == null or node == self:
		return
	if not is_ancestor_of(node):
		add_child(node)
	ready_node = node
	set_state(_current_state)

## 绑定错误重试回调
func bind_retry_callback(cb: Callable) -> void:
	retry_callback = cb

## 自定义错误文案
func set_error_message(msg: String) -> void:
	if error_label != null:
		error_label.text = msg

func _on_retry_pressed() -> void:
	set_state(State.LOADING)
	if retry_callback.is_valid():
		retry_callback.call()

func _create_placeholder_view(text: String, text_color: Color) -> Control:
	var box := CenterContainer.new()
	box.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var lbl := Label.new()
	lbl.text = text
	lbl.add_theme_color_override("font_color", text_color)
	box.add_child(lbl)
	return box

# ==============================================================================
# 模块归属: Frontend / Presentation
# 文件路径: res://frontend/presentation/common/toast_layer.gd
# 架构定位: 前端表现层全局轻提示队列容器，管理浮动提示节点池与自动淡出动效
# 依赖与触发: 挂载于 AppRoot 顶层覆盖节点，由 NavManager 或 Toast 通知接口触发入队
# 职责说明: 呈现居中浮动轻提示消息流，支持自动淡出、队列堆叠与等级配色
# 退出语义与设计依据: 节点析构前遍历释放对象池内有效节点并清空队列，防止孤立 Control 内存残留
# ==============================================================================
## ToastLayer：全局轻提示管理器，负责消息队列堆叠、对象池复用与自动淡出
class_name ToastLayer
extends VBoxContainer

## 同时可见 Toast 上限（超出淘汰最旧，防堆叠失控）
const MAX_TOASTS: int = 8

var _toast_pool: Array[PanelContainer] = []

func _ready() -> void:
	alignment = BoxContainer.ALIGNMENT_CENTER
	mouse_filter = Control.MOUSE_FILTER_IGNORE

func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		for toast_item in _toast_pool:
			if toast_item != null and is_instance_valid(toast_item):
				toast_item.free()
		_toast_pool.clear()

func _acquire_toast_panel() -> PanelContainer:
	while not _toast_pool.is_empty():
		var reused: PanelContainer = _toast_pool.pop_back()
		if reused != null and is_instance_valid(reused):
			return reused
	var panel := PanelContainer.new()
	panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var toast_label := Label.new()
	toast_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	panel.add_child(toast_label)
	return panel

func _recycle_toast_panel(panel: PanelContainer) -> void:
	if panel == null or not is_instance_valid(panel):
		return
	var old_tween: Variant = panel.get_meta("_toast_tween", null)
	if old_tween is Tween and (old_tween as Tween).is_valid():
		(old_tween as Tween).kill()
	panel.set_meta("_toast_tween", null)
	if panel.get_parent() == self:
		remove_child(panel)
	if _toast_pool.size() < MAX_TOASTS:
		_toast_pool.append(panel)
	else:
		panel.free()

## 显示单条 Toast
func show_toast(message: String, level: int = NavTypes.ToastLevel.INFO, duration_sec: float = 2.0) -> void:
	# 堆叠上限：超出时淘汰并池化回收最旧面板
	while get_child_count() >= MAX_TOASTS:
		var oldest := get_child(0) as PanelContainer
		if oldest == null:
			break
		_recycle_toast_panel(oldest)

	var panel := _acquire_toast_panel()
	var toast_label := panel.get_child(0) as Label
	toast_label.text = message

	var text_color := DesignTokens.COLOR_TEXT_DEFAULT
	match level:
		NavTypes.ToastLevel.SUCCESS:
			text_color = DesignTokens.COLOR_SUCCESS_DEFAULT
		NavTypes.ToastLevel.WARNING:
			text_color = DesignTokens.COLOR_WARNING_DEFAULT
		NavTypes.ToastLevel.ERROR:
			text_color = DesignTokens.COLOR_DANGER_DEFAULT

	toast_label.add_theme_color_override("font_color", text_color)
	panel.modulate.a = 0.0
	add_child(panel)

	# 淡入淡出 Tween
	var tween := create_tween()
	panel.set_meta("_toast_tween", tween)
	tween.tween_property(panel, "modulate:a", 1.0, 0.15)
	tween.tween_interval(duration_sec)
	tween.tween_property(panel, "modulate:a", 0.0, 0.3)
	tween.tween_callback(_recycle_toast_panel.bind(panel))

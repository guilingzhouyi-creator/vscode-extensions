# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端表现层: 全局 Toast 提示管理器
# 文件路径: res://frontend/presentation/common/toast_layer.gd
# 职责: 呈现居中浮动轻提示消息流，支持自动淡出、队列堆叠与等级配色
# ==============================================================================
class_name ToastLayer
extends VBoxContainer

## 同时可见 Toast 上限（超出淘汰最旧，防堆叠失控）
const MAX_TOASTS: int = 8

func _ready() -> void:
	alignment = BoxContainer.ALIGNMENT_CENTER
	mouse_filter = Control.MOUSE_FILTER_IGNORE

## 显示单条 Toast
func show_toast(message: String, level: int = NavTypes.ToastLevel.INFO, duration_sec: float = 2.0) -> void:
	# 堆叠上限：超出时淘汰最旧面板（R-01：先 remove_child 使 get_child_count 当帧即时递减，
	# 再 queue_free 延迟释放；杜绝 queue_free 延迟语义导致的计数不减死循环）
	while get_child_count() >= MAX_TOASTS:
		var oldest: Node = get_child(0)
		if oldest == null:
			break
		remove_child(oldest)
		oldest.queue_free()

	var panel := PanelContainer.new()
	panel.mouse_filter = Control.MOUSE_FILTER_IGNORE

	var lbl := Label.new()
	lbl.text = message
	lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER

	var text_color := DesignTokens.COLOR_TEXT_DEFAULT
	match level:
		NavTypes.ToastLevel.SUCCESS:
			text_color = DesignTokens.COLOR_SUCCESS_DEFAULT
		NavTypes.ToastLevel.WARNING:
			text_color = DesignTokens.COLOR_WARNING_DEFAULT
		NavTypes.ToastLevel.ERROR:
			text_color = DesignTokens.COLOR_DANGER_DEFAULT

	lbl.add_theme_color_override("font_color", text_color)
	panel.add_child(lbl)
	add_child(panel)

	# 淡入淡出 Tween
	var tween := create_tween()
	panel.modulate.a = 0.0
	tween.tween_property(panel, "modulate:a", 1.0, 0.15)
	tween.tween_interval(duration_sec)
	tween.tween_property(panel, "modulate:a", 0.0, 0.3)
	tween.tween_callback(panel.queue_free)

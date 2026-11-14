# ==============================================================================
# 模块归属: Frontend / Presentation
# 文件路径: res://frontend/presentation/common/loading_overlay.gd
# 架构定位: 前端表现层全局加载遮罩组件，阻断异步切换期间的重复输入
# 依赖与触发: 依赖 UIIntermediary 获取默认加载文案，由 AppRoot 与导航流程控制显隐
# 职责说明: 异步网络或场景切换时的全屏半透明阻断与指示器
# 退出语义与设计依据: 仅控制自身可见性与提示文案；节点隐藏后即自动放行底层控件输入事件
# ==============================================================================
## LoadingOverlay：全局异步加载遮罩组件，提供阻断态提示显示与隐藏控制
class_name LoadingOverlay
extends Control

var _hint_label: Label

func _ready() -> void:
	visible = false
	mouse_filter = Control.MOUSE_FILTER_STOP # 阻断下层点击
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)

	var background_panel := ColorRect.new()
	background_panel.color = DesignTokens.COLOR_OVERLAY_DIM
	background_panel.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(background_panel)

	var center_container := CenterContainer.new()
	center_container.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_hint_label = Label.new()
	_hint_label.text = UIIntermediary.text("ui.common.loading")
	_hint_label.add_theme_font_size_override("font_size", 20)
	center_container.add_child(_hint_label)
	add_child(center_container)

## 显示全屏加载遮罩与提示文本
func show_loading(hint_text: String = "") -> void:
	if _hint_label != null:
		_hint_label.text = hint_text if not hint_text.is_empty() else UIIntermediary.text("ui.common.loading")
	visible = true

## 隐藏全屏加载遮罩
func hide_loading() -> void:
	visible = false

# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端表现层: 全局 Loading 遮罩
# 文件路径: res://frontend/presentation/common/loading_overlay.gd
# 职责: 异步网络或场景切换时的全屏半透明阻断与指示器
# ==============================================================================
class_name LoadingOverlay
extends Control

var _label: Label

func _ready() -> void:
	visible = false
	mouse_filter = Control.MOUSE_FILTER_STOP # 阻断下层点击
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)

	var bg := ColorRect.new()
	bg.color = DesignTokens.COLOR_OVERLAY_DIM
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(bg)

	var center := CenterContainer.new()
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_label = Label.new()
	_label.text = UIIntermediary.text("ui.common.loading")
	_label.add_theme_font_size_override("font_size", 20)
	center.add_child(_label)
	add_child(center)

func show_loading(hint: String = "载入中...") -> void:
	if _label != null:
		_label.text = hint
	visible = true

func hide_loading() -> void:
	visible = false

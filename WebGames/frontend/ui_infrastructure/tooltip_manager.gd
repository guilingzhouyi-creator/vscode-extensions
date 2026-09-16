# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - UI基础设施: 悬浮提示气泡管理器
# 文件路径: res://frontend/ui_infrastructure/tooltip_manager.gd
# 职责: 接管全局 Hover / 长按提示气泡，实现屏幕边缘防碰撞自动翻转 (Flip Algorithm)
# ==============================================================================
class_name TooltipManager
extends Node

const DesignTokens = preload("res://frontend/theme/design_tokens.gd")

signal tooltip_shown(text: String)
signal tooltip_hidden()

static var _instance: TooltipManager
static func get_instance() -> TooltipManager:
	if _instance == null:
		_instance = load("res://frontend/ui_infrastructure/tooltip_manager.gd").new()
		_instance.name = "TooltipManager"
	return _instance

var _layer: CanvasLayer
var _container: Control
var _bubble_panel: PanelContainer
var _lbl_text: Label
var _is_visible: bool = false

func bind_layer(layer: CanvasLayer, container: Control = null) -> void:
	_layer = layer
	_container = container if container != null else _ensure_fallback_container(layer)
	_ensure_bubble()

## 创建/复用 layer 下的缺省承载容器（Control 类型安全，幂等）
func _ensure_fallback_container(layer: CanvasLayer) -> Control:
	if layer == null:
		return null
	var fallback_name := "TooltipManagerFallbackContainer"
	var existing := layer.get_node_or_null(fallback_name)
	if existing is Control:
		return existing
	var fallback := Control.new()
	fallback.name = fallback_name
	fallback.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	fallback.mouse_filter = Control.MOUSE_FILTER_IGNORE
	layer.add_child(fallback)
	return fallback

func _ensure_bubble() -> void:
	if _bubble_panel != null or _container == null:
		return
	_bubble_panel = PanelContainer.new()
	_bubble_panel.name = "TooltipBubble"
	_bubble_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_bubble_panel.visible = false

	var style := StyleBoxFlat.new()
	style.bg_color = DesignTokens.COLOR_SURFACE_CARD
	style.set_corner_radius_all(6)
	style.border_width_bottom = 1
	style.border_width_left = 1
	style.border_width_right = 1
	style.border_width_top = 1
	style.border_color = DesignTokens.COLOR_PRIMARY
	_bubble_panel.add_theme_stylebox_override("panel", style)

	_lbl_text = Label.new()
	_lbl_text.add_theme_font_size_override("font_size", DesignTokens.FONT_SIZE_BODY)
	_lbl_text.add_theme_color_override("font_color", DesignTokens.COLOR_TEXT_PRIMARY)
	_bubble_panel.add_child(_lbl_text)

	_container.add_child(_bubble_panel)

## 核心防碰撞翻转坐标算法
static func calculate_tooltip_pos(target_rect: Rect2, tooltip_size: Vector2, viewport_size: Vector2) -> Vector2:
	var gap: float = 8.0
	var pos := Vector2.ZERO

	# 水平轴：优先右侧，右侧放不下则翻转到左侧
	if target_rect.position.x + target_rect.size.x + gap + tooltip_size.x <= viewport_size.x:
		pos.x = target_rect.position.x + target_rect.size.x + gap
	else:
		pos.x = target_rect.position.x - tooltip_size.x - gap

	# 垂直轴：优先对齐顶端，底部溢出则向上修正
	pos.y = target_rect.position.y
	if pos.y + tooltip_size.y > viewport_size.y:
		pos.y = maxf(0.0, viewport_size.y - tooltip_size.y - gap)

	# 兜底钳制在可视区内
	pos.x = clampf(pos.x, 0.0, maxf(0.0, viewport_size.x - tooltip_size.x))
	pos.y = clampf(pos.y, 0.0, maxf(0.0, viewport_size.y - tooltip_size.y))
	return pos

## 显示悬浮提示
func show_tooltip(target_rect: Rect2, text: String, _extra_data: Dictionary = {}) -> void:
	if _container == null:
		_ensure_bubble()
	if _bubble_panel == null or _lbl_text == null:
		return

	_lbl_text.text = text
	_bubble_panel.visible = true
	_is_visible = true

	var vp_size: Vector2 = _container.get_viewport_rect().size if _container.is_inside_tree() else Vector2(1920, 1080)
	var tip_size: Vector2 = _bubble_panel.get_combined_minimum_size()
	if tip_size.x <= 0:
		tip_size = Vector2(180, 48)

	var calculated_pos := calculate_tooltip_pos(target_rect, tip_size, vp_size)
	# 目标矩形为画布全局坐标，转换为容器本地坐标后赋值，兼容非全屏偏移容器
	_bubble_panel.position = _container.get_global_transform().affine_inverse() * calculated_pos

	tooltip_shown.emit(text)

## 隐藏悬浮提示
func hide_tooltip() -> void:
	if _bubble_panel != null:
		_bubble_panel.visible = false
	_is_visible = false
	tooltip_hidden.emit()

func is_tooltip_visible() -> bool:
	return _is_visible

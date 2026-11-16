# ==============================================================================
# 模块归属: Frontend / UIInfrastructure
# 文件路径: res://frontend/ui_infrastructure/tooltip_manager.gd
# 架构定位: UI 基础设施悬浮提示气泡管理器，实现悬停文案展示与屏幕边缘翻转定位算法
# 依赖与触发: 依赖 DesignTokens 与 ModalManager 容器回退助手，由 AppRoot 绑定并由交互组件触发
# 职责说明: 接管全局 Hover 与长按提示气泡，实现屏幕边缘防碰撞自动翻转算法
# 退出语义与设计依据: 单气泡节点按需惰性构建并复用，隐藏仅切换可见性与状态位，不触发频繁节点销毁
# ==============================================================================
## TooltipManager：全局悬浮提示气泡管理器，提供边缘防碰撞翻转计算与气泡显隐控制
class_name TooltipManager
extends Node

signal tooltip_shown(text: String)
signal tooltip_hidden()

static var _instance: TooltipManager
## 获取悬浮提示气泡管理器全局单例
static func get_instance() -> TooltipManager:
	if _instance == null:
		_instance = TooltipManager.new()
		_instance.name = "TooltipManager"
	return _instance

## 重置悬浮提示管理器静态单例并同步释放气泡面板节点
static func reset_instance() -> void:
	if _instance != null and is_instance_valid(_instance):
		ModalManager.detach_and_free_node(_instance._bubble_panel)
		_instance._bubble_panel = null
		_instance._text_label = null
		_instance._tooltip_container = null
		_instance._target_layer = null
		_instance._is_visible = false
		ModalManager.detach_and_free_node(_instance)
	_instance = null

var _target_layer: CanvasLayer
var _tooltip_container: Control
var _bubble_panel: PanelContainer
var _text_label: Label
var _is_visible: bool = false

## 绑定气泡宿主的 CanvasLayer 与容器节点并预构建气泡面板
func bind_layer(target_layer: CanvasLayer, target_container: Control = null) -> void:
	_target_layer = target_layer
	_tooltip_container = target_container if target_container != null else ModalManager.ensure_fallback_container(target_layer, "TooltipManagerFallbackContainer")
	_ensure_bubble()

func _ensure_bubble() -> void:
	if _tooltip_container == null or not is_instance_valid(_tooltip_container):
		return
	if _bubble_panel != null and is_instance_valid(_bubble_panel) and _bubble_panel.get_parent() == _tooltip_container:
		return
	ModalManager.detach_and_free_node(_bubble_panel)
	_bubble_panel = null
	_text_label = null
	_bubble_panel = PanelContainer.new()
	_bubble_panel.name = "TooltipBubble"
	_bubble_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_bubble_panel.visible = false

	var bubble_style := StyleBoxFlat.new()
	bubble_style.bg_color = DesignTokens.COLOR_SURFACE_CARD
	bubble_style.set_corner_radius_all(6)
	bubble_style.border_width_bottom = 1
	bubble_style.border_width_left = 1
	bubble_style.border_width_right = 1
	bubble_style.border_width_top = 1
	bubble_style.border_color = DesignTokens.COLOR_PRIMARY
	_bubble_panel.add_theme_stylebox_override("panel", bubble_style)

	_text_label = Label.new()
	_text_label.add_theme_font_size_override("font_size", DesignTokens.FONT_SIZE_BODY)
	_text_label.add_theme_color_override("font_color", DesignTokens.COLOR_TEXT_PRIMARY)
	_bubble_panel.add_child(_text_label)

	_tooltip_container.add_child(_bubble_panel)

## 核心防碰撞翻转坐标算法
static func calculate_tooltip_pos(target_bounds: Rect2, tooltip_size: Vector2, viewport_size: Vector2) -> Vector2:
	var margin_gap: float = 8.0
	var tooltip_position := Vector2.ZERO

	# 水平轴：优先右侧，右侧放不下则翻转到左侧
	if target_bounds.position.x + target_bounds.size.x + margin_gap + tooltip_size.x <= viewport_size.x:
		tooltip_position.x = target_bounds.position.x + target_bounds.size.x + margin_gap
	else:
		tooltip_position.x = target_bounds.position.x - tooltip_size.x - margin_gap

	# 垂直轴：优先对齐顶端，底部溢出则向上修正
	tooltip_position.y = target_bounds.position.y
	if tooltip_position.y + tooltip_size.y > viewport_size.y:
		tooltip_position.y = maxf(0.0, viewport_size.y - tooltip_size.y - margin_gap)

	# 安全回退钳制在可视区内
	tooltip_position.x = clampf(tooltip_position.x, 0.0, maxf(0.0, viewport_size.x - tooltip_size.x))
	tooltip_position.y = clampf(tooltip_position.y, 0.0, maxf(0.0, viewport_size.y - tooltip_size.y))
	return tooltip_position

## 显示悬浮提示
func show_tooltip(target_bounds: Rect2, tooltip_text_content: String, _extra_metadata: Dictionary = {}) -> void:
	if _tooltip_container == null:
		_ensure_bubble()
	if _bubble_panel == null or _text_label == null:
		return

	_text_label.text = tooltip_text_content
	_bubble_panel.visible = true
	_is_visible = true

	var viewport_size: Vector2 = _tooltip_container.get_viewport_rect().size if _tooltip_container.is_inside_tree() else Vector2(1920, 1080)
	var tooltip_size: Vector2 = _bubble_panel.get_combined_minimum_size()
	if tooltip_size.x <= 0:
		tooltip_size = Vector2(180, 48)

	var calculated_position := calculate_tooltip_pos(target_bounds, tooltip_size, viewport_size)
	# 目标矩形为画布全局坐标，转换为容器本地坐标后赋值，兼容非全屏偏移容器
	_bubble_panel.position = _tooltip_container.get_global_transform().affine_inverse() * calculated_position

	tooltip_shown.emit(tooltip_text_content)

## 隐藏悬浮提示
func hide_tooltip() -> void:
	if _bubble_panel != null:
		_bubble_panel.visible = false
	_is_visible = false
	tooltip_hidden.emit()

## 查询悬浮提示气泡当前是否可见
func is_tooltip_visible() -> bool:
	return _is_visible

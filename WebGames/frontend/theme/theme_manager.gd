# ==============================================================================
# 模块归属: Frontend / Theme
# 文件路径: res://frontend/theme/theme_manager.gd
# 架构定位: 前端主题管理器，运行时从配置加载事件分类色并装配全局 Godot Theme 资源
# 依赖与触发: 依赖 DesignTokens 与 GameConfig，由 AppBootstrap 初始化并供视图与组件查询
# 职责说明: 运行时从 event_categories.json 生成 Godot Theme 资源，保持配色字号与间距配置驱动
# 退出语义与设计依据: 单例常驻内存并在配置加载缺失时安全回退默认语义色；不持有场景树节点引用
# ==============================================================================
## ThemeManager：前端主题令牌管理器，负责构建全局 Theme 资源并提供事件分类配色查询
class_name ThemeManager
extends RefCounted

const DesignTokens = preload("res://frontend/theme/design_tokens.gd")

static var _instance: ThemeManager
## 获取主题管理器全局单例并确保默认 Theme 已完成初始化
static func get_instance() -> ThemeManager:
	if _instance == null:
		_instance = ThemeManager.new()
		_instance._init_theme()
	return _instance

var theme: Theme

## 配色令牌（从 event_categories.json 动态注入）
var category_colors: Dictionary = {}  # { "combat": Color, "travel": Color, ... }

## 基础颜色令牌（单一真源：值全部派生自 DesignTokens，本类不再复写字面量；
## 保留 DEFAULT_* 常量名仅为兼容既有内部调用面，外部消费方应直接引用 DesignTokens.*）
const DEFAULT_BG := DesignTokens.COLOR_BG_DEFAULT
const DEFAULT_SURFACE := DesignTokens.COLOR_SURFACE_DEFAULT
const DEFAULT_BORDER := DesignTokens.COLOR_BORDER_DEFAULT
const DEFAULT_TEXT := DesignTokens.COLOR_TEXT_DEFAULT
const DEFAULT_TEXT_MUTED := DesignTokens.COLOR_TEXT_MUTED_DEFAULT
const DEFAULT_ACCENT := DesignTokens.COLOR_ACCENT_DEFAULT
const DEFAULT_SUCCESS := DesignTokens.COLOR_SUCCESS_DEFAULT
const DEFAULT_WARNING := DesignTokens.COLOR_WARNING_DEFAULT
const DEFAULT_DANGER := DesignTokens.COLOR_DANGER_DEFAULT

func _init_theme() -> void:
	theme = Theme.new()
	_load_category_colors()
	_setup_base_styles()

## 从 event_categories.json 加载分类配色
## 新增分类只需加配置行，前端零改动
func _load_category_colors() -> void:
	var categories := GameConfig.get_dict("infrastructure.event_categories", "", {})
	for key in categories:
		var entry: Dictionary = categories[key]
		var category_name: String = str(entry.get("name", key))
		var hex_color: String = str(entry.get("color", "#94a3b8"))
		category_colors[category_name.to_upper()] = Color.html(hex_color)

## 获取指定分类的颜色，未命中回退默认色
func get_category_color(category_key: String) -> Color:
	var upper := category_key.to_upper()
	if category_colors.has(upper):
		return category_colors[upper]
	return DEFAULT_TEXT_MUTED

## 设置基础样式（Control 基类通用）
func _setup_base_styles() -> void:
	# Button 样式
	var button_style := StyleBoxFlat.new()
	button_style.bg_color = DEFAULT_SURFACE
	button_style.border_color = DEFAULT_BORDER
	button_style.border_width_left = 1
	button_style.border_width_right = 1
	button_style.border_width_top = 1
	button_style.border_width_bottom = 1
	button_style.corner_radius_top_left = 6
	button_style.corner_radius_top_right = 6
	button_style.corner_radius_bottom_left = 6
	button_style.corner_radius_bottom_right = 6
	theme.set_stylebox("normal", "Button", button_style)

	# Button hover
	var button_hover := button_style.duplicate()
	button_hover.bg_color = DEFAULT_BORDER
	theme.set_stylebox("hover", "Button", button_hover)

	# Button pressed（按下态色引用 DesignTokens，消除裸 Color 字面量）
	var button_pressed := button_style.duplicate()
	button_pressed.bg_color = DesignTokens.COLOR_BUTTON_PRESSED
	theme.set_stylebox("pressed", "Button", button_pressed)

	# Label 基础字体颜色
	theme.set_color("font_color", "Label", DEFAULT_TEXT)
	theme.set_color("font_uneditable_color", "LineEdit", DEFAULT_TEXT_MUTED)

	# Panel 样式
	var panel_style := StyleBoxFlat.new()
	panel_style.bg_color = DEFAULT_SURFACE
	panel_style.border_color = DEFAULT_BORDER
	panel_style.border_width_left = 1
	panel_style.border_width_right = 1
	panel_style.border_width_top = 1
	panel_style.border_width_bottom = 1
	panel_style.corner_radius_top_left = 8
	panel_style.corner_radius_top_right = 8
	panel_style.corner_radius_bottom_left = 8
	panel_style.corner_radius_bottom_right = 8
	theme.set_stylebox("panel", "PanelContainer", panel_style)

	# ProgressBar
	theme.set_color("font_color", "ProgressBar", DEFAULT_TEXT)

	# TabContainer
	theme.set_color("font_selected_color", "TabContainer", DEFAULT_ACCENT)
	theme.set_color("font_color", "TabContainer", DEFAULT_TEXT_MUTED)

## 便捷方法：获取 bbcode 用的颜色标签（用于 RichTextLabel）
func get_bbcode_color_tag(category_key: String) -> String:
	var category_color := get_category_color(category_key)
	return "[color=#%s]" % category_color.to_html(false)

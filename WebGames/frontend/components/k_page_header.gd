# ==============================================================================
# 模块归属: 前端通用组件层 (Frontend · Reusable UI Components)
# 文件路径: res://frontend/components/k_page_header.gd
# 架构定位: Reusable Atomic Component (KPageHeader)
# 依赖与触发: 上游: 顶级页面视图控制器 | 下游: DesignTokens, KBackButton, UIIntermediary
# 职责说明: 统一渲染页面顶部标题栏（返回按钮、图标与 i18n 驱动的主/副标题），由宿主控制导航回退。
# 退出语义与设计依据: 表现层通用页眉组件化与信号透传解耦契约
# ==============================================================================

## KPageHeader：通用页面顶部标题栏组件
class_name KPageHeader
extends Control

signal back_pressed()

@export var title_key: String = "":
	set(value):
		title_key = value
		_apply_text()
@export var subtitle_key: String = "":
	set(value):
		subtitle_key = value
		_apply_text()
@export var show_back_button: bool = true
@export var icon_texture: Texture2D = null

var _back_button: KBackButton = null
var _title_label: Label = null
var _subtitle_label: Label = null

func _ready() -> void:
	_setup_ui()
	_apply_text()

func _setup_ui() -> void:
	# 背景面板 + 底部分割线
	var background_panel := PanelContainer.new()
	background_panel.name = "Background"
	background_panel.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	background_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var background_style := StyleBoxFlat.new()
	background_style.bg_color = DesignTokens.COLOR_SURFACE_PANEL
	background_style.border_color = DesignTokens.COLOR_BORDER_DEFAULT
	background_style.border_width_bottom = 1
	background_panel.add_theme_stylebox_override("panel", background_style)
	add_child(background_panel)

	# 内边距容器
	var content_margin := MarginContainer.new()
	content_margin.add_theme_constant_override("margin_left", DesignTokens.SPACING_MD)
	content_margin.add_theme_constant_override("margin_right", DesignTokens.SPACING_MD)
	content_margin.add_theme_constant_override("margin_top", DesignTokens.SPACING_SM)
	content_margin.add_theme_constant_override("margin_bottom", DesignTokens.SPACING_SM)
	content_margin.mouse_filter = Control.MOUSE_FILTER_IGNORE
	background_panel.add_child(content_margin)

	# 水平布局：返回按钮 + 图标 + 标题区
	var header_row := HBoxContainer.new()
	header_row.add_theme_constant_override("separation", DesignTokens.SPACING_MD)
	header_row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	content_margin.add_child(header_row)

	# 返回按钮（禁用自动 pop，由本组件透传信号交由宿主决定导航）
	if show_back_button:
		_back_button = KBackButton.new()
		_back_button.auto_pop = false
		_back_button.back_pressed.connect(_on_back_pressed)
		header_row.add_child(_back_button)

	# 可选图标
	if icon_texture != null:
		var icon_texture_rect := TextureRect.new()
		icon_texture_rect.texture = icon_texture
		icon_texture_rect.expand_mode = TextureRect.EXPAND_FIT_WIDTH_PROPORTIONAL
		icon_texture_rect.custom_minimum_size = Vector2(DesignTokens.SPACING_XL, DesignTokens.SPACING_XL)
		icon_texture_rect.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		icon_texture_rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
		header_row.add_child(icon_texture_rect)

	# 标题 / 副标题竖直布局
	var header_column := VBoxContainer.new()
	header_column.add_theme_constant_override("separation", DesignTokens.SPACING_XS)
	header_column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	header_column.mouse_filter = Control.MOUSE_FILTER_IGNORE
	header_row.add_child(header_column)

	_title_label = Label.new()
	_title_label.add_theme_font_size_override("font_size", DesignTokens.FONT_SIZE_HEADLINE)
	_title_label.add_theme_color_override("font_color", DesignTokens.COLOR_TEXT_PRIMARY)
	_title_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	header_column.add_child(_title_label)

	_subtitle_label = Label.new()
	_subtitle_label.add_theme_font_size_override("font_size", DesignTokens.FONT_SIZE_BODY)
	_subtitle_label.add_theme_color_override("font_color", DesignTokens.COLOR_TEXT_SECONDARY)
	_subtitle_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	header_column.add_child(_subtitle_label)

func _apply_text() -> void:
	if _title_label != null and not title_key.is_empty():
		UIIntermediary.resolve(_title_label, title_key)
	if _subtitle_label != null and not subtitle_key.is_empty():
		UIIntermediary.resolve(_subtitle_label, subtitle_key)

func _on_back_pressed() -> void:
	back_pressed.emit()

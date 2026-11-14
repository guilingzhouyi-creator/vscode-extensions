# ==============================================================================
# 模块归属: 前端通用组件层 (Frontend · Reusable UI Components)
# 文件路径: res://frontend/components/k_currency_bar.gd
# 架构定位: Reusable Atomic Component (KCurrencyBar)
# 依赖与触发: 上游: HUD 与商店交易界面 | 下游: DesignTokens, PlaceholderFiller
# 职责说明: 统一封装金/银/铜/水晶多货币图标与千分位数值的横向展示，纯渲染无业务逻辑。
# 退出语义与设计依据: 表现层纯展示零业务运算契约
# ==============================================================================

## KCurrencyBar：多货币横向展示条组件
class_name KCurrencyBar
extends Control

const DesignTokens = preload("res://frontend/theme/design_tokens.gd")

@export var show_gold: bool = true
@export var show_silver: bool = true
@export var show_copper: bool = true
@export var show_crystals: bool = false
@export var icon_size: int = 16

@export var gold_icon: Texture2D = null
@export var silver_icon: Texture2D = null
@export var copper_icon: Texture2D = null
@export var crystals_icon: Texture2D = null

var _hbox: HBoxContainer
var _gold_label: Label
var _silver_label: Label
var _copper_label: Label
var _crystals_label: Label

func _ready() -> void:
	mouse_filter = MOUSE_FILTER_IGNORE

	_hbox = HBoxContainer.new()
	_hbox.set_anchors_and_offsets_preset(PRESET_FULL_RECT)
	_hbox.add_theme_constant_override("separation", DesignTokens.SPACING_SM)
	add_child(_hbox)

	if show_gold:
		_gold_label = _build_currency_group(gold_icon, DesignTokens.COLOR_ACCENT_GOLD)
	if show_silver:
		_silver_label = _build_currency_group(silver_icon, DesignTokens.COLOR_TEXT_SECONDARY)
	if show_copper:
		_copper_label = _build_currency_group(copper_icon, DesignTokens.COLOR_TEXT_MUTED)
	if show_crystals:
		_crystals_label = _build_currency_group(crystals_icon, DesignTokens.COLOR_INFO)

func _build_currency_group(icon: Texture2D, text_color: Color) -> Label:
	var icon_rect := TextureRect.new()
	icon_rect.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	icon_rect.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	icon_rect.custom_minimum_size = Vector2(icon_size, icon_size)
	icon_rect.texture = icon
	icon_rect.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	icon_rect.mouse_filter = MOUSE_FILTER_IGNORE
	_hbox.add_child(icon_rect)

	var label := Label.new()
	label.add_theme_font_size_override("font_size", DesignTokens.FONT_SIZE_BODY)
	label.add_theme_color_override("font_color", text_color)
	label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	label.mouse_filter = MOUSE_FILTER_IGNORE
	_hbox.add_child(label)
	return label

## 批量刷新金/银/铜/水晶四种货币显示数值
func set_currency(gold: int, silver: int, copper: int, crystals: int = 0) -> void:
	set_gold(gold)
	set_silver(silver)
	set_copper(copper)
	set_crystals(crystals)

## 更新金币显示数值（自动应用千分位格式化）
func set_gold(amount: int) -> void:
	if _gold_label != null:
		_gold_label.text = PlaceholderFiller.format_thousands(amount)

## 更新银币显示数值
func set_silver(amount: int) -> void:
	if _silver_label != null:
		_silver_label.text = str(amount)

## 更新铜币显示数值
func set_copper(amount: int) -> void:
	if _copper_label != null:
		_copper_label.text = str(amount)

## 更新水晶显示数值（自动应用千分位格式化）
func set_crystals(amount: int) -> void:
	if _crystals_label != null:
		_crystals_label.text = PlaceholderFiller.format_thousands(amount)

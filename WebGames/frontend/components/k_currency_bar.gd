# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端通用组件: 货币显示条 (KCurrencyBar)
# 文件路径: res://frontend/components/k_currency_bar.gd
# 职责: 统一封装金/银/铜/水晶多货币图标+数值的横向展示，纯渲染无业务逻辑
# ==============================================================================
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
var _lbl_gold: Label
var _lbl_silver: Label
var _lbl_copper: Label
var _lbl_crystals: Label

func _ready() -> void:
	mouse_filter = MOUSE_FILTER_IGNORE

	_hbox = HBoxContainer.new()
	_hbox.set_anchors_and_offsets_preset(PRESET_FULL_RECT)
	_hbox.add_theme_constant_override("separation", DesignTokens.SPACING_SM)
	add_child(_hbox)

	if show_gold:
		_lbl_gold = _build_currency_group(gold_icon, DesignTokens.COLOR_ACCENT_GOLD)
	if show_silver:
		_lbl_silver = _build_currency_group(silver_icon, DesignTokens.COLOR_TEXT_SECONDARY)
	if show_copper:
		_lbl_copper = _build_currency_group(copper_icon, DesignTokens.COLOR_TEXT_MUTED)
	if show_crystals:
		_lbl_crystals = _build_currency_group(crystals_icon, DesignTokens.COLOR_INFO)

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

func set_currency(gold: int, silver: int, copper: int, crystals: int = 0) -> void:
	set_gold(gold)
	set_silver(silver)
	set_copper(copper)
	set_crystals(crystals)

func set_gold(val: int) -> void:
	if _lbl_gold != null:
		_lbl_gold.text = _format_thousands(val)

func set_silver(val: int) -> void:
	if _lbl_silver != null:
		_lbl_silver.text = str(val)

func set_copper(val: int) -> void:
	if _lbl_copper != null:
		_lbl_copper.text = str(val)

func set_crystals(val: int) -> void:
	if _lbl_crystals != null:
		_lbl_crystals.text = _format_thousands(val)

func _format_thousands(value: int) -> String:
	var s := str(abs(value))
	var result := ""
	var count := 0
	for i in range(s.length() - 1, -1, -1):
		if count > 0 and count % 3 == 0:
			result = "," + result
		result = s[i] + result
		count += 1
	if value < 0:
		result = "-" + result
	return result

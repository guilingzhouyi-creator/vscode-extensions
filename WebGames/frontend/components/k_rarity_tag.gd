# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端通用组件: 稀有度标签 (KRarityTag)
# 文件路径: res://frontend/components/k_rarity_tag.gd
# 职责: 统一封装稀有度色块与文字标签，按品质等级自动映射颜色与 i18n 文案
# ==============================================================================
class_name KRarityTag
extends Control

const DesignTokens = preload("res://frontend/theme/design_tokens.gd")

@export var rarity_level: int = 1
@export var show_label: bool = true
@export var compact: bool = false

var _hbox: HBoxContainer
var _color_rect: ColorRect
var _lbl_name: Label

static func get_rarity_color(level: int) -> Color:
	match level:
		1: return DesignTokens.COLOR_QUALITY_COMMON
		2: return DesignTokens.COLOR_QUALITY_UNCOMMON
		3: return DesignTokens.COLOR_QUALITY_RARE
		4: return DesignTokens.COLOR_QUALITY_EPIC
		5: return DesignTokens.COLOR_QUALITY_LEGENDARY
		_: return DesignTokens.COLOR_QUALITY_COMMON

static func get_rarity_name_key(level: int) -> String:
	match level:
		1: return "ui.rarity.common"
		2: return "ui.rarity.uncommon"
		3: return "ui.rarity.rare"
		4: return "ui.rarity.epic"
		5: return "ui.rarity.legendary"
		_: return "ui.rarity.common"

func _ready() -> void:
	mouse_filter = MOUSE_FILTER_IGNORE
	custom_minimum_size = Vector2(32, 20) if compact else Vector2(60, 24)

	_hbox = HBoxContainer.new()
	_hbox.set_anchors_and_offsets_preset(PRESET_FULL_RECT)
	_hbox.add_theme_constant_override("separation", DesignTokens.SPACING_XS)
	_hbox.add_theme_constant_override("margin_left", DesignTokens.SPACING_XS)
	_hbox.add_theme_constant_override("margin_right", DesignTokens.SPACING_XS)
	add_child(_hbox)

	if not compact:
		var bg := PanelContainer.new()
		bg.set_anchors_and_offsets_preset(PRESET_FULL_RECT)
		bg.mouse_filter = MOUSE_FILTER_IGNORE
		var style := StyleBoxFlat.new()
		style.bg_color = DesignTokens.COLOR_SURFACE_CARD
		style.set_border_width_all(1)
		style.border_color = DesignTokens.COLOR_BORDER_DEFAULT
		style.set_corner_radius_all(3)
		bg.add_theme_stylebox_override("panel", style)
		add_child(bg)
		move_child(bg, 0)

	_color_rect = ColorRect.new()
	_color_rect.custom_minimum_size = Vector2(12, 12) if compact else Vector2(14, 14)
	_color_rect.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_color_rect.mouse_filter = MOUSE_FILTER_IGNORE
	_hbox.add_child(_color_rect)

	_lbl_name = Label.new()
	_lbl_name.add_theme_font_size_override("font_size", DesignTokens.FONT_SIZE_CAPTION)
	_lbl_name.add_theme_color_override("font_color", DesignTokens.COLOR_TEXT_PRIMARY)
	_lbl_name.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_lbl_name.mouse_filter = MOUSE_FILTER_IGNORE
	_lbl_name.visible = show_label
	_hbox.add_child(_lbl_name)

	_apply_rarity()

func _apply_rarity() -> void:
	var color := get_rarity_color(rarity_level)
	if _color_rect != null:
		_color_rect.color = color
	if _lbl_name != null and show_label:
		_lbl_name.text = UIIntermediary.text(get_rarity_name_key(rarity_level))

func set_rarity(level: int) -> void:
	rarity_level = clampi(level, 1, 5)
	_apply_rarity()

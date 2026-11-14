# ==============================================================================
# 模块归属: 前端通用组件层 (Frontend · Reusable UI Components)
# 文件路径: res://frontend/components/k_rarity_tag.gd
# 架构定位: Reusable Atomic Component (KRarityTag)
# 依赖与触发: 上游: 道具详情、抽卡与图鉴界面 | 下游: DesignTokens, UIIntermediary
# 职责说明: 统一封装稀有度色块与文字标签，按品质等级自动映射色彩令牌与 i18n 文案。
# 退出语义与设计依据: 品质色阶单一真源映射契约
# ==============================================================================

## KRarityTag：物品与角色稀有度等级标签组件
class_name KRarityTag
extends Control

const DesignTokens = preload("res://frontend/theme/design_tokens.gd")

@export var rarity_level: int = 1
@export var show_label: bool = true
@export var compact: bool = false

var _tag_row: HBoxContainer
var _rarity_color_rect: ColorRect
var _name_label: Label

## 根据品质等级（1~5）映射对应稀有度语义颜色，越界回退至普通品质颜色
static func get_rarity_color(level: int) -> Color:
	match level:
		1: return DesignTokens.COLOR_QUALITY_COMMON
		2: return DesignTokens.COLOR_QUALITY_UNCOMMON
		3: return DesignTokens.COLOR_QUALITY_RARE
		4: return DesignTokens.COLOR_QUALITY_EPIC
		5: return DesignTokens.COLOR_QUALITY_LEGENDARY
		_: return DesignTokens.COLOR_QUALITY_COMMON

## 根据品质等级（1~5）映射对应国际化词库键名
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

	_tag_row = HBoxContainer.new()
	_tag_row.set_anchors_and_offsets_preset(PRESET_FULL_RECT)
	_tag_row.add_theme_constant_override("separation", DesignTokens.SPACING_XS)
	_tag_row.add_theme_constant_override("margin_left", DesignTokens.SPACING_XS)
	_tag_row.add_theme_constant_override("margin_right", DesignTokens.SPACING_XS)
	add_child(_tag_row)

	if not compact:
		var background_panel := PanelContainer.new()
		background_panel.set_anchors_and_offsets_preset(PRESET_FULL_RECT)
		background_panel.mouse_filter = MOUSE_FILTER_IGNORE
		var background_style := StyleBoxFlat.new()
		background_style.bg_color = DesignTokens.COLOR_SURFACE_CARD
		background_style.set_border_width_all(1)
		background_style.border_color = DesignTokens.COLOR_BORDER_DEFAULT
		background_style.set_corner_radius_all(3)
		background_panel.add_theme_stylebox_override("panel", background_style)
		add_child(background_panel)
		move_child(background_panel, 0)

	_rarity_color_rect = ColorRect.new()
	_rarity_color_rect.custom_minimum_size = Vector2(12, 12) if compact else Vector2(14, 14)
	_rarity_color_rect.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_rarity_color_rect.mouse_filter = MOUSE_FILTER_IGNORE
	_tag_row.add_child(_rarity_color_rect)

	_name_label = Label.new()
	_name_label.add_theme_font_size_override("font_size", DesignTokens.FONT_SIZE_CAPTION)
	_name_label.add_theme_color_override("font_color", DesignTokens.COLOR_TEXT_PRIMARY)
	_name_label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_name_label.mouse_filter = MOUSE_FILTER_IGNORE
	_name_label.visible = show_label
	_tag_row.add_child(_name_label)

	_apply_rarity()

func _apply_rarity() -> void:
	var rarity_color := get_rarity_color(rarity_level)
	if _rarity_color_rect != null:
		_rarity_color_rect.color = rarity_color
	if _name_label != null and show_label:
		_name_label.text = UIIntermediary.text(get_rarity_name_key(rarity_level))

## 设置并钳制稀有度等级（[1, 5]），同步刷新色块与文案
func set_rarity(level: int) -> void:
	rarity_level = clampi(level, 1, 5)
	_apply_rarity()

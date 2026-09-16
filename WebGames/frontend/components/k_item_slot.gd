# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端通用组件: 标准物品插槽格子 (KItemSlot)
# 文件路径: res://frontend/components/k_item_slot.gd
# 职责: 封装道具图标、品质边框色阶、叠加数量与 TooltipManager 悬浮绑定
# ==============================================================================
class_name KItemSlot
extends Control

const DesignTokens = preload("res://frontend/theme/design_tokens.gd")
const TooltipManager = preload("res://frontend/ui_infrastructure/tooltip_manager.gd")

signal slot_clicked(item_id: String)
signal slot_right_clicked(item_id: String)

@export var item_id: String = ""
@export var item_name: String = ""
@export var item_desc: String = ""
@export var rarity_level: int = 1 # 1: Common, 2: Uncommon, 3: Rare, 4: Epic, 5: Legendary
@export var count: int = 1
@export var caption: String = "":
	set(val):
		caption = val
		if _lbl_caption != null:
			_lbl_caption.text = caption

var _border_panel: PanelContainer
var _lbl_count: Label
var _lbl_caption: Label
var _icon_rect: TextureRect

func _ready() -> void:
	if custom_minimum_size == Vector2.ZERO:
		custom_minimum_size = Vector2(48, 48)
	mouse_filter = MOUSE_FILTER_STOP
	_setup_ui()
	_update_visuals()

	mouse_entered.connect(_on_mouse_entered)
	mouse_exited.connect(_on_mouse_exited)
	gui_input.connect(_on_gui_input)

func _setup_ui() -> void:
	_border_panel = PanelContainer.new()
	_border_panel.set_anchors_and_offsets_preset(PRESET_FULL_RECT)
	_border_panel.mouse_filter = MOUSE_FILTER_IGNORE
	add_child(_border_panel)

	_icon_rect = TextureRect.new()
	_icon_rect.set_anchors_and_offsets_preset(PRESET_FULL_RECT)
	_icon_rect.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_icon_rect.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	_icon_rect.mouse_filter = MOUSE_FILTER_IGNORE
	add_child(_icon_rect)

	_lbl_count = Label.new()
	_lbl_count.set_anchors_and_offsets_preset(PRESET_TOP_RIGHT)
	_lbl_count.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_lbl_count.add_theme_font_size_override("font_size", DesignTokens.FONT_SIZE_CAPTION)
	_lbl_count.add_theme_color_override("font_color", DesignTokens.COLOR_TEXT_PRIMARY)
	_lbl_count.mouse_filter = MOUSE_FILTER_IGNORE
	add_child(_lbl_count)

	_lbl_caption = Label.new()
	_lbl_caption.set_anchors_and_offsets_preset(PRESET_BOTTOM_WIDE)
	_lbl_caption.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_lbl_caption.clip_text = true
	_lbl_caption.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	_lbl_caption.add_theme_font_size_override("font_size", DesignTokens.FONT_SIZE_CAPTION)
	_lbl_caption.add_theme_color_override("font_color", DesignTokens.COLOR_TEXT_SECONDARY)
	_lbl_caption.mouse_filter = MOUSE_FILTER_IGNORE
	add_child(_lbl_caption)

func _update_visuals() -> void:
	if _border_panel == null:
		return

	var style := StyleBoxFlat.new()
	style.bg_color = DesignTokens.COLOR_SURFACE_CARD
	style.set_corner_radius_all(4)
	style.border_width_bottom = 2
	style.border_width_left = 2
	style.border_width_right = 2
	style.border_width_top = 2

	match rarity_level:
		1: style.border_color = DesignTokens.COLOR_QUALITY_COMMON
		2: style.border_color = DesignTokens.COLOR_QUALITY_UNCOMMON
		3: style.border_color = DesignTokens.COLOR_QUALITY_RARE
		4: style.border_color = DesignTokens.COLOR_QUALITY_EPIC
		5: style.border_color = DesignTokens.COLOR_QUALITY_LEGENDARY
		_: style.border_color = DesignTokens.COLOR_QUALITY_COMMON

	_border_panel.add_theme_stylebox_override("panel", style)

	if _lbl_count != null:
		_lbl_count.text = str(count) if count > 1 else ""
	if _lbl_caption != null:
		_lbl_caption.text = caption

func set_item_data(p_id: String, p_name: String, p_desc: String, p_rarity: int, p_count: int) -> void:
	item_id = p_id
	item_name = p_name
	item_desc = p_desc
	rarity_level = p_rarity
	count = p_count
	_update_visuals()

func _on_mouse_entered() -> void:
	if not item_name.is_empty():
		var tip_text := "%s\n%s" % [item_name, item_desc]
		TooltipManager.get_instance().show_tooltip(get_global_rect(), tip_text)

func _on_mouse_exited() -> void:
	TooltipManager.get_instance().hide_tooltip()

func _on_gui_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed:
		if event.button_index == MOUSE_BUTTON_LEFT:
			slot_clicked.emit(item_id)
		elif event.button_index == MOUSE_BUTTON_RIGHT:
			slot_right_clicked.emit(item_id)

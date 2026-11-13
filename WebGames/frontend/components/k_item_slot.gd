# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端通用组件: 标准物品插槽格子 (KItemSlot)
# 文件路径: res://frontend/components/k_item_slot.gd
# 职责: 封装道具图标、品质边框色阶、叠加数量与 TooltipManager 悬浮绑定
# ==============================================================================
class_name KItemSlot
extends Control

const DesignTokens = preload("res://frontend/theme/design_tokens.gd")
const TooltipManager = preload("res://frontend/ui_infrastructure/tooltip_manager.gd")
const UIIntermediary = preload("res://frontend/i18n/ui_intermediary.gd")

signal slot_clicked(item_id: String)
signal slot_right_clicked(item_id: String)

@export var item_id: String = ""
@export var item_name: String = ""
@export var item_desc: String = ""
@export var item_name_key: String = "" # i18n key，优先于 item_name
@export var item_desc_key: String = "" # i18n key，优先于 item_desc
@export var rarity_level: int = 1 # 1: Common, 2: Uncommon, 3: Rare, 4: Epic, 5: Legendary
@export var count: int = 1
@export var caption: String = "":
	set(val):
		caption = val
		if _lbl_caption != null and is_instance_valid(_lbl_caption):
			_lbl_caption.text = caption

@export var selected: bool = false:
	set(val):
		selected = val
		_update_visuals()

@export var locked: bool = false:
	set(val):
		locked = val
		_update_visuals()

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

	if not mouse_entered.is_connected(_on_mouse_entered):
		mouse_entered.connect(_on_mouse_entered)
	if not mouse_exited.is_connected(_on_mouse_exited):
		mouse_exited.connect(_on_mouse_exited)
	if not gui_input.is_connected(_on_gui_input):
		gui_input.connect(_on_gui_input)

func _exit_tree() -> void:
	if mouse_entered.is_connected(_on_mouse_entered):
		mouse_entered.disconnect(_on_mouse_entered)
	if mouse_exited.is_connected(_on_mouse_exited):
		mouse_exited.disconnect(_on_mouse_exited)
	if gui_input.is_connected(_on_gui_input):
		gui_input.disconnect(_on_gui_input)

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

static var _cached_panel_styles: Dictionary = {}

static func _get_slot_style(p_rarity: int, is_locked: bool, is_selected: bool) -> StyleBoxFlat:
	var norm_rarity: int = p_rarity if (p_rarity >= 1 and p_rarity <= 5) else 1
	var cache_key: int = norm_rarity | (8 if is_locked else 0) | (16 if is_selected else 0)
	if _cached_panel_styles.has(cache_key):
		return _cached_panel_styles[cache_key] as StyleBoxFlat
	var style := StyleBoxFlat.new()
	style.bg_color = DesignTokens.COLOR_SURFACE_CARD
	style.set_corner_radius_all(4)
	style.set_border_width_all(3 if is_selected else 2)
	if is_selected:
		style.border_color = DesignTokens.COLOR_ACCENT_GOLD
	elif is_locked:
		style.border_color = DesignTokens.COLOR_TEXT_DISABLED
	else:
		match norm_rarity:
			1: style.border_color = DesignTokens.COLOR_QUALITY_COMMON
			2: style.border_color = DesignTokens.COLOR_QUALITY_UNCOMMON
			3: style.border_color = DesignTokens.COLOR_QUALITY_RARE
			4: style.border_color = DesignTokens.COLOR_QUALITY_EPIC
			5: style.border_color = DesignTokens.COLOR_QUALITY_LEGENDARY
			_: style.border_color = DesignTokens.COLOR_QUALITY_COMMON
	_cached_panel_styles[cache_key] = style
	return style

func _update_visuals() -> void:
	if _border_panel == null:
		return

	modulate.a = 0.5 if locked else 1.0
	_border_panel.add_theme_stylebox_override("panel", _get_slot_style(rarity_level, locked, selected))

	if _lbl_count != null:
		_lbl_count.text = str(count) if count > 1 else ""
	if _lbl_caption != null and is_instance_valid(_lbl_caption):
		_lbl_caption.text = caption

## 池化复用清态契约：重置物品槽状态，杜绝跨复用残留
func reset_state() -> void:
	item_id = ""
	item_name = ""
	item_desc = ""
	item_name_key = ""
	item_desc_key = ""
	rarity_level = 1
	count = 1
	caption = ""
	selected = false
	locked = false
	tooltip_text = ""
	modulate = Color.WHITE
	if _icon_rect != null and is_instance_valid(_icon_rect):
		_icon_rect.texture = null
	_update_visuals()

func set_item_data(p_id: String, p_name: String, p_desc: String, p_rarity: int, p_count: int) -> void:
	item_id = p_id
	item_name = p_name
	item_desc = p_desc
	rarity_level = p_rarity
	count = p_count
	_update_visuals()

func set_selected(val: bool) -> void:
	selected = val

func set_locked(val: bool) -> void:
	locked = val

func _get_display_name() -> String:
	if not item_name_key.is_empty():
		return UIIntermediary.text(item_name_key)
	return item_name

func _get_display_desc() -> String:
	if not item_desc_key.is_empty():
		return UIIntermediary.text(item_desc_key)
	return item_desc

func _on_mouse_entered() -> void:
	var display_name := _get_display_name()
	if not display_name.is_empty():
		var tip_text := "%s\n%s" % [display_name, _get_display_desc()]
		TooltipManager.get_instance().show_tooltip(get_global_rect(), tip_text)
	if selected:
		modulate = DesignTokens.COLOR_SELECTED_MODULATE

func _on_mouse_exited() -> void:
	TooltipManager.get_instance().hide_tooltip()
	modulate = DesignTokens.COLOR_LOCKED_MODULATE if locked else Color.WHITE

func _on_gui_input(event: InputEvent) -> void:
	if locked:
		return
	if event is InputEventMouseButton and event.pressed:
		if event.button_index == MOUSE_BUTTON_LEFT:
			slot_clicked.emit(item_id)
		elif event.button_index == MOUSE_BUTTON_RIGHT:
			slot_right_clicked.emit(item_id)

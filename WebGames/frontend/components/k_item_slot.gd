# ==============================================================================
# 模块归属: 前端通用组件层 (Frontend · Reusable UI Components)
# 文件路径: res://frontend/components/k_item_slot.gd
# 架构定位: Reusable Atomic Component (KItemSlot)
# 依赖与触发: 上游: 背包/装备/工坊/商店等列表容器 | 下游: DesignTokens, TooltipManager, UIIntermediary
# 职责说明: 封装道具图标、品质边框色阶、叠加数量、池化状态复位与 TooltipManager 悬浮提示绑定。
# 退出语义与设计依据: 对象池 reset_state() 复用清态契约 (ADV-POOL-001) 与样式缓存复用原则
# ==============================================================================

## KItemSlot：支持对象池复用的标准物品插槽组件
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
	set(value):
		caption = value
		if _caption_label != null and is_instance_valid(_caption_label):
			_caption_label.text = caption

@export var selected: bool = false:
	set(value):
		selected = value
		_update_visuals()

@export var locked: bool = false:
	set(value):
		locked = value
		_update_visuals()

var _border_panel: PanelContainer
var _count_label: Label
var _caption_label: Label
var _icon_texture_rect: TextureRect

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

	_icon_texture_rect = TextureRect.new()
	_icon_texture_rect.set_anchors_and_offsets_preset(PRESET_FULL_RECT)
	_icon_texture_rect.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_icon_texture_rect.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	_icon_texture_rect.mouse_filter = MOUSE_FILTER_IGNORE
	add_child(_icon_texture_rect)

	_count_label = Label.new()
	_count_label.set_anchors_and_offsets_preset(PRESET_TOP_RIGHT)
	_count_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_count_label.add_theme_font_size_override("font_size", DesignTokens.FONT_SIZE_CAPTION)
	_count_label.add_theme_color_override("font_color", DesignTokens.COLOR_TEXT_PRIMARY)
	_count_label.mouse_filter = MOUSE_FILTER_IGNORE
	add_child(_count_label)

	_caption_label = Label.new()
	_caption_label.set_anchors_and_offsets_preset(PRESET_BOTTOM_WIDE)
	_caption_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_caption_label.clip_text = true
	_caption_label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	_caption_label.add_theme_font_size_override("font_size", DesignTokens.FONT_SIZE_CAPTION)
	_caption_label.add_theme_color_override("font_color", DesignTokens.COLOR_TEXT_SECONDARY)
	_caption_label.mouse_filter = MOUSE_FILTER_IGNORE
	add_child(_caption_label)

static var _cached_panel_styles: Dictionary = {}

static func _get_slot_style(rarity: int, is_locked: bool, is_selected: bool) -> StyleBoxFlat:
	var normalized_rarity: int = rarity if (rarity >= 1 and rarity <= 5) else 1
	# 位掩码合并 rarity(1..5)、锁定态(bit3)与选中态(bit4)，复用静态 StyleBoxFlat 实例
	var cache_key: int = normalized_rarity | (8 if is_locked else 0) | (16 if is_selected else 0)
	if _cached_panel_styles.has(cache_key):
		return _cached_panel_styles[cache_key] as StyleBoxFlat
	var slot_style := StyleBoxFlat.new()
	slot_style.bg_color = DesignTokens.COLOR_SURFACE_CARD
	slot_style.set_corner_radius_all(4)
	slot_style.set_border_width_all(3 if is_selected else 2)
	if is_selected:
		slot_style.border_color = DesignTokens.COLOR_ACCENT_GOLD
	elif is_locked:
		slot_style.border_color = DesignTokens.COLOR_TEXT_DISABLED
	else:
		match normalized_rarity:
			1: slot_style.border_color = DesignTokens.COLOR_QUALITY_COMMON
			2: slot_style.border_color = DesignTokens.COLOR_QUALITY_UNCOMMON
			3: slot_style.border_color = DesignTokens.COLOR_QUALITY_RARE
			4: slot_style.border_color = DesignTokens.COLOR_QUALITY_EPIC
			5: slot_style.border_color = DesignTokens.COLOR_QUALITY_LEGENDARY
			_: slot_style.border_color = DesignTokens.COLOR_QUALITY_COMMON
	_cached_panel_styles[cache_key] = slot_style
	return slot_style

func _update_visuals() -> void:
	if _border_panel == null:
		return

	modulate.a = 0.5 if locked else 1.0
	_border_panel.add_theme_stylebox_override("panel", _get_slot_style(rarity_level, locked, selected))

	if _count_label != null:
		_count_label.text = str(count) if count > 1 else ""
	if _caption_label != null and is_instance_valid(_caption_label):
		_caption_label.text = caption

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
	if _icon_texture_rect != null and is_instance_valid(_icon_texture_rect):
		_icon_texture_rect.texture = null
	_update_visuals()

## 批量注入物品展示数据并刷新边框与数量视觉表现
func set_item_data(next_id: String, next_name: String, next_description: String, next_rarity: int, next_count: int) -> void:
	item_id = next_id
	item_name = next_name
	item_desc = next_description
	rarity_level = next_rarity
	count = next_count
	_update_visuals()

## 设置插槽选中状态并刷新金色高亮边框
func set_selected(is_selected: bool) -> void:
	selected = is_selected

## 设置插槽锁定状态并刷新置灰视觉反馈
func set_locked(is_locked: bool) -> void:
	locked = is_locked

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

func _on_gui_input(input_event: InputEvent) -> void:
	if locked:
		return
	if input_event is InputEventMouseButton and input_event.pressed:
		if input_event.button_index == MOUSE_BUTTON_LEFT:
			slot_clicked.emit(item_id)
		elif input_event.button_index == MOUSE_BUTTON_RIGHT:
			slot_right_clicked.emit(item_id)

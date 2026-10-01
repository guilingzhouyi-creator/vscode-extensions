# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端通用组件: 状态面板 (KStatePanel)
# 文件路径: res://frontend/components/k_state_panel.gd
# 职责: 统一封装空状态 / 加载中 / 错误 / 就绪四种面板态，提供 i18n 文案与重试回调入口
# ==============================================================================
class_name KStatePanel
extends Control

const DesignTokens = preload("res://frontend/theme/design_tokens.gd")

enum State { LOADING, READY, EMPTY, ERROR }

signal retry_requested()

@export var empty_icon: Texture2D = null
@export var error_icon: Texture2D = null

var _vbox: VBoxContainer
var _icon_rect: TextureRect
var _lbl_title: Label
var _lbl_desc: Label
var _btn_retry: Button

var _empty_key: String = "ui.common.empty"
var _error_key: String = "ui.common.error"
var _loading_key: String = "ui.common.loading"
var _current_state: int = State.READY

func _ready() -> void:
	set_anchors_and_offsets_preset(PRESET_FULL_RECT)
	mouse_filter = MOUSE_FILTER_IGNORE

	var bg := PanelContainer.new()
	bg.set_anchors_and_offsets_preset(PRESET_FULL_RECT)
	var style := StyleBoxFlat.new()
	style.bg_color = DesignTokens.COLOR_SURFACE_PANEL
	bg.add_theme_stylebox_override("panel", style)
	add_child(bg)

	_vbox = VBoxContainer.new()
	_vbox.set_anchors_and_offsets_preset(PRESET_FULL_RECT)
	_vbox.alignment = BoxContainer.ALIGNMENT_CENTER
	_vbox.add_theme_constant_override("separation", DesignTokens.SPACING_SM)
	bg.add_child(_vbox)

	_icon_rect = TextureRect.new()
	_icon_rect.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_icon_rect.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	_icon_rect.custom_minimum_size = Vector2(48, 48)
	_icon_rect.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	_icon_rect.mouse_filter = MOUSE_FILTER_IGNORE
	_vbox.add_child(_icon_rect)

	_lbl_title = Label.new()
	_lbl_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_lbl_title.add_theme_font_size_override("font_size", DesignTokens.FONT_SIZE_TITLE_MD)
	_lbl_title.add_theme_color_override("font_color", DesignTokens.COLOR_TEXT_SECONDARY)
	_lbl_title.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	_lbl_title.mouse_filter = MOUSE_FILTER_IGNORE
	_vbox.add_child(_lbl_title)

	_lbl_desc = Label.new()
	_lbl_desc.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_lbl_desc.add_theme_font_size_override("font_size", DesignTokens.FONT_SIZE_BODY)
	_lbl_desc.add_theme_color_override("font_color", DesignTokens.COLOR_TEXT_MUTED)
	_lbl_desc.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	_lbl_desc.mouse_filter = MOUSE_FILTER_IGNORE
	_vbox.add_child(_lbl_desc)

	_btn_retry = Button.new()
	_btn_retry.text = UIIntermediary.text("ui.common.retry")
	_btn_retry.add_theme_font_size_override("font_size", DesignTokens.FONT_SIZE_BODY)
	_btn_retry.add_theme_color_override("font_color", DesignTokens.COLOR_TEXT_PRIMARY)
	_btn_retry.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	_btn_retry.visible = false
	_btn_retry.pressed.connect(_on_retry_pressed)
	_vbox.add_child(_btn_retry)

	set_state(State.READY)

func _on_retry_pressed() -> void:
	retry_requested.emit()

func set_state(state: int) -> void:
	_current_state = state
	match state:
		State.LOADING:
			_icon_rect.visible = false
			_lbl_title.text = UIIntermediary.text(_loading_key)
			_lbl_desc.visible = false
			_btn_retry.visible = false
			visible = true
		State.EMPTY:
			_icon_rect.texture = empty_icon
			_icon_rect.visible = empty_icon != null
			_lbl_title.text = UIIntermediary.text(_empty_key)
			_lbl_desc.visible = false
			_btn_retry.visible = false
			visible = true
		State.ERROR:
			_icon_rect.texture = error_icon
			_icon_rect.visible = error_icon != null
			_lbl_title.text = UIIntermediary.text(_error_key)
			_lbl_desc.visible = false
			_btn_retry.visible = true
			visible = true
		State.READY:
			visible = false

func set_empty_text(key: String) -> void:
	_empty_key = key
	if _current_state == State.EMPTY and _lbl_title != null:
		_lbl_title.text = UIIntermediary.text(key)

func set_error_text(key: String) -> void:
	_error_key = key
	if _current_state == State.ERROR and _lbl_title != null:
		_lbl_title.text = UIIntermediary.text(key)

func set_loading_text(key: String) -> void:
	_loading_key = key
	if _current_state == State.LOADING and _lbl_title != null:
		_lbl_title.text = UIIntermediary.text(key)

func bind_retry(callback: Callable) -> void:
	retry_requested.connect(callback)

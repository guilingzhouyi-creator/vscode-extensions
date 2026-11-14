# ==============================================================================
# 模块归属: 前端通用组件层 (Frontend · Reusable UI Components)
# 文件路径: res://frontend/components/k_state_panel.gd
# 架构定位: Reusable Atomic Component (KStatePanel)
# 依赖与触发: 上游: UIStateContainer 与异步数据视图 | 下游: DesignTokens, UIIntermediary
# 职责说明: 统一封装空状态 / 加载中 / 错误 / 就绪四种面板态，提供 i18n 文案绑定与重试回调入口。
# 退出语义与设计依据: 异步视图四态视觉互斥收敛契约
# ==============================================================================

## KStatePanel：异步视图四态（加载/就绪/空/错误）覆盖面板组件
class_name KStatePanel
extends Control

const DesignTokens = preload("res://frontend/theme/design_tokens.gd")

enum State { LOADING, READY, EMPTY, ERROR }

signal retry_requested()

@export var empty_icon: Texture2D = null
@export var error_icon: Texture2D = null

var _vbox: VBoxContainer
var _icon_rect: TextureRect
var _title_label: Label
var _description_label: Label
var _retry_button: Button

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

	_title_label = Label.new()
	_title_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_title_label.add_theme_font_size_override("font_size", DesignTokens.FONT_SIZE_TITLE_MD)
	_title_label.add_theme_color_override("font_color", DesignTokens.COLOR_TEXT_SECONDARY)
	_title_label.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	_title_label.mouse_filter = MOUSE_FILTER_IGNORE
	_vbox.add_child(_title_label)

	_description_label = Label.new()
	_description_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_description_label.add_theme_font_size_override("font_size", DesignTokens.FONT_SIZE_BODY)
	_description_label.add_theme_color_override("font_color", DesignTokens.COLOR_TEXT_MUTED)
	_description_label.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	_description_label.mouse_filter = MOUSE_FILTER_IGNORE
	_vbox.add_child(_description_label)

	_retry_button = Button.new()
	_retry_button.text = UIIntermediary.text("ui.common.retry")
	_retry_button.add_theme_font_size_override("font_size", DesignTokens.FONT_SIZE_BODY)
	_retry_button.add_theme_color_override("font_color", DesignTokens.COLOR_TEXT_PRIMARY)
	_retry_button.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	_retry_button.visible = false
	_retry_button.pressed.connect(_on_retry_pressed)
	_vbox.add_child(_retry_button)

	set_state(State.READY)

func _on_retry_pressed() -> void:
	retry_requested.emit()

## 切换当前状态面板枚举态并同步更新图标、文案与重试按钮可见性
func set_state(state: int) -> void:
	_current_state = state
	match state:
		State.LOADING:
			_icon_rect.visible = false
			_title_label.text = UIIntermediary.text(_loading_key)
			_description_label.visible = false
			_retry_button.visible = false
			visible = true
		State.EMPTY:
			_icon_rect.texture = empty_icon
			_icon_rect.visible = empty_icon != null
			_title_label.text = UIIntermediary.text(_empty_key)
			_description_label.visible = false
			_retry_button.visible = false
			visible = true
		State.ERROR:
			_icon_rect.texture = error_icon
			_icon_rect.visible = error_icon != null
			_title_label.text = UIIntermediary.text(_error_key)
			_description_label.visible = false
			_retry_button.visible = true
			visible = true
		State.READY:
			visible = false

## 设置空态提示文案的 i18n 键（当前处于空态时立即刷新显示）
func set_empty_text(key: String) -> void:
	_empty_key = key
	if _current_state == State.EMPTY and _title_label != null:
		_title_label.text = UIIntermediary.text(key)

## 设置错误态提示文案的 i18n 键（当前处于错误态时立即刷新显示）
func set_error_text(key: String) -> void:
	_error_key = key
	if _current_state == State.ERROR and _title_label != null:
		_title_label.text = UIIntermediary.text(key)

## 设置加载态提示文案的 i18n 键（当前处于加载态时立即刷新显示）
func set_loading_text(key: String) -> void:
	_loading_key = key
	if _current_state == State.LOADING and _title_label != null:
		_title_label.text = UIIntermediary.text(key)

## 绑定重试按钮点击后的外部回调
func bind_retry(callback: Callable) -> void:
	retry_requested.connect(callback)

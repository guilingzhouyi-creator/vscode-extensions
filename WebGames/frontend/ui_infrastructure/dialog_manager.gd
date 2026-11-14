# ==============================================================================
# 模块归属: Frontend / UIInfrastructure
# 文件路径: res://frontend/ui_infrastructure/dialog_manager.gd
# 架构定位: UI 基础设施通用系统对话框工厂与调度单例，基于 ModalManager 栈构建标准弹窗
# 依赖与触发: 依赖 DesignTokens、ModalManager 与 UIIntermediary，由各视图按钮或系统流调用
# 职责说明: 统一调度 Confirm、Alert、Prompt 与退出选择对话框，避免各视图重复手写弹窗
# 退出语义与设计依据: 点击任意操作按钮后先经 ModalManager 出栈销毁当前面板，再触发对应业务回调
# ==============================================================================
## DialogManager：通用系统对话框管理器，统一构建并托管确认、警告、输入与退出弹窗
class_name DialogManager
extends Node

const DesignTokens = preload("res://frontend/theme/design_tokens.gd")
const ModalManager = preload("res://frontend/ui_infrastructure/modal_manager.gd")

const BTN_WIDTH_STANDARD: float = 80.0
const BTN_WIDTH_WIDE: float = 90.0
const BTN_WIDTH_EXIT: float = 110.0

static var _instance: DialogManager
## 获取系统对话框管理器全局单例
static func get_instance() -> DialogManager:
	if _instance == null:
		_instance = DialogManager.new()
		_instance.name = "DialogManager"
	return _instance

func _add_modal_button(
	panel: Control,
	button_box: HBoxContainer,
	text_key: String,
	min_width: float,
	on_pressed: Callable = Callable()
) -> Button:
	var action_button := Button.new()
	action_button.text = UIIntermediary.text(text_key)
	action_button.custom_minimum_size = Vector2(min_width, 32)
	action_button.pressed.connect(func():
		ModalManager.get_instance().close_modal(panel)
		if on_pressed.is_valid():
			on_pressed.call()
	)
	button_box.add_child(action_button)
	return action_button

## 弹出二次确认对话框 (确认 / 取消)
func show_confirm(title: String, message: String, on_confirm: Callable, on_cancel: Callable = Callable()) -> Control:
	var panel := _create_base_panel(title, message)
	var button_box: HBoxContainer = panel.get_node("Content/ButtonBox")
	_add_modal_button(panel, button_box, "ui.common.dialog.cancel", BTN_WIDTH_STANDARD, on_cancel)
	_add_modal_button(panel, button_box, "ui.common.dialog.confirm", BTN_WIDTH_STANDARD, on_confirm)
	ModalManager.get_instance().open_modal(panel, false)
	return panel

## 弹出退出选择对话框 (退出到世界档案 / 直接退出游戏 / 取消)
func show_exit_choice(title: String, message: String, on_exit_to_archive: Callable, on_quit_game: Callable, on_cancel: Callable = Callable()) -> Control:
	var panel := _create_base_panel(title, message)
	var button_box: HBoxContainer = panel.get_node("Content/ButtonBox")
	_add_modal_button(panel, button_box, "ui.common.dialog.cancel", BTN_WIDTH_STANDARD, on_cancel)
	_add_modal_button(panel, button_box, "ui.fe02.menu.exit_to_archive", BTN_WIDTH_EXIT, on_exit_to_archive)
	_add_modal_button(panel, button_box, "ui.fe02.menu.exit", BTN_WIDTH_WIDE, on_quit_game)
	ModalManager.get_instance().open_modal(panel, false)
	return panel

## 弹出单按钮警告提示框
func show_alert(title: String, message: String, on_acknowledged: Callable = Callable()) -> Control:
	var panel := _create_base_panel(title, message)
	var button_box: HBoxContainer = panel.get_node("Content/ButtonBox")
	_add_modal_button(panel, button_box, "ui.common.dialog.ok", BTN_WIDTH_WIDE, on_acknowledged)
	ModalManager.get_instance().open_modal(panel, false)
	return panel

## 弹出带单行文本输入的对话框
func show_prompt(title: String, placeholder: String, on_submit: Callable) -> Control:
	var panel := _create_base_panel(title, "")
	var content: VBoxContainer = panel.get_node("Content")
	var button_box: HBoxContainer = panel.get_node("Content/ButtonBox")

	var line_edit := LineEdit.new()
	line_edit.placeholder_text = placeholder
	line_edit.custom_minimum_size = Vector2(260, 36)
	content.add_child(line_edit)
	content.move_child(line_edit, 1) # 插入到标题下方、按钮上方

	_add_modal_button(panel, button_box, "ui.common.dialog.cancel", BTN_WIDTH_STANDARD)
	_add_modal_button(panel, button_box, "ui.common.dialog.submit", BTN_WIDTH_STANDARD, func():
		if on_submit.is_valid():
			on_submit.call(line_edit.text)
	)

	ModalManager.get_instance().open_modal(panel, false)
	return panel

static var _shared_panel_style: StyleBoxFlat = null

## 创建基础弹窗面板骨架
func _create_base_panel(title_text: String, message_text: String) -> PanelContainer:
	var panel := PanelContainer.new()
	panel.custom_minimum_size = Vector2(340, 160)

	if _shared_panel_style == null:
		var bg_style := StyleBoxFlat.new()
		bg_style.bg_color = DesignTokens.COLOR_SURFACE_PANEL
		bg_style.set_corner_radius_all(8)
		bg_style.set_border_width_all(2)
		bg_style.border_color = DesignTokens.COLOR_PRIMARY
		_shared_panel_style = bg_style
	panel.add_theme_stylebox_override("panel", _shared_panel_style)

	var content := VBoxContainer.new()
	content.name = "Content"
	content.add_theme_constant_override("separation", DesignTokens.SPACING_MD)
	panel.add_child(content)

	var title_label := Label.new()
	title_label.text = title_text
	title_label.add_theme_font_size_override("font_size", DesignTokens.FONT_SIZE_TITLE_SM)
	title_label.add_theme_color_override("font_color", DesignTokens.COLOR_ACCENT_GOLD)
	title_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	content.add_child(title_label)

	if not message_text.is_empty():
		var message_label := Label.new()
		message_label.text = message_text
		message_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		message_label.add_theme_font_size_override("font_size", DesignTokens.FONT_SIZE_BODY)
		message_label.add_theme_color_override("font_color", DesignTokens.COLOR_TEXT_SECONDARY)
		content.add_child(message_label)

	var button_box := HBoxContainer.new()
	button_box.name = "ButtonBox"
	button_box.alignment = BoxContainer.ALIGNMENT_CENTER
	button_box.add_theme_constant_override("separation", DesignTokens.SPACING_MD)
	content.add_child(button_box)

	return panel

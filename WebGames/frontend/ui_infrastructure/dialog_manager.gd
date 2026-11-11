# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - UI基础设施: 通用系统对话框管理器
# 文件路径: res://frontend/ui_infrastructure/dialog_manager.gd
# 职责: 统一调度 Confirm / Alert / Prompt 对话框，避免各视图重复手写弹窗
# ==============================================================================
class_name DialogManager
extends Node

const DesignTokens = preload("res://frontend/theme/design_tokens.gd")
const ModalManager = preload("res://frontend/ui_infrastructure/modal_manager.gd")

const BTN_WIDTH_STANDARD: float = 80.0
const BTN_WIDTH_WIDE: float = 90.0
const BTN_WIDTH_EXIT: float = 110.0

static var _instance: DialogManager
static func get_instance() -> DialogManager:
	if _instance == null:
		_instance = DialogManager.new()
		_instance.name = "DialogManager"
	return _instance

func _add_modal_button(
	panel: Control,
	btn_box: HBoxContainer,
	text_key: String,
	min_width: float,
	on_pressed: Callable = Callable()
) -> Button:
	var btn := Button.new()
	btn.text = UIIntermediary.text(text_key)
	btn.custom_minimum_size = Vector2(min_width, 32)
	btn.pressed.connect(func():
		ModalManager.get_instance().close_modal(panel)
		if on_pressed.is_valid():
			on_pressed.call()
	)
	btn_box.add_child(btn)
	return btn

## 弹出二次确认对话框 (确认 / 取消)
func show_confirm(title: String, message: String, on_confirm: Callable, on_cancel: Callable = Callable()) -> Control:
	var panel := _create_base_panel(title, message)
	var btn_box: HBoxContainer = panel.get_node("Content/ButtonBox")
	_add_modal_button(panel, btn_box, "ui.common.dialog.cancel", BTN_WIDTH_STANDARD, on_cancel)
	_add_modal_button(panel, btn_box, "ui.common.dialog.confirm", BTN_WIDTH_STANDARD, on_confirm)
	ModalManager.get_instance().open_modal(panel, false)
	return panel

## 弹出退出选择对话框 (退出到世界档案 / 直接退出游戏 / 取消)
func show_exit_choice(title: String, message: String, on_exit_to_archive: Callable, on_quit_game: Callable, on_cancel: Callable = Callable()) -> Control:
	var panel := _create_base_panel(title, message)
	var btn_box: HBoxContainer = panel.get_node("Content/ButtonBox")
	_add_modal_button(panel, btn_box, "ui.common.dialog.cancel", BTN_WIDTH_STANDARD, on_cancel)
	_add_modal_button(panel, btn_box, "ui.fe02.menu.exit_to_archive", BTN_WIDTH_EXIT, on_exit_to_archive)
	_add_modal_button(panel, btn_box, "ui.fe02.menu.exit", BTN_WIDTH_WIDE, on_quit_game)
	ModalManager.get_instance().open_modal(panel, false)
	return panel

## 弹出单按钮警告提示框
func show_alert(title: String, message: String, on_acknowledged: Callable = Callable()) -> Control:
	var panel := _create_base_panel(title, message)
	var btn_box: HBoxContainer = panel.get_node("Content/ButtonBox")
	_add_modal_button(panel, btn_box, "ui.common.dialog.ok", BTN_WIDTH_WIDE, on_acknowledged)
	ModalManager.get_instance().open_modal(panel, false)
	return panel

## 弹出带单行文本输入的对话框
func show_prompt(title: String, placeholder: String, on_submit: Callable) -> Control:
	var panel := _create_base_panel(title, "")
	var content: VBoxContainer = panel.get_node("Content")
	var btn_box: HBoxContainer = panel.get_node("Content/ButtonBox")

	var line_edit := LineEdit.new()
	line_edit.placeholder_text = placeholder
	line_edit.custom_minimum_size = Vector2(260, 36)
	content.add_child(line_edit)
	content.move_child(line_edit, 1) # 插入到标题下方、按钮上方

	_add_modal_button(panel, btn_box, "ui.common.dialog.cancel", BTN_WIDTH_STANDARD)
	_add_modal_button(panel, btn_box, "ui.common.dialog.submit", BTN_WIDTH_STANDARD, func():
		if on_submit.is_valid():
			on_submit.call(line_edit.text)
	)

	ModalManager.get_instance().open_modal(panel, false)
	return panel

## 创建基础弹窗面板骨架
func _create_base_panel(title_text: String, message_text: String) -> PanelContainer:
	var panel := PanelContainer.new()
	panel.custom_minimum_size = Vector2(340, 160)

	var bg_style := StyleBoxFlat.new()
	bg_style.bg_color = DesignTokens.COLOR_SURFACE_PANEL
	bg_style.set_corner_radius_all(8)
	bg_style.border_width_bottom = 2
	bg_style.border_width_left = 2
	bg_style.border_width_right = 2
	bg_style.border_width_top = 2
	bg_style.border_color = DesignTokens.COLOR_PRIMARY
	panel.add_theme_stylebox_override("panel", bg_style)

	var content := VBoxContainer.new()
	content.name = "Content"
	content.add_theme_constant_override("separation", DesignTokens.SPACING_MD)
	panel.add_child(content)

	var lbl_title := Label.new()
	lbl_title.text = title_text
	lbl_title.add_theme_font_size_override("font_size", DesignTokens.FONT_SIZE_TITLE_SM)
	lbl_title.add_theme_color_override("font_color", DesignTokens.COLOR_ACCENT_GOLD)
	lbl_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	content.add_child(lbl_title)

	if not message_text.is_empty():
		var lbl_msg := Label.new()
		lbl_msg.text = message_text
		lbl_msg.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		lbl_msg.add_theme_font_size_override("font_size", DesignTokens.FONT_SIZE_BODY)
		lbl_msg.add_theme_color_override("font_color", DesignTokens.COLOR_TEXT_SECONDARY)
		content.add_child(lbl_msg)

	var btn_box := HBoxContainer.new()
	btn_box.name = "ButtonBox"
	btn_box.alignment = BoxContainer.ALIGNMENT_CENTER
	btn_box.add_theme_constant_override("separation", DesignTokens.SPACING_MD)
	content.add_child(btn_box)

	return panel

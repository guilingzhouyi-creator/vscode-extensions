# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - UI基础设施: 通用系统对话框管理器
# 文件路径: res://frontend/ui_infrastructure/dialog_manager.gd
# 职责: 统一调度 Confirm / Alert / Prompt 对话框，避免各视图重复手写弹窗
# ==============================================================================
class_name DialogManager
extends Node

const DesignTokens = preload("res://frontend/theme/design_tokens.gd")
const ModalManager = preload("res://frontend/ui_infrastructure/modal_manager.gd")

static var _instance: DialogManager
static func get_instance() -> DialogManager:
	if _instance == null:
		_instance = load("res://frontend/ui_infrastructure/dialog_manager.gd").new()
		_instance.name = "DialogManager"
	return _instance

## 弹出二次确认对话框 (确认 / 取消)
func show_confirm(title: String, message: String, on_confirm: Callable, on_cancel: Callable = Callable()) -> Control:
	var panel := _create_base_panel(title, message)
	var btn_box: HBoxContainer = panel.get_node("Content/ButtonBox")

	var btn_cancel := Button.new()
	btn_cancel.text = UIIntermediary.text("ui.common.dialog.cancel")
	btn_cancel.custom_minimum_size = Vector2(80, 32)
	btn_cancel.pressed.connect(func():
		ModalManager.get_instance().close_modal(panel)
		if on_cancel.is_valid():
			on_cancel.call()
	)
	btn_box.add_child(btn_cancel)

	var btn_ok := Button.new()
	btn_ok.text = UIIntermediary.text("ui.common.dialog.confirm")
	btn_ok.custom_minimum_size = Vector2(80, 32)
	btn_ok.pressed.connect(func():
		ModalManager.get_instance().close_modal(panel)
		if on_confirm.is_valid():
			on_confirm.call()
	)
	btn_box.add_child(btn_ok)

	ModalManager.get_instance().open_modal(panel, false)
	return panel

## 弹出单按钮警告提示框
func show_alert(title: String, message: String, on_acknowledged: Callable = Callable()) -> Control:
	var panel := _create_base_panel(title, message)
	var btn_box: HBoxContainer = panel.get_node("Content/ButtonBox")

	var btn_ok := Button.new()
	btn_ok.text = UIIntermediary.text("ui.common.dialog.ok")
	btn_ok.custom_minimum_size = Vector2(90, 32)
	btn_ok.pressed.connect(func():
		ModalManager.get_instance().close_modal(panel)
		if on_acknowledged.is_valid():
			on_acknowledged.call()
	)
	btn_box.add_child(btn_ok)

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

	var btn_cancel := Button.new()
	btn_cancel.text = UIIntermediary.text("ui.common.dialog.cancel")
	btn_cancel.custom_minimum_size = Vector2(80, 32)
	btn_cancel.pressed.connect(func():
		ModalManager.get_instance().close_modal(panel)
	)
	btn_box.add_child(btn_cancel)

	var btn_ok := Button.new()
	btn_ok.text = UIIntermediary.text("ui.common.dialog.submit")
	btn_ok.custom_minimum_size = Vector2(80, 32)
	btn_ok.pressed.connect(func():
		var text := line_edit.text
		ModalManager.get_instance().close_modal(panel)
		if on_submit.is_valid():
			on_submit.call(text)
	)
	btn_box.add_child(btn_ok)

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

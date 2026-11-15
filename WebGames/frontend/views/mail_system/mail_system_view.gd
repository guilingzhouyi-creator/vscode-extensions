# ==============================================================================
# 模块归属: 前端邮件视图域 (fe08 邮件系统)
# 文件路径: res://frontend/views/mail_system/mail_system_view.gd
# 架构定位: BaseScreen 视图控制器；承载收件箱列表、容量显示、详情阅读与写信页签
# 依赖与触发: 依赖 ThemeManager、UIIntermediary、ServiceLocator 与 MailSystemTabs
# 职责说明: 渲染邮件三态分类与容量状态，驱动附件提取、单删批删及写信切换交互
# 退出语义与设计依据: 返回操作调用 self.back()；虚拟列表与写信面板委托给 Tabs 管理
# ==============================================================================
## 邮件系统主视图控制器，协调收件箱列表、邮件详情阅读与写信界面流转。
class_name MailSystemView
extends BaseScreen

const KTabBar = preload("res://frontend/components/k_tab_bar.gd")
const MailSystemTabsClass = preload("res://frontend/views/mail_system/mail_system_tabs.gd")

# ==============================================================================
# 节点引用（场景树中以 unique_name_in_owner 标记）
# ==============================================================================

# --- 顶栏 ---
@onready var _back_button: Button = $%BtnBack

# --- 左侧：邮件列表 ---
@onready var _category_tab_bar: TabBar = $%CategoryTabBar
@onready var _search_edit: LineEdit = $%SearchEdit
@onready var _mail_item_list: ItemList = $%MailItemList
@onready var _label_capacity: Label = $%LabelCapacity
@onready var _select_all_button: Button = $%BtnSelectAll
@onready var _batch_delete_button: Button = $%BtnBatchDelete
@onready var _claim_all_button: Button = $%BtnClaimAll

# --- 右侧 Tab 容器 ---
@onready var _right_tab_container: TabContainer = $%RightTabContainer

# --- 右侧 Tab 0: 邮件详情 ---
@onready var _label_detail_subject: Label = $%LabelDetailSubject
@onready var _label_detail_sender: Label = $%LabelDetailSender
@onready var _label_detail_recipient: Label = $%LabelDetailRecipient
@onready var _label_detail_time: Label = $%LabelDetailTime
@onready var _rich_text_body: RichTextLabel = $%RichTextBody
@onready var _attachment_list_container: HBoxContainer = $%AttachmentListContainer
@onready var _claim_attachment_button: Button = $%BtnClaimAttachment
@onready var _reply_button: Button = $%BtnReply
@onready var _delete_mail_button: Button = $%BtnDeleteMail

# --- 右侧 Tab 1: 写邮件 ---
@onready var _line_edit_recipient: LineEdit = $%LineEditRecipient
@onready var _line_edit_subject: LineEdit = $%LineEditSubject
@onready var _text_edit_body: TextEdit = $%TextEditBody
@onready var _add_attachment_button: Button = $%BtnAddAttachment
@onready var _compose_attachment_list: HBoxContainer = $%ComposeAttachmentList
@onready var _send_button: Button = $%BtnSend
@onready var _save_draft_button: Button = $%BtnSaveDraft

# ==============================================================================
# 状态与变量
# ==============================================================================

enum MailCategory {ALL, SYSTEM, REWARD, GUILD, PLAYER}
var current_category: int = MailCategory.ALL

var stored_mails: Array = []
var selected_mail_id: String = ""
var search_keyword: String = ""
var max_mailbox_capacity: int = ServiceLocator.get_instance().mail().get_max_capacity()
var _tabs: Variant = null

# ==============================================================================
# 外部视图契约兼容方法
# ==============================================================================

## 兼容快照注入入口：更新收件箱邮件集合。
func set_mailbox_snapshot(mail_entries: Array) -> void:
	apply_snapshot({"mails": mail_entries})

## 统一快照渲染映射：容量/邮件列表 → 视图状态，随后切就绪态
func _render_from_snapshot() -> void:
	if snapshot.has("capacity"):
		max_mailbox_capacity = int(snapshot.get("capacity", max_mailbox_capacity))
	if snapshot.has("mails"):
		stored_mails = FrontendSnapshot.read_array(snapshot, "mails")
	show_ready_state()

## 按邮件编号选中邮件并标记为已读，返回选中状态与邮件详情。
func select_mail(mail_id: String) -> Dictionary:
	selected_mail_id = mail_id
	stored_mails = ServiceLocator.get_instance().mail().mark_read(stored_mails, mail_id)
	for mail_entry in stored_mails:
		if str(mail_entry.get("mail_id", "")) == mail_id:
			return {"success": true, "mail": mail_entry}
	return {"success": false, "mail_id": mail_id}

## 预览一键领取全部未领取附件，返回操作成功状态与已领取邮件数量。
func claim_all_attachments_preview() -> Dictionary:
	var claim_result: Dictionary = ServiceLocator.get_instance().mail().claim_all(stored_mails)
	stored_mails = claim_result.get("mails", stored_mails)
	return {"success": true, "claimed_mails_count": int(claim_result.get("claimed_count", 0))}

# ==============================================================================
# 生命周期
# ==============================================================================

func _ready() -> void:
	_tabs = _register_owned_subcontroller(MailSystemTabsClass.new())
	_tabs.setup(self)

	var theme_manager := ThemeManager.get_instance()
	if theme_manager.theme != null:
		theme = theme_manager.theme

	_load_mock_data()
	_tabs.setup_category_tabs()

	_init_mail_list()
	_init_mail_detail()
	_tabs.init_mail_compose()

	_tabs.init_static_text()
	_connect_signals()
	UIIntermediary.adapt_view(self)

func _load_mock_data() -> void:
	if _tabs != null:
		apply_snapshot({
			"capacity": ServiceLocator.get_instance().mail().get_max_capacity(),
			"mails": _tabs.mock_mails,
		})

# ==============================================================================
# 列表与详情初始化与渲染
# ==============================================================================

func _init_mail_list() -> void:
	_refresh_mail_list()
	_refresh_capacity()

func _refresh_capacity() -> void:
	if _label_capacity == null:
		return
	UIIntermediary.resolve(_label_capacity, "ui.fe08.capacity.label", {
		"current": stored_mails.size(),
		"max": max_mailbox_capacity
	})

func _refresh_mail_list() -> void:
	if _mail_item_list == null:
		return
	_mail_item_list.clear()
	var filtered_mails: Array = _get_filtered_mails()
	for mail_index in filtered_mails.size():
		var mail_entry: Dictionary = filtered_mails[mail_index]
		var sender: String = UIIntermediary.text(str(mail_entry.get("sender_key", "")))
		var subject: String = UIIntermediary.text(str(mail_entry.get("subject_key", "")))
		var read_mark: String = UIIntermediary.text("ui.fe08.list.read_mark") if bool(mail_entry.get("is_read", false)) else UIIntermediary.text("ui.fe08.list.unread_mark")
		var attach_mark: String = " 📎" if bool(mail_entry.get("has_attachment", false)) else ""
		_mail_item_list.add_item("%s%s - %s%s" % [read_mark, sender, subject, attach_mark])
	if _tabs != null:
		_tabs.sync_virtual_list(filtered_mails.size())

func _init_mail_detail() -> void:
	if _label_detail_subject == null:
		return
	UIIntermediary.resolve(_label_detail_subject, "ui.fe08.detail.no_selection")
	_label_detail_sender.text = ""
	_label_detail_recipient.text = ""
	_label_detail_time.text = ""
	_rich_text_body.text = ""
	if _attachment_list_container != null:
		for child in _attachment_list_container.get_children():
			child.visible = false
	_claim_attachment_button.disabled = true
	_reply_button.disabled = true
	_delete_mail_button.disabled = true

func _show_mail_detail(mail_entry: Dictionary) -> void:
	if _label_detail_subject == null:
		return
	selected_mail_id = str(mail_entry.get("mail_id", ""))
	_label_detail_subject.text = UIIntermediary.text(str(mail_entry.get("subject_key", "")))
	_label_detail_sender.text = UIIntermediary.text(str(mail_entry.get("sender_key", "")))
	_label_detail_recipient.text = UIIntermediary.text(str(mail_entry.get("recipient_key", "")))
	_label_detail_time.text = UIIntermediary.text(str(mail_entry.get("time_key", "")))
	_rich_text_body.text = UIIntermediary.text(str(mail_entry.get("body_key", "")))

	var attachment_keys: Array = mail_entry.get("attachment_keys", [])
	var has_attachment: bool = bool(mail_entry.get("has_attachment", false))
	var is_claimed: bool = bool(mail_entry.get("is_claimed", false))

	var active_attachment_count: int = attachment_keys.size() if has_attachment else 0
	for attachment_index in range(active_attachment_count):
		var attachment_button: Button = _acquire_attachment_button(attachment_index)
		attachment_button.visible = true
		attachment_button.text = UIIntermediary.text(str(attachment_keys[attachment_index]))
	for child_index in range(active_attachment_count, _attachment_list_container.get_child_count()):
		_attachment_list_container.get_child(child_index).visible = false

	_claim_attachment_button.disabled = not has_attachment or is_claimed
	_reply_button.disabled = false
	_delete_mail_button.disabled = false

	stored_mails = ServiceLocator.get_instance().mail().mark_read(stored_mails, str(mail_entry.get("mail_id", "")))
	_refresh_mail_list()

## 获取或创建邮件附件按钮（循环外分配，池化复用）
func _acquire_attachment_button(index: int) -> Button:
	if index < _attachment_list_container.get_child_count():
		return _attachment_list_container.get_child(index) as Button
	var attachment_button := Button.new()
	_attachment_list_container.add_child(attachment_button)
	return attachment_button

# ==============================================================================
# 信号绑定与事件处理
# ==============================================================================

func _connect_signals() -> void:
	connect_managed(_back_button.pressed, _on_back_pressed)
	connect_managed(_category_tab_bar.tab_changed, _on_category_changed)
	connect_managed(_search_edit.text_changed, _on_search_changed)
	connect_managed(_mail_item_list.item_selected, _on_mail_selected)
	connect_managed(_select_all_button.pressed, _on_select_all)
	connect_managed(_batch_delete_button.pressed, _on_batch_delete)
	connect_managed(_claim_all_button.pressed, _on_claim_all)

	connect_managed(_claim_attachment_button.pressed, _on_claim_attachment)
	connect_managed(_reply_button.pressed, func(): if _tabs != null: _tabs.on_reply())
	connect_managed(_delete_mail_button.pressed, _on_delete_mail)

	connect_managed(_add_attachment_button.pressed, func(): if _tabs != null: _tabs.on_add_attachment())
	connect_managed(_send_button.pressed, func(): if _tabs != null: _tabs.on_send())
	connect_managed(_save_draft_button.pressed, func(): if _tabs != null: _tabs.on_save_draft())

func _on_back_pressed() -> void:
	self.back()

func _on_category_changed(tab: int) -> void:
	current_category = tab
	_refresh_mail_list()

func _on_search_changed(new_text: String) -> void:
	search_keyword = new_text
	_refresh_mail_list()

func _on_mail_selected(index: int) -> void:
	var filtered_mails: Array = _get_filtered_mails()
	if index >= 0 and index < filtered_mails.size():
		_show_mail_detail(filtered_mails[index])
		_right_tab_container.current_tab = 0

func _get_filtered_mails() -> Array:
	var filtered_mails: Array = []
	var category_code_text: String = _tabs.category_code(current_category) if _tabs != null else ""
	for mail_entry in stored_mails:
		if not category_code_text.is_empty() and mail_entry.get("category", "") != category_code_text:
			continue
		if not search_keyword.is_empty():
			var sender: String = UIIntermediary.text(str(mail_entry.get("sender_key", "")))
			var subject: String = UIIntermediary.text(str(mail_entry.get("subject_key", "")))
			if not sender.contains(search_keyword) and not subject.contains(search_keyword):
				continue
		filtered_mails.append(mail_entry)
	return filtered_mails

func _on_select_all() -> void:
	var filtered_mails: Array = _get_filtered_mails()
	for mail_index in filtered_mails.size():
		_mail_item_list.select(mail_index)

func _on_batch_delete() -> void:
	var selected_indices: PackedInt32Array = _mail_item_list.get_selected_items()
	if selected_indices.is_empty():
		return
	var filtered_mails: Array = _get_filtered_mails()
	var mail_ids_to_remove: Array = []
	for selected_index in selected_indices:
		if selected_index < filtered_mails.size():
			mail_ids_to_remove.append(filtered_mails[selected_index].get("mail_id", ""))
	stored_mails = ServiceLocator.get_instance().mail().delete_by_ids(stored_mails, mail_ids_to_remove)
	_refresh_mail_list()
	_refresh_capacity()
	_init_mail_detail()

func _on_claim_all() -> void:
	var claim_result: Dictionary = ServiceLocator.get_instance().mail().claim_all(stored_mails)
	stored_mails = claim_result.get("mails", stored_mails)
	var claimed_count := int(claim_result.get("claimed_count", 0))
	if claimed_count > 0:
		_refresh_mail_list()
		if not selected_mail_id.is_empty():
			for mail_entry in _get_filtered_mails():
				if str(mail_entry.get("mail_id", "")) == selected_mail_id:
					_show_mail_detail(mail_entry)
					break

func _on_claim_attachment() -> void:
	var claim_result: Dictionary = ServiceLocator.get_instance().mail().claim_one(stored_mails, selected_mail_id)
	if not bool(claim_result.get("success", false)):
		return
	stored_mails = claim_result.get("mails", stored_mails)
	for mail_entry in stored_mails:
		if str(mail_entry.get("mail_id", "")) == selected_mail_id:
			_show_mail_detail(mail_entry)
			_refresh_mail_list()
			break

func _on_delete_mail() -> void:
	stored_mails = ServiceLocator.get_instance().mail().delete_by_ids(stored_mails, [selected_mail_id])
	selected_mail_id = ""
	_refresh_mail_list()
	_refresh_capacity()
	_init_mail_detail()

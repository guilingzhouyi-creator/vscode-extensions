# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第8卷: 邮件系统视图控制器
# 文件路径: res://frontend/views/mail_system/mail_system_view.gd
# 职责: 邮件三态分类、信箱 100 封容量条、附件提取与批量操作；
#       左右分栏布局：左侧邮件列表（5 分类 Tab + 搜索 + 批量操作），
#       右侧 Tab 容器（邮件详情 / 写邮件）。
# ==============================================================================
class_name MailSystemView
extends BaseScreen

const KTabBar = preload("res://frontend/components/k_tab_bar.gd")
const MailSystemTabsClass = preload("res://frontend/views/mail_system/mail_system_tabs.gd")

# ==============================================================================
# 节点引用（场景树中以 unique_name_in_owner 标记）
# ==============================================================================

# --- 顶栏 ---
@onready var _btn_back: Button = $%BtnBack

# --- 左侧：邮件列表 ---
@onready var _category_tab_bar: TabBar = $%CategoryTabBar
@onready var _search_edit: LineEdit = $%SearchEdit
@onready var _mail_item_list: ItemList = $%MailItemList
@onready var _label_capacity: Label = $%LabelCapacity
@onready var _btn_select_all: Button = $%BtnSelectAll
@onready var _btn_batch_delete: Button = $%BtnBatchDelete
@onready var _btn_claim_all: Button = $%BtnClaimAll

# --- 右侧 Tab 容器 ---
@onready var _right_tab_container: TabContainer = $%RightTabContainer

# --- 右侧 Tab 0: 邮件详情 ---
@onready var _label_detail_subject: Label = $%LabelDetailSubject
@onready var _label_detail_sender: Label = $%LabelDetailSender
@onready var _label_detail_recipient: Label = $%LabelDetailRecipient
@onready var _label_detail_time: Label = $%LabelDetailTime
@onready var _rich_text_body: RichTextLabel = $%RichTextBody
@onready var _attachment_list_container: HBoxContainer = $%AttachmentListContainer
@onready var _btn_claim_attachment: Button = $%BtnClaimAttachment
@onready var _btn_reply: Button = $%BtnReply
@onready var _btn_delete_mail: Button = $%BtnDeleteMail

# --- 右侧 Tab 1: 写邮件 ---
@onready var _line_edit_recipient: LineEdit = $%LineEditRecipient
@onready var _line_edit_subject: LineEdit = $%LineEditSubject
@onready var _text_edit_body: TextEdit = $%TextEditBody
@onready var _btn_add_attachment: Button = $%BtnAddAttachment
@onready var _compose_attachment_list: HBoxContainer = $%ComposeAttachmentList
@onready var _btn_send: Button = $%BtnSend
@onready var _btn_save_draft: Button = $%BtnSaveDraft

# ==============================================================================
# 状态与变量
# ==============================================================================

enum MailCategory {ALL, SYSTEM, REWARD, GUILD, PLAYER}
var current_category: int = MailCategory.ALL

var stored_mails: Array = []
var selected_mail_id: String = ""
var search_keyword: String = ""
var max_mailbox_capacity: int = MockServiceContainer.get_instance().mail().get_max_capacity()
var _tabs = null

# ==============================================================================
# 白模测试契约兼容桩
# ==============================================================================

## 白模测试契约桩：注入信箱快照（经统一快照入口）
func set_mailbox_snapshot(mails: Array) -> void:
	apply_snapshot({"mails": mails})

## 统一快照渲染映射：容量/邮件列表 → 视图状态，随后切就绪态
func _render_from_snapshot() -> void:
	if snapshot.has("capacity"):
		max_mailbox_capacity = int(snapshot.get("capacity", max_mailbox_capacity))
	if snapshot.has("mails"):
		stored_mails = FrontendSnapshot.read_array(snapshot, "mails")
	show_ready_state()

## 白模测试契约桩：按 mail_id 选中邮件并标记已读
func select_mail(mail_id: String) -> Dictionary:
	selected_mail_id = mail_id
	stored_mails = MockServiceContainer.get_instance().mail().mark_read(stored_mails, mail_id)
	for m in stored_mails:
		if str(m.get("mail_id", "")) == mail_id:
			return {"success": true, "mail": m}
	return {"success": false, "mail_id": mail_id}

## 白模测试契约桩：预览一键领取全部未领取附件
func claim_all_attachments_preview() -> Dictionary:
	var result: Dictionary = MockServiceContainer.get_instance().mail().claim_all(stored_mails)
	stored_mails = result.get("mails", stored_mails)
	return {"success": true, "claimed_mails_count": int(result.get("claimed_count", 0))}

# ==============================================================================
# 生命周期
# ==============================================================================

func _ready() -> void:
	_tabs = MailSystemTabsClass.new()
	_tabs.setup(self)

	var tm := ThemeManager.get_instance()
	if tm.theme != null:
		theme = tm.theme

	_load_mock_data()
	_tabs.setup_category_tabs()

	_init_mail_list()
	_init_mail_detail()
	_tabs.init_mail_compose()

	_tabs.init_static_text()
	_connect_signals()
	UIIntermediary.adapt_view(self)

func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		UIIntermediary.clear_view_bindings(self)

func _load_mock_data() -> void:
	if _tabs != null:
		apply_snapshot({
			"capacity": MockServiceContainer.get_instance().mail().get_max_capacity(),
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
	var filtered: Array = _get_filtered_mails()
	for i in filtered.size():
		var mail: Dictionary = filtered[i]
		var sender: String = UIIntermediary.text(str(mail.get("sender_key", "")))
		var subject: String = UIIntermediary.text(str(mail.get("subject_key", "")))
		var read_mark: String = "[已读] " if bool(mail.get("is_read", false)) else "[未读] "
		var attach_mark: String = " 📎" if bool(mail.get("has_attachment", false)) else ""
		_mail_item_list.add_item("%s%s - %s%s" % [read_mark, sender, subject, attach_mark])
	if _tabs != null:
		_tabs.sync_virtual_list(filtered.size())

func _init_mail_detail() -> void:
	if _label_detail_subject == null:
		return
	UIIntermediary.resolve(_label_detail_subject, "ui.fe08.detail.no_selection")
	_label_detail_sender.text = ""
	_label_detail_recipient.text = ""
	_label_detail_time.text = ""
	_rich_text_body.text = ""
	if _tabs != null:
		_tabs.clear_container_children(_attachment_list_container)
	_btn_claim_attachment.disabled = true
	_btn_reply.disabled = true
	_btn_delete_mail.disabled = true

func _show_mail_detail(mail: Dictionary) -> void:
	if _label_detail_subject == null:
		return
	selected_mail_id = str(mail.get("mail_id", ""))
	_label_detail_subject.text = UIIntermediary.text(str(mail.get("subject_key", "")))
	_label_detail_sender.text = UIIntermediary.text(str(mail.get("sender_key", "")))
	_label_detail_recipient.text = UIIntermediary.text(str(mail.get("recipient_key", "")))
	_label_detail_time.text = UIIntermediary.text(str(mail.get("time_key", "")))
	_rich_text_body.text = UIIntermediary.text(str(mail.get("body_key", "")))

	if _tabs != null:
		_tabs.clear_container_children(_attachment_list_container)
	var attach_keys: Array = mail.get("attachment_keys", [])
	var has_attach: bool = bool(mail.get("has_attachment", false))
	var is_claimed: bool = bool(mail.get("is_claimed", false))

	if has_attach and not attach_keys.is_empty():
		for key in attach_keys:
			var btn := Button.new()
			btn.text = UIIntermediary.text(str(key))
			_attachment_list_container.add_child(btn)

	_btn_claim_attachment.disabled = not has_attach or is_claimed
	_btn_reply.disabled = false
	_btn_delete_mail.disabled = false

	stored_mails = MockServiceContainer.get_instance().mail().mark_read(stored_mails, str(mail.get("mail_id", "")))
	_refresh_mail_list()

# ==============================================================================
# 信号绑定与事件处理
# ==============================================================================

func _connect_signals() -> void:
	_btn_back.pressed.connect(_on_back_pressed)
	_category_tab_bar.tab_changed.connect(_on_category_changed)
	_search_edit.text_changed.connect(_on_search_changed)
	_mail_item_list.item_selected.connect(_on_mail_selected)
	_btn_select_all.pressed.connect(_on_select_all)
	_btn_batch_delete.pressed.connect(_on_batch_delete)
	_btn_claim_all.pressed.connect(_on_claim_all)

	_btn_claim_attachment.pressed.connect(_on_claim_attachment)
	_btn_reply.pressed.connect(func(): if _tabs != null: _tabs.on_reply())
	_btn_delete_mail.pressed.connect(_on_delete_mail)

	_btn_add_attachment.pressed.connect(func(): if _tabs != null: _tabs.on_add_attachment())
	_btn_send.pressed.connect(func(): if _tabs != null: _tabs.on_send())
	_btn_save_draft.pressed.connect(func(): if _tabs != null: _tabs.on_save_draft())

func _on_back_pressed() -> void:
	self.back()

func _on_category_changed(tab: int) -> void:
	current_category = tab
	_refresh_mail_list()

func _on_search_changed(new_text: String) -> void:
	search_keyword = new_text
	_refresh_mail_list()

func _on_mail_selected(index: int) -> void:
	var filtered: Array = _get_filtered_mails()
	if index >= 0 and index < filtered.size():
		_show_mail_detail(filtered[index])
		_right_tab_container.current_tab = 0

func _get_filtered_mails() -> Array:
	var result: Array = []
	var cat_code: String = _tabs.category_code(current_category) if _tabs != null else ""
	for mail in stored_mails:
		if not cat_code.is_empty() and mail.get("category", "") != cat_code:
			continue
		if not search_keyword.is_empty():
			var sender: String = UIIntermediary.text(str(mail.get("sender_key", "")))
			var subject: String = UIIntermediary.text(str(mail.get("subject_key", "")))
			if not sender.contains(search_keyword) and not subject.contains(search_keyword):
				continue
		result.append(mail)
	return result

func _on_select_all() -> void:
	var filtered: Array = _get_filtered_mails()
	for i in filtered.size():
		_mail_item_list.select(i)

func _on_batch_delete() -> void:
	var selected: PackedInt32Array = _mail_item_list.get_selected_items()
	if selected.is_empty():
		return
	var filtered: Array = _get_filtered_mails()
	var ids_to_remove: Array = []
	for idx in selected:
		if idx < filtered.size():
			ids_to_remove.append(filtered[idx].get("mail_id", ""))
	stored_mails = MockServiceContainer.get_instance().mail().delete_by_ids(stored_mails, ids_to_remove)
	_refresh_mail_list()
	_refresh_capacity()
	_init_mail_detail()

func _on_claim_all() -> void:
	var result: Dictionary = MockServiceContainer.get_instance().mail().claim_all(stored_mails)
	stored_mails = result.get("mails", stored_mails)
	var claimed := int(result.get("claimed_count", 0))
	if claimed > 0:
		_refresh_mail_list()
		if not selected_mail_id.is_empty():
			for mail in _get_filtered_mails():
				if str(mail.get("mail_id", "")) == selected_mail_id:
					_show_mail_detail(mail)
					break

func _on_claim_attachment() -> void:
	var result: Dictionary = MockServiceContainer.get_instance().mail().claim_one(stored_mails, selected_mail_id)
	if not bool(result.get("success", false)):
		return
	stored_mails = result.get("mails", stored_mails)
	for mail in stored_mails:
		if str(mail.get("mail_id", "")) == selected_mail_id:
			_show_mail_detail(mail)
			_refresh_mail_list()
			break

func _on_delete_mail() -> void:
	stored_mails = MockServiceContainer.get_instance().mail().delete_by_ids(stored_mails, [selected_mail_id])
	selected_mail_id = ""
	_refresh_mail_list()
	_refresh_capacity()
	_init_mail_detail()

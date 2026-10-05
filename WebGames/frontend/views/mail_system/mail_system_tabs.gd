# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第8卷: 邮件系统子面板委托
# 文件路径: res://frontend/views/mail_system/mail_system_tabs.gd
# 职责: 承担 MailSystemView 的分类Tab配置、静态文案初始化、写邮件Tab与Mock数据
# ==============================================================================
class_name MailSystemTabs
extends BaseScreen

const KTabBar = preload("res://frontend/components/k_tab_bar.gd")
const KVirtualListClass = preload("res://frontend/components/k_virtual_list.gd")
const KPageHeaderClass = preload("res://frontend/components/k_page_header.gd")
const KSplitPanelClass = preload("res://frontend/components/k_split_panel.gd")
const KSearchBarClass = preload("res://frontend/components/k_search_bar.gd")
const KStatePanelClass = preload("res://frontend/components/k_state_panel.gd")

var virtual_list: KVirtualList = null
var page_header: KPageHeader = null
var split_panel: KSplitPanel = null
var search_bar: KSearchBar = null
var state_panel: KStatePanel = null

var _view = null

var mock_mails: Array = [
	{
		"mail_id": "M_01", "category": "REWARD", "sender_key": "ui.fe08.mock.mail_01_sender", "recipient_key": "ui.fe08.mock.mail_01_recipient",
		"subject_key": "ui.fe08.mock.mail_01_subject", "body_key": "ui.fe08.mock.mail_01_body",
		"time_key": "ui.fe08.mock.mail_01_time", "is_read": false, "has_attachment": true, "is_claimed": false,
		"attachment_keys": ["ui.fe08.mock.mail_01_attach_0", "ui.fe08.mock.mail_01_attach_1"]
	},
	{
		"mail_id": "M_02", "category": "REWARD", "sender_key": "ui.fe08.mock.mail_02_sender", "recipient_key": "ui.fe08.mock.mail_02_recipient",
		"subject_key": "ui.fe08.mock.mail_02_subject", "body_key": "ui.fe08.mock.mail_02_body",
		"time_key": "ui.fe08.mock.mail_02_time", "is_read": false, "has_attachment": true, "is_claimed": false,
		"attachment_keys": ["ui.fe08.mock.mail_02_attach_0"]
	},
	{
		"mail_id": "M_03", "category": "GUILD", "sender_key": "ui.fe08.mock.mail_03_sender", "recipient_key": "ui.fe08.mock.mail_03_recipient",
		"subject_key": "ui.fe08.mock.mail_03_subject", "body_key": "ui.fe08.mock.mail_03_body",
		"time_key": "ui.fe08.mock.mail_03_time", "is_read": true, "has_attachment": false, "is_claimed": false,
		"attachment_keys": []
	},
	{
		"mail_id": "M_04", "category": "GUILD", "sender_key": "ui.fe08.mock.mail_04_sender", "recipient_key": "ui.fe08.mock.mail_04_recipient",
		"subject_key": "ui.fe08.mock.mail_04_subject", "body_key": "ui.fe08.mock.mail_04_body",
		"time_key": "ui.fe08.mock.mail_04_time", "is_read": true, "has_attachment": false, "is_claimed": false,
		"attachment_keys": []
	},
	{
		"mail_id": "M_05", "category": "PLAYER", "sender_key": "ui.fe08.mock.mail_05_sender", "recipient_key": "ui.fe08.mock.mail_05_recipient",
		"subject_key": "ui.fe08.mock.mail_05_subject", "body_key": "ui.fe08.mock.mail_05_body",
		"time_key": "ui.fe08.mock.mail_05_time", "is_read": true, "has_attachment": true, "is_claimed": true,
		"attachment_keys": ["ui.fe08.mock.mail_05_attach_0"]
	},
	{
		"mail_id": "M_06", "category": "PLAYER", "sender_key": "ui.fe08.mock.mail_06_sender", "recipient_key": "ui.fe08.mock.mail_06_recipient",
		"subject_key": "ui.fe08.mock.mail_06_subject", "body_key": "ui.fe08.mock.mail_06_body",
		"time_key": "ui.fe08.mock.mail_06_time", "is_read": true, "has_attachment": false, "is_claimed": false,
		"attachment_keys": []
	},
	{
		"mail_id": "M_07", "category": "SYSTEM", "sender_key": "ui.fe08.mock.mail_07_sender", "recipient_key": "ui.fe08.mock.mail_07_recipient",
		"subject_key": "ui.fe08.mock.mail_07_subject", "body_key": "ui.fe08.mock.mail_07_body",
		"time_key": "ui.fe08.mock.mail_07_time", "is_read": true, "has_attachment": true, "is_claimed": true,
		"attachment_keys": ["ui.fe08.mock.mail_07_attach_0", "ui.fe08.mock.mail_07_attach_1"]
	},
	{
		"mail_id": "M_08", "category": "GUILD", "sender_key": "ui.fe08.mock.mail_08_sender", "recipient_key": "ui.fe08.mock.mail_08_recipient",
		"subject_key": "ui.fe08.mock.mail_08_subject", "body_key": "ui.fe08.mock.mail_08_body",
		"time_key": "ui.fe08.mock.mail_08_time", "is_read": true, "has_attachment": false, "is_claimed": false,
		"attachment_keys": []
	},
	{
		"mail_id": "M_09", "category": "PLAYER", "sender_key": "ui.fe08.mock.mail_09_sender", "recipient_key": "ui.fe08.mock.mail_09_recipient",
		"subject_key": "ui.fe08.mock.mail_09_subject", "body_key": "ui.fe08.mock.mail_09_body",
		"time_key": "ui.fe08.mock.mail_09_time", "is_read": true, "has_attachment": true, "is_claimed": true,
		"attachment_keys": ["ui.fe08.mock.mail_09_attach_0"]
	},
	{
		"mail_id": "M_10", "category": "REWARD", "sender_key": "ui.fe08.mock.mail_10_sender", "recipient_key": "ui.fe08.mock.mail_10_recipient",
		"subject_key": "ui.fe08.mock.mail_10_subject", "body_key": "ui.fe08.mock.mail_10_body",
		"time_key": "ui.fe08.mock.mail_10_time", "is_read": false, "has_attachment": true, "is_claimed": false,
		"attachment_keys": ["ui.fe08.mock.mail_10_attach_0", "ui.fe08.mock.mail_10_attach_1"]
	}
]

func setup(view: BaseScreen) -> void:
	_view = view

func init_static_text() -> void:
	var view: MailSystemView = _view
	var bindings := [
		[view.get_node_or_null("MainLayout/HeaderPanel/HeaderHBox/TitleLabel"), "ui.fe08.header.title"],
		[view._btn_back, "ui.fe08.header.back"],
		[view._btn_select_all, "ui.fe08.btn.select_all"],
		[view._btn_batch_delete, "ui.fe08.btn.batch_delete"],
		[view._btn_claim_all, "ui.fe08.btn.claim_all"],
		[view.get_node_or_null("MainLayout/ContentSplit/RightPanel/RightTabContainer/邮件详情/AttachmentSection/LabelAttachmentTitle"), "ui.fe08.detail.attachment_title"],
		[view._btn_claim_attachment, "ui.fe08.btn.claim_attachment"],
		[view._btn_reply, "ui.fe08.btn.reply"],
		[view._btn_delete_mail, "ui.fe08.btn.delete"],
		[view.get_node_or_null("MainLayout/ContentSplit/RightPanel/RightTabContainer/写邮件/ComposeTitle"), "ui.fe08.compose.title"],
		[view.get_node_or_null("MainLayout/ContentSplit/RightPanel/RightTabContainer/写邮件/RecipientRow/Label"), "ui.fe08.compose.recipient_label"],
		[view.get_node_or_null("MainLayout/ContentSplit/RightPanel/RightTabContainer/写邮件/SubjectRow/Label"), "ui.fe08.compose.subject_label"],
		[view.get_node_or_null("MainLayout/ContentSplit/RightPanel/RightTabContainer/写邮件/BodyLabel"), "ui.fe08.compose.body_label"],
		[view._btn_add_attachment, "ui.fe08.btn.add_attachment"],
		[view._btn_send, "ui.fe08.btn.send"],
		[view._btn_save_draft, "ui.fe08.btn.save_draft"]
	]
	for b in bindings:
		if b[0] != null:
			UIIntermediary.resolve(b[0], b[1])

	if view._search_edit != null:
		UIIntermediary.resolve_placeholder(view._search_edit, "ui.fe08.search.placeholder")
	KTabBar.init_titles(view._right_tab_container, PackedStringArray(["ui.fe08.tab.detail", "ui.fe08.tab.compose"]))
	if view._line_edit_recipient != null:
		UIIntermediary.resolve_placeholder(view._line_edit_recipient, "ui.fe08.compose.recipient_ph")
	if view._line_edit_subject != null:
		UIIntermediary.resolve_placeholder(view._line_edit_subject, "ui.fe08.compose.subject_ph")
	if view._text_edit_body != null:
		view._text_edit_body.placeholder_text = UIIntermediary.text("ui.fe08.compose.body_ph")

func setup_category_tabs() -> void:
	var view: MailSystemView = _view
	view._category_tab_bar.clear_tabs()
	view._category_tab_bar.add_tab(UIIntermediary.text("ui.fe08.category.all"))
	view._category_tab_bar.add_tab(UIIntermediary.text("ui.fe08.category.system"))
	view._category_tab_bar.add_tab(UIIntermediary.text("ui.fe08.category.reward"))
	view._category_tab_bar.add_tab(UIIntermediary.text("ui.fe08.category.guild"))
	view._category_tab_bar.add_tab(UIIntermediary.text("ui.fe08.category.player"))
	view._category_tab_bar.current_tab = 0

func category_code(tab_index: int) -> String:
	match tab_index:
		1: return "SYSTEM"
		2: return "REWARD"
		3: return "GUILD"
		4: return "PLAYER"
		_: return ""

func init_mail_compose() -> void:
	var view: MailSystemView = _view
	view._line_edit_recipient.text = ""
	view._line_edit_subject.text = ""
	view._text_edit_body.text = ""
	clear_container_children(view._compose_attachment_list)

func clear_container_children(container: Node) -> void:
	if container == null:
		return
	for child in container.get_children():
		child.queue_free()

func on_reply() -> void:
	var view: MailSystemView = _view
	var filtered: Array = view._get_filtered_mails()
	var idx: PackedInt32Array = view._mail_item_list.get_selected_items()
	if idx.size() > 0 and idx[0] < filtered.size():
		var mail: Dictionary = filtered[idx[0]]
		view._line_edit_recipient.text = UIIntermediary.text(str(mail.get("sender_key", "")))
		view._line_edit_subject.text = "Re: %s" % UIIntermediary.text(str(mail.get("subject_key", "")))
		view._right_tab_container.current_tab = 1

func on_add_attachment() -> void:
	var view: MailSystemView = _view
	var lbl := Label.new()
	lbl.text = UIIntermediary.text("ui.fe08.compose.attachment_item", {"count": view._compose_attachment_list.get_child_count() + 1})
	view._compose_attachment_list.add_child(lbl)

func on_send() -> void:
	var view: MailSystemView = _view
	var recipient: String = view._line_edit_recipient.text.strip_edges()
	var subject: String = view._line_edit_subject.text.strip_edges()
	if recipient.is_empty() or subject.is_empty():
		return
	init_mail_compose()
	view._right_tab_container.current_tab = 0

func on_save_draft() -> void:
	pass

## 初始化虚拟列表并配置对象池 (ADV-POOL-001)
func init_virtual_list(container: Control = null) -> KVirtualList:
	if virtual_list == null:
		virtual_list = KVirtualListClass.new()
		virtual_list.name = "MailVirtualList"
		virtual_list.item_height = 48.0
		virtual_list.buffer_count = 3
		virtual_list.range_changed.connect(_on_virtual_range_changed)
		if container != null:
			container.add_child(virtual_list)
	return virtual_list

## 刷新虚拟列表总数
func sync_virtual_list(count: int) -> void:
	if virtual_list == null:
		init_virtual_list()
	virtual_list.set_total_count(count)

func _on_virtual_range_changed(start_idx: int, end_idx: int) -> void:
	if _view == null or virtual_list == null or start_idx < 0:
		return
	var filtered: Array = _view._get_filtered_mails()
	for i in range(start_idx, end_idx + 1):
		if i < filtered.size():
			var row: Control = virtual_list.acquire_row_for_index(i)
			var mail: Dictionary = filtered[i]
			if row is KVirtualList.KVirtualRow:
				var vrow := row as KVirtualList.KVirtualRow
				vrow.bound_key = str(mail.get("mail_id", ""))
				vrow.bound_data = mail

## 统一页面标题栏构建
func create_page_header(title_key: String) -> KPageHeader:
	if page_header == null:
		page_header = KPageHeaderClass.new()
		page_header.title_key = title_key
		page_header.back_pressed.connect(func(): if _view != null: _view.back())
	return page_header

## 统一分栏面板构建
func create_split_panel(ratio: float = 0.4) -> KSplitPanel:
	if split_panel == null:
		split_panel = KSplitPanelClass.new()
		split_panel.left_ratio = ratio
	return split_panel

## 统一定制搜索框构建 (300ms 防抖)
func create_search_bar(placeholder_key: String = "ui.fe08.search.placeholder") -> KSearchBar:
	if search_bar == null:
		search_bar = KSearchBarClass.new()
		search_bar.placeholder_key = placeholder_key
	return search_bar

## 统一状态面板构建 (四态切换)
func create_state_panel() -> KStatePanel:
	if state_panel == null:
		state_panel = KStatePanelClass.new()
	return state_panel

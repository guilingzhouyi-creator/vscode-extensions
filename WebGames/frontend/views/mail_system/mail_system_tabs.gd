# ==============================================================================
# 模块归属: 前端邮件视图域 (fe08 邮件系统子面板委托)
# 文件路径: res://frontend/views/mail_system/mail_system_tabs.gd
# 架构定位: BaseScreen 附属委托控制器；管理邮件分类页签、静态文案、写信与虚拟列表
# 依赖与触发: 依赖 MailSystemView、UIIntermediary、KVirtualList 与基础通用组件
# 职责说明: 初始化分类与提示文案，提供回复、添加附件、发送与虚拟列表行绑定复用
# 退出语义与设计依据: 随 MailSystemView 生命周期由 _register_owned_subcontroller 统一清理
# ==============================================================================
## 邮件系统子面板委托控制器，负责分类页签、写信面板与邮件虚拟列表绑定。
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

var _view: Variant = null

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

## 绑定宿主邮件视图实例。
func setup(host_view: BaseScreen) -> void:
	_view = host_view

## 初始化邮件系统主副面板全部静态文案与输入提示。
func init_static_text() -> void:
	var mail_view: MailSystemView = _view
	var bindings := [
		[mail_view.get_node_or_null("MainLayout/HeaderPanel/HeaderHBox/TitleLabel"), "ui.fe08.header.title"],
		[mail_view._back_button, "ui.fe08.header.back"],
		[mail_view._select_all_button, "ui.fe08.btn.select_all"],
		[mail_view._batch_delete_button, "ui.fe08.btn.batch_delete"],
		[mail_view._claim_all_button, "ui.fe08.btn.claim_all"],
		[mail_view.get_node_or_null("MainLayout/ContentSplit/RightPanel/RightTabContainer/邮件详情/AttachmentSection/LabelAttachmentTitle"), "ui.fe08.detail.attachment_title"],
		[mail_view._claim_attachment_button, "ui.fe08.btn.claim_attachment"],
		[mail_view._reply_button, "ui.fe08.btn.reply"],
		[mail_view._delete_mail_button, "ui.fe08.btn.delete"],
		[mail_view.get_node_or_null("MainLayout/ContentSplit/RightPanel/RightTabContainer/写邮件/ComposeTitle"), "ui.fe08.compose.title"],
		[mail_view.get_node_or_null("MainLayout/ContentSplit/RightPanel/RightTabContainer/写邮件/RecipientRow/Label"), "ui.fe08.compose.recipient_label"],
		[mail_view.get_node_or_null("MainLayout/ContentSplit/RightPanel/RightTabContainer/写邮件/SubjectRow/Label"), "ui.fe08.compose.subject_label"],
		[mail_view.get_node_or_null("MainLayout/ContentSplit/RightPanel/RightTabContainer/写邮件/BodyLabel"), "ui.fe08.compose.body_label"],
		[mail_view._add_attachment_button, "ui.fe08.btn.add_attachment"],
		[mail_view._send_button, "ui.fe08.btn.send"],
		[mail_view._save_draft_button, "ui.fe08.btn.save_draft"]
	]
	for binding_entry in bindings:
		if binding_entry[0] != null:
			UIIntermediary.resolve(binding_entry[0], binding_entry[1])

	if mail_view._search_edit != null:
		UIIntermediary.resolve_placeholder(mail_view._search_edit, "ui.fe08.search.placeholder")
	KTabBar.init_titles(mail_view._right_tab_container, PackedStringArray(["ui.fe08.tab.detail", "ui.fe08.tab.compose"]))
	if mail_view._line_edit_recipient != null:
		UIIntermediary.resolve_placeholder(mail_view._line_edit_recipient, "ui.fe08.compose.recipient_ph")
	if mail_view._line_edit_subject != null:
		UIIntermediary.resolve_placeholder(mail_view._line_edit_subject, "ui.fe08.compose.subject_ph")
	if mail_view._text_edit_body != null:
		mail_view._text_edit_body.placeholder_text = UIIntermediary.text("ui.fe08.compose.body_ph")

## 初始化邮件分类页签栏（全部/系统/奖励/公会/玩家）。
func setup_category_tabs() -> void:
	var mail_view: MailSystemView = _view
	mail_view._category_tab_bar.clear_tabs()
	mail_view._category_tab_bar.add_tab(UIIntermediary.text("ui.fe08.category.all"))
	mail_view._category_tab_bar.add_tab(UIIntermediary.text("ui.fe08.category.system"))
	mail_view._category_tab_bar.add_tab(UIIntermediary.text("ui.fe08.category.reward"))
	mail_view._category_tab_bar.add_tab(UIIntermediary.text("ui.fe08.category.guild"))
	mail_view._category_tab_bar.add_tab(UIIntermediary.text("ui.fe08.category.player"))
	mail_view._category_tab_bar.current_tab = 0

## 将分类页签索引映射为邮件分类编码字符串。
func category_code(tab_index: int) -> String:
	match tab_index:
		1: return "SYSTEM"
		2: return "REWARD"
		3: return "GUILD"
		4: return "PLAYER"
		_: return ""

## 清空写信表单与待发送附件列表。
func init_mail_compose() -> void:
	var mail_view: MailSystemView = _view
	mail_view._line_edit_recipient.text = ""
	mail_view._line_edit_subject.text = ""
	mail_view._text_edit_body.text = ""
	clear_container_children(mail_view._compose_attachment_list)

## 释放指定容器节点的全部子控件。
func clear_container_children(container: Node) -> void:
	if container == null:
		return
	for child in container.get_children():
		child.queue_free()

## 处理回复按钮：根据当前选中邮件填充收件人与主题并切至写信页签。
func on_reply() -> void:
	var mail_view: MailSystemView = _view
	var filtered_mails: Array = mail_view._get_filtered_mails()
	var selected_indices: PackedInt32Array = mail_view._mail_item_list.get_selected_items()
	if selected_indices.size() > 0 and selected_indices[0] < filtered_mails.size():
		var mail_entry: Dictionary = filtered_mails[selected_indices[0]]
		mail_view._line_edit_recipient.text = UIIntermediary.text(str(mail_entry.get("sender_key", "")))
		mail_view._line_edit_subject.text = UIIntermediary.text("ui.fe08.reply.subject_prefix", {"subject": UIIntermediary.text(str(mail_entry.get("subject_key", "")))})
		mail_view._right_tab_container.current_tab = 1

## 处理添加附件按钮：向写信附件区追加展示标签。
func on_add_attachment() -> void:
	var mail_view: MailSystemView = _view
	var attachment_label := Label.new()
	attachment_label.text = UIIntermediary.text("ui.fe08.compose.attachment_item", {"count": mail_view._compose_attachment_list.get_child_count() + 1})
	mail_view._compose_attachment_list.add_child(attachment_label)

## 处理发送按钮：校验非空收件人与主题后重置写信面板并切回详情页。
func on_send() -> void:
	var mail_view: MailSystemView = _view
	var recipient: String = mail_view._line_edit_recipient.text.strip_edges()
	var subject: String = mail_view._line_edit_subject.text.strip_edges()
	if recipient.is_empty() or subject.is_empty():
		return
	init_mail_compose()
	mail_view._right_tab_container.current_tab = 0

## 响应保存草稿按钮点击事件。
func on_save_draft() -> void:
	pass

## 初始化虚拟列表并配置对象池 (ADV-POOL-001)
func init_virtual_list(container: Control = null) -> KVirtualList:
	if virtual_list == null:
		virtual_list = KVirtualListClass.new()
		virtual_list.name = "MailVirtualList"
		virtual_list.item_height = 48.0
		virtual_list.buffer_count = 3
		connect_managed(virtual_list.range_changed, _on_virtual_range_changed)
		if container != null:
			container.add_child(virtual_list)
	return virtual_list

## 刷新虚拟列表总数
func sync_virtual_list(total_count: int) -> void:
	if virtual_list == null:
		init_virtual_list()
	virtual_list.set_total_count(total_count)

func _on_virtual_range_changed(start_index: int, end_index: int) -> void:
	if _view == null or virtual_list == null or start_index < 0:
		return
	var filtered_mails: Array = _view._get_filtered_mails()
	for mail_index in range(start_index, end_index + 1):
		if mail_index < filtered_mails.size():
			var row: Control = virtual_list.acquire_row_for_index(mail_index)
			var mail_entry: Dictionary = filtered_mails[mail_index]
			if row is KVirtualList.KVirtualRow:
				var virtual_row := row as KVirtualList.KVirtualRow
				virtual_row.bound_key = str(mail_entry.get("mail_id", ""))
				virtual_row.bound_data = mail_entry

## 统一页面标题栏构建
func create_page_header(title_key: String) -> KPageHeader:
	page_header = _ensure_page_header(page_header, KPageHeaderClass, title_key, _view) as KPageHeader
	return page_header

## 统一分栏面板构建
func create_split_panel(split_ratio: float = 0.4) -> KSplitPanel:
	split_panel = _ensure_split_panel(split_panel, KSplitPanelClass, split_ratio) as KSplitPanel
	return split_panel

## 统一定制搜索框构建 (300ms 防抖)
func create_search_bar(placeholder_key: String = "ui.fe08.search.placeholder") -> KSearchBar:
	search_bar = _ensure_search_bar(search_bar, KSearchBarClass, placeholder_key) as KSearchBar
	return search_bar

## 统一状态面板构建 (四态切换)
func create_state_panel() -> KStatePanel:
	state_panel = _ensure_state_panel(state_panel, KStatePanelClass) as KStatePanel
	return state_panel

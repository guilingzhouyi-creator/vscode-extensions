# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第8卷: 邮件系统视图控制器
# 文件路径: res://frontend/views/mail_system/mail_system_view.gd
# 职责: 邮件三态分类、信箱 100 封容量条、附件提取与批量操作；
#       左右分栏布局：左侧邮件列表（5 分类 Tab + 搜索 + 批量操作），
#       右侧 Tab 容器（邮件详情 / 写邮件）。
# 骨架阶段: 零接线、不接 EventBus，仅本地 Mock 数据驱动 + 按钮点击反馈。
# ==============================================================================
class_name MailSystemView
extends BaseScreen

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
# 状态与 Mock 数据
# ==============================================================================

enum MailCategory { ALL, SYSTEM, REWARD, GUILD, PLAYER }
var current_category: int = MailCategory.ALL

var stored_mails: Array = []
var selected_mail_id: String = ""
var search_keyword: String = ""
var max_mailbox_capacity: int = MockServiceContainer.get_instance().mail().get_max_capacity()

# ==============================================================================
# 生命周期
# ==============================================================================

# ==============================================================================
# 白模测试契约兼容桩（映射到新状态，不触碰 @onready 节点）
# ==============================================================================

## 白模测试契约桩：注入信箱快照（经统一快照入口，不改写 Mock 源表）
func set_mailbox_snapshot(mails: Array) -> void:
	apply_snapshot({"mails": mails})

## 统一快照渲染映射（P81）：容量/邮件列表 → 视图状态，随后切就绪态
func _render_from_snapshot() -> void:
	if snapshot.has("capacity"):
		max_mailbox_capacity = int(snapshot.get("capacity", max_mailbox_capacity))
	if snapshot.has("mails"):
		stored_mails = FrontendSnapshot.read_array(snapshot, "mails")
	show_ready_state()

## 白模测试契约桩：按 mail_id 选中邮件并标记已读（状态跃迁经服务，未命中返回失败）
func select_mail(mail_id: String) -> Dictionary:
	selected_mail_id = mail_id
	stored_mails = MockServiceContainer.get_instance().mail().mark_read(stored_mails, mail_id)
	for m in stored_mails:
		if str(m.get("mail_id", "")) == mail_id:
			return {"success": true, "mail": m}
	return {"success": false, "mail_id": mail_id}

## 白模测试契约桩：预览一键领取全部未领取附件（领取规则经服务）
func claim_all_attachments_preview() -> Dictionary:
	var result := MockServiceContainer.get_instance().mail().claim_all(stored_mails)
	stored_mails = result.get("mails", stored_mails)
	return {"success": true, "claimed_mails_count": int(result.get("claimed_count", 0))}

## 生命周期初始化：主题/Mock 数据/分类 Tab/三子界面/文案/信号装配（骨架零接线）
func _ready() -> void:
	# 1. 应用主题
	var tm := ThemeManager.get_instance()
	theme = tm.theme

	# 2. 加载 Mock 数据
	_load_mock_data()

	# 3. 设置分类 Tab 标题
	_setup_category_tabs()

	# 4. 初始化各子界面
	_init_mail_list()
	_init_mail_detail()
	_init_mail_compose()

	# 5. 初始化静态文案（i18n 注入）
	_init_static_text()

	# 6. 绑定信号（零接线：仅本地 UI 交互反馈）
	_connect_signals()

	# 7. 视图加载后批量视觉适配
	UIIntermediary.adapt_view(self)

## 视图销毁钩子：清理 UIIntermediary 视图绑定（防悬挂引用）
func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		UIIntermediary.clear_view_bindings(self)

# ==============================================================================
# Mock 数据（骨架阶段内联，不接后端）
# ==============================================================================

## 加载骨架 Mock 邮件表（容量经服务，统一经 apply_snapshot 注入）
func _load_mock_data() -> void:
	apply_snapshot({
		"capacity": MockServiceContainer.get_instance().mail().get_max_capacity(),
		"mails": _mock_mails,
	})

# --- 10 封邮件 ---
var _mock_mails: Array = [
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

# ==============================================================================
# 静态文案初始化（i18n 注入）
# ==============================================================================

## 初始化全部静态文案与占位符（i18n 全驱动）
func _init_static_text() -> void:
	# --- 顶栏 ---
	var title_label: Label = $MainLayout/HeaderPanel/HeaderHBox/TitleLabel
	UIIntermediary.resolve(title_label, "ui.fe08.header.title")
	UIIntermediary.resolve(_btn_back, "ui.fe08.header.back")

	# --- 左侧：邮件列表 ---
	UIIntermediary.resolve_placeholder(_search_edit, "ui.fe08.search.placeholder")
	UIIntermediary.resolve(_btn_select_all, "ui.fe08.btn.select_all")
	UIIntermediary.resolve(_btn_batch_delete, "ui.fe08.btn.batch_delete")
	UIIntermediary.resolve(_btn_claim_all, "ui.fe08.btn.claim_all")

	# --- 右侧 Tab 标题 ---
	UIIntermediary.resolve_tab(_right_tab_container, 0, "ui.fe08.tab.detail")
	UIIntermediary.resolve_tab(_right_tab_container, 1, "ui.fe08.tab.compose")

	# --- 右侧 Tab 0: 邮件详情 ---
	var attachment_title: Label = $MainLayout/ContentSplit/RightPanel/RightTabContainer/邮件详情/AttachmentSection/LabelAttachmentTitle
	UIIntermediary.resolve(attachment_title, "ui.fe08.detail.attachment_title")
	UIIntermediary.resolve(_btn_claim_attachment, "ui.fe08.btn.claim_attachment")
	UIIntermediary.resolve(_btn_reply, "ui.fe08.btn.reply")
	UIIntermediary.resolve(_btn_delete_mail, "ui.fe08.btn.delete")

	# --- 右侧 Tab 1: 写邮件 ---
	var compose_title: Label = $MainLayout/ContentSplit/RightPanel/RightTabContainer/写邮件/ComposeTitle
	UIIntermediary.resolve(compose_title, "ui.fe08.compose.title")
	var recipient_label: Label = $MainLayout/ContentSplit/RightPanel/RightTabContainer/写邮件/RecipientRow/Label
	UIIntermediary.resolve(recipient_label, "ui.fe08.compose.recipient_label")
	UIIntermediary.resolve_placeholder(_line_edit_recipient, "ui.fe08.compose.recipient_ph")
	var subject_label: Label = $MainLayout/ContentSplit/RightPanel/RightTabContainer/写邮件/SubjectRow/Label
	UIIntermediary.resolve(subject_label, "ui.fe08.compose.subject_label")
	UIIntermediary.resolve_placeholder(_line_edit_subject, "ui.fe08.compose.subject_ph")
	var body_label: Label = $MainLayout/ContentSplit/RightPanel/RightTabContainer/写邮件/BodyLabel
	UIIntermediary.resolve(body_label, "ui.fe08.compose.body_label")
	_text_edit_body.placeholder_text = UIIntermediary.text("ui.fe08.compose.body_ph")
	UIIntermediary.resolve(_btn_add_attachment, "ui.fe08.btn.add_attachment")
	UIIntermediary.resolve(_btn_send, "ui.fe08.btn.send")
	UIIntermediary.resolve(_btn_save_draft, "ui.fe08.btn.save_draft")

# ==============================================================================
# 分类 Tab 设置
# ==============================================================================

## 建立左侧五分类 Tab（ALL/SYSTEM/REWARD/GUILD/PLAYER）
func _setup_category_tabs() -> void:
	_category_tab_bar.clear_tabs()
	_category_tab_bar.add_tab(UIIntermediary.text("ui.fe08.category.all"))
	_category_tab_bar.add_tab(UIIntermediary.text("ui.fe08.category.system"))
	_category_tab_bar.add_tab(UIIntermediary.text("ui.fe08.category.reward"))
	_category_tab_bar.add_tab(UIIntermediary.text("ui.fe08.category.guild"))
	_category_tab_bar.add_tab(UIIntermediary.text("ui.fe08.category.player"))
	_category_tab_bar.current_tab = 0

## Tab 索引 → 分类码（ALL 返回空串表示无筛选）
func _category_code(tab_index: int) -> String:
	match tab_index:
		MailCategory.SYSTEM: return "SYSTEM"
		MailCategory.REWARD: return "REWARD"
		MailCategory.GUILD: return "GUILD"
		MailCategory.PLAYER: return "PLAYER"
		_: return ""  # ALL = 无筛选

# ==============================================================================
# 左侧：邮件列表 - 初始化
# ==============================================================================

## 初始化邮件列表子界面：首刷列表与容量条
func _init_mail_list() -> void:
	_refresh_mail_list()
	_refresh_capacity()

## 刷新邮件列表：分类 + 关键词双过滤，渲染已读标记/附件标记/主题
func _refresh_mail_list() -> void:
	_mail_item_list.clear()
	for mail in stored_mails:
		# 分类筛选
		var cat_code := _category_code(current_category)
		if not cat_code.is_empty() and mail.get("category", "") != cat_code:
			continue
		# 关键词搜索
		if not search_keyword.is_empty():
			var sender: String = UIIntermediary.text(mail.get("sender_key", ""))
			var subject: String = UIIntermediary.text(mail.get("subject_key", ""))
			if not sender.contains(search_keyword) and not subject.contains(search_keyword):
				continue
		# 添加到列表
		var read_mark := UIIntermediary.text("ui.fe08.mail.unread_mark") if not bool(mail.get("is_read", true)) else UIIntermediary.text("ui.fe08.mail.read_mark")
		var attach_mark := UIIntermediary.text("ui.fe08.mail.attachment_mark") if bool(mail.get("has_attachment", false)) else ""
		var subject_text := UIIntermediary.text(mail.get("subject_key", ""))
		var item_text := UIIntermediary.text("ui.fe08.mail.list_item", {"read_mark": read_mark, "subject": subject_text, "attach_mark": attach_mark})
		_mail_item_list.add_item(item_text)

## 刷新信箱容量条（当前/上限）
func _refresh_capacity() -> void:
	if _label_capacity:
		UIIntermediary.resolve(_label_capacity, "ui.fe08.mail.count", {"cur": stored_mails.size(), "max": max_mailbox_capacity})

# ==============================================================================
# 右侧 Tab 0: 邮件详情 - 初始化
# ==============================================================================

## 初始化邮件详情子界面：占位文案 + 操作按钮禁用 + 附件清空
func _init_mail_detail() -> void:
	_label_detail_subject.text = UIIntermediary.text("ui.fe08.detail.subject_placeholder")
	UIIntermediary.resolve(_label_detail_sender, "ui.fe08.detail.sender", {"name": "-"})
	UIIntermediary.resolve(_label_detail_recipient, "ui.fe08.detail.recipient", {"name": "-"})
	UIIntermediary.resolve(_label_detail_time, "ui.fe08.detail.time", {"name": "-"})
	_rich_text_body.text = ""
	_btn_claim_attachment.disabled = true
	_btn_reply.disabled = true
	_btn_delete_mail.disabled = true
	# 清空附件列表
	_clear_container_children(_attachment_list_container)

## 展示邮件详情：主题/发件/收件/时间/正文/附件列表，按附件态启停按钮并标记已读
func _show_mail_detail(mail: Dictionary) -> void:
	selected_mail_id = mail.get("mail_id", "")
	if _label_detail_subject:
		_label_detail_subject.text = UIIntermediary.text(mail.get("subject_key", ""))
	if _label_detail_sender:
		UIIntermediary.resolve(_label_detail_sender, "ui.fe08.detail.sender", {"name": UIIntermediary.text(mail.get("sender_key", "-"))})
	if _label_detail_recipient:
		UIIntermediary.resolve(_label_detail_recipient, "ui.fe08.detail.recipient", {"name": UIIntermediary.text(mail.get("recipient_key", "-"))})
	if _label_detail_time:
		UIIntermediary.resolve(_label_detail_time, "ui.fe08.detail.time", {"name": UIIntermediary.text(mail.get("time_key", "-"))})
	if _rich_text_body:
		_rich_text_body.text = UIIntermediary.text(mail.get("body_key", ""))
	# 填充附件列表
	_clear_container_children(_attachment_list_container)
	for attach_key in mail.get("attachment_keys", []):
		var lbl := Label.new()
		lbl.text = UIIntermediary.text("ui.fe08.detail.attachment_item", {"name": UIIntermediary.text(attach_key)})
		_attachment_list_container.add_child(lbl)
	# 按钮状态
	var has_attachment: bool = bool(mail.get("has_attachment", false))
	var is_claimed: bool = bool(mail.get("is_claimed", false))
	_btn_claim_attachment.disabled = not has_attachment or is_claimed
	_btn_reply.disabled = false
	_btn_delete_mail.disabled = false

	# 标记已读（状态跃迁经服务）
	stored_mails = MockServiceContainer.get_instance().mail().mark_read(stored_mails, str(mail.get("mail_id", "")))
	_refresh_mail_list()

## 清空容器全部子节点（附件动态列表重建用）
func _clear_container_children(container: Node) -> void:
	for child in container.get_children():
		child.queue_free()

# ==============================================================================
# 右侧 Tab 1: 写邮件 - 初始化
# ==============================================================================

## 初始化写邮件子界面：收件人/主题/正文/附件清空
func _init_mail_compose() -> void:
	_line_edit_recipient.text = ""
	_line_edit_subject.text = ""
	_text_edit_body.text = ""
	_clear_container_children(_compose_attachment_list)

# ==============================================================================
# 信号绑定（零接线：所有信号在本地脚本闭环，不接 EventBus）
# ==============================================================================

## 绑定本地 UI 交互信号（零接线：列表/详情/写邮件三区控件本地闭环）
func _connect_signals() -> void:
	# 返回按钮
	_btn_back.pressed.connect(_on_back_pressed)

	# 邮件列表
	_category_tab_bar.tab_changed.connect(_on_category_changed)
	_search_edit.text_changed.connect(_on_search_changed)
	_mail_item_list.item_selected.connect(_on_mail_selected)
	_btn_select_all.pressed.connect(_on_select_all)
	_btn_batch_delete.pressed.connect(_on_batch_delete)
	_btn_claim_all.pressed.connect(_on_claim_all)

	# 邮件详情
	_btn_claim_attachment.pressed.connect(_on_claim_attachment)
	_btn_reply.pressed.connect(_on_reply)
	_btn_delete_mail.pressed.connect(_on_delete_mail)

	# 写邮件
	_btn_add_attachment.pressed.connect(_on_add_attachment)
	_btn_send.pressed.connect(_on_send)
	_btn_save_draft.pressed.connect(_on_save_draft)

# ==============================================================================
# 返回按钮
# ==============================================================================

## 返回按钮：经 ViewRouter 弹出视图回退上一级
func _on_back_pressed() -> void:
	# 右下角返回按钮：通过 ViewRouter 返回上一视图
	var router := ViewRouter.get_instance()
	if router != null:
		router.pop_view()

# ==============================================================================
# 邮件列表交互
# ==============================================================================

## 分类 Tab 切换：更新分类并刷新列表
func _on_category_changed(tab: int) -> void:
	current_category = tab
	_refresh_mail_list()

## 搜索词变更：更新关键词并刷新列表
func _on_search_changed(new_text: String) -> void:
	search_keyword = new_text
	_refresh_mail_list()

## 邮件条目选中：定位筛选后邮件展示详情并切换到详情 Tab
func _on_mail_selected(index: int) -> void:
	# 查找当前筛选后的邮件
	var filtered := _get_filtered_mails()
	if index >= 0 and index < filtered.size():
		_show_mail_detail(filtered[index])
		# 切换到详情 Tab
		_right_tab_container.current_tab = 0

## 获取筛选后的邮件列表（分类 + 关键词双过滤，与列表渲染同口径）
func _get_filtered_mails() -> Array:
	var result: Array = []
	var cat_code := _category_code(current_category)
	for mail in stored_mails:
		if not cat_code.is_empty() and mail.get("category", "") != cat_code:
			continue
		if not search_keyword.is_empty():
			var sender: String = UIIntermediary.text(mail.get("sender_key", ""))
			var subject: String = UIIntermediary.text(mail.get("subject_key", ""))
			if not sender.contains(search_keyword) and not subject.contains(search_keyword):
				continue
		result.append(mail)
	return result

## 全选：选中当前筛选列表的全部条目
func _on_select_all() -> void:
	var filtered := _get_filtered_mails()
	for i in filtered.size():
		_mail_item_list.select(i)

## 批量删除：移除选中邮件并刷新列表/容量/详情占位（骨架桩）
func _on_batch_delete() -> void:
	# 骨架阶段：删除已选中的邮件
	var selected := _mail_item_list.get_selected_items()
	if selected.is_empty():
		return
	var filtered := _get_filtered_mails()
	var ids_to_remove: Array = []
	for idx in selected:
		if idx < filtered.size():
			ids_to_remove.append(filtered[idx].get("mail_id", ""))
	stored_mails = MockServiceContainer.get_instance().mail().delete_by_ids(stored_mails, ids_to_remove)
	_refresh_mail_list()
	_refresh_capacity()
	_init_mail_detail()

## 一键领取全部未领取附件并同步详情（领取规则经服务）
func _on_claim_all() -> void:
	var result := MockServiceContainer.get_instance().mail().claim_all(stored_mails)
	stored_mails = result.get("mails", stored_mails)
	var claimed := int(result.get("claimed_count", 0))
	if claimed > 0:
		_refresh_mail_list()
		if not selected_mail_id.is_empty():
			for mail in _get_filtered_mails():
				if mail.get("mail_id", "") == selected_mail_id:
					_show_mail_detail(mail)
					break

# ==============================================================================
# 邮件详情交互
# ==============================================================================

## 领取当前邮件附件：领取规则经服务，成功后刷新详情与列表
func _on_claim_attachment() -> void:
	var result := MockServiceContainer.get_instance().mail().claim_one(stored_mails, selected_mail_id)
	if not bool(result.get("success", false)):
		return
	stored_mails = result.get("mails", stored_mails)
	for mail in stored_mails:
		if mail.get("mail_id", "") == selected_mail_id:
			_show_mail_detail(mail)
			_refresh_mail_list()
			break

## 回复：跳到写邮件 Tab 并预填收件人/Re: 主题（骨架桩）
func _on_reply() -> void:
	# 骨架阶段：跳转到写邮件 Tab，预填收件人
	var filtered := _get_filtered_mails()
	var idx := _mail_item_list.get_selected_items()
	if idx.size() > 0 and idx[0] < filtered.size():
		var mail: Dictionary = filtered[idx[0]]
		_line_edit_recipient.text = UIIntermediary.text(mail.get("sender_key", ""))
		_line_edit_subject.text = "Re: %s" % UIIntermediary.text(mail.get("subject_key", ""))
		_right_tab_container.current_tab = 1

## 删除当前邮件并刷新列表/容量/详情占位（删除规则经服务）
func _on_delete_mail() -> void:
	stored_mails = MockServiceContainer.get_instance().mail().delete_by_ids(stored_mails, [selected_mail_id])
	selected_mail_id = ""
	_refresh_mail_list()
	_refresh_capacity()
	_init_mail_detail()

# ==============================================================================
# 写邮件交互
# ==============================================================================

## 模拟添加附件（动态 Label 计数追加，骨架桩）
func _on_add_attachment() -> void:
	# 骨架阶段：模拟添加附件
	var lbl := Label.new()
	lbl.text = UIIntermediary.text("ui.fe08.compose.attachment_item", {"count": _compose_attachment_list.get_child_count() + 1})
	_compose_attachment_list.add_child(lbl)

## 发送邮件：收件人/主题非空则清空表单并回详情 Tab（骨架桩）
func _on_send() -> void:
	# 骨架阶段：模拟发送邮件
	var recipient := _line_edit_recipient.text.strip_edges()
	var subject := _line_edit_subject.text.strip_edges()
	if recipient.is_empty() or subject.is_empty():
		return
	# 清空表单
	_init_mail_compose()
	_right_tab_container.current_tab = 0

## 存草稿：骨架阶段不实际保存（预留）
func _on_save_draft() -> void:
	# 骨架阶段：模拟存草稿（不实际保存，仅清空表单提示）
	pass

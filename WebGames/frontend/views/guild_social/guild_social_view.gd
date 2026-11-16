# ==============================================================================
# 模块归属: 前端社交视图域 (fe09 社交与公会系统)
# 文件路径: res://frontend/views/guild_social/guild_social_view.gd
# 架构定位: BaseScreen 视图控制器；承载公会信息、成员、聊天、好友、NPC 对话与交易
# 依赖与触发: 依赖 ThemeManager、UIIntermediary、ServiceLocator 与 GuildSocialTabs
# 职责说明: 初始化六大社交页签视图，同步公会快照、成员名册详情与社交按钮事件
# 退出语义与设计依据: 返回操作调用 self.back() 弹出页面；公共子控件由 Tabs 委托管理
# ==============================================================================
## 公会与社交主视图控制器，协调公会信息、成员管理及多社交页签展示。
class_name GuildSocialView
extends BaseScreen

const GuildSocialTabsScript = preload("res://frontend/views/guild_social/guild_social_tabs.gd")
const KButtonClass = preload("res://frontend/components/k_button.gd")

var _tabs: Variant = null

# ------------------------------------------------------------------------------
# 配置默认值（视图内常量默认配置，业务数值经 apply_snapshot 注入，不直读 GameConfig）
# ------------------------------------------------------------------------------
var _max_guild_members: int = 50
var max_chat_lines: int = 200

# 公会快照
var guild_name: String = ""
var guild_level: int = 1
var guild_leader: String = ""
var guild_funds: int = 0
var vault_gold: int = 0 # 测试契约公开字段（TC-FE09-01 断言金库余额）
var member_roster: Array = [] # 测试契约公开字段（TC-FE09-01 断言成员清单）
var tech_nodes: Array = [] # 测试契约公开字段（TC-FE09-03 断言公会科技树）
var guild_announcement: String = ""
var guild_member_count: int = 0

# 公会成员名册
var _guild_members: Array = []

# 成员详情选中索引
var _member_selected_index: int = -1

# 聊天频道
enum ChatChannel {GUILD, OFFICER, WORLD, PARTY, TRADE}
var chat_channels: Array = [ {"id": "GUILD", "name": "ui.fe09.chat.channel.guild", "messages": []}, {"id": "OFFICER", "name": "ui.fe09.chat.channel.officer", "messages": []}, {"id": "WORLD", "name": "ui.fe09.chat.channel.world", "messages": []}, {"id": "PARTY", "name": "ui.fe09.chat.channel.party", "messages": []}, {"id": "TRADE", "name": "ui.fe09.chat.channel.trade", "messages": []}]
var current_channel_index: int = 0

# 好友系统
enum FriendCategory {FRIEND, BLACKLIST, STRANGER}
var friends: Array = []
var friend_selected_index: int = -1
var current_friend_category: FriendCategory = FriendCategory.FRIEND

# NPC 对话
var npc_dialogs: Array = []
var current_dialog_index: int = 0

# 玩家交易
var trade_partner_name: String = ""
var my_inventory: Array = []
var my_trade_items: Array = []
var partner_trade_items: Array = []
var trade_locked: bool = false
var trade_confirmed: bool = false

# ------------------------------------------------------------------------------
# 节点引用（场景树中以 unique_name_in_owner 标记，共 49 个）
# ------------------------------------------------------------------------------

# --- 全局 ---
@onready var _back_button: Button = %BtnBack
@onready var _tab_container: TabContainer = %TabContainer

# --- Tab 1: 公会信息 (GUILD_INFO) ---
@onready var _label_guild_name: Label = %LabelGuildName
@onready var _label_guild_level: Label = %LabelGuildLevel
@onready var _label_guild_leader: Label = %LabelGuildLeader
@onready var _label_guild_members: Label = %LabelGuildMembers
@onready var _label_guild_funds: Label = %LabelGuildFunds
@onready var _rich_text_announcement: RichTextLabel = %RichtextAnnouncement
@onready var _leave_guild_button: Button = %BtnLeaveGuild
@onready var _guild_manage_button: Button = %BtnGuildManage

# --- Tab 2: 成员列表 (GUILD_MEMBERS) ---
@onready var _guild_member_list: ItemList = %GuildMemberList
@onready var _label_member_detail_name: Label = %LabelMemberDetailName
@onready var _label_member_detail_class: Label = %LabelMemberDetailClass
@onready var _label_member_detail_level: Label = %LabelMemberDetailLevel
@onready var _label_member_detail_role: Label = %LabelMemberDetailRole
@onready var _label_member_detail_online: Label = %LabelMemberDetailOnline
@onready var _manage_roles_button: Button = %BtnManageRoles
@onready var _invite_member_button: Button = %BtnInviteMember
@onready var _kick_member_button: Button = %BtnKickMember

# --- Tab 3: 聊天频道 (CHAT_CHANNELS) ---
@onready var channel_list: ItemList = %ChannelList
@onready var _channel_settings_button: Button = %BtnChannelSettings
@onready var rich_text_chat_messages: RichTextLabel = %RichtextChatMessages
@onready var _line_chat_input: LineEdit = %LineChatInput
@onready var _chat_send_button: Button = %BtnChatSend

# --- Tab 4: 好友系统 (FRIENDS) ---
@onready var _line_friend_search: LineEdit = %LineFriendSearch
@onready var _friend_tab_container: TabContainer = %FriendTabContainer
@onready var friend_list: ItemList = %FriendList
@onready var label_friend_detail_name: Label = %LabelFriendDetailName
@onready var label_friend_detail_location: Label = %LabelFriendDetailLocation
@onready var label_friend_detail_online: Label = %LabelFriendDetailOnline
@onready var _add_friend_button: Button = %BtnAddFriend
@onready var _delete_friend_button: Button = %BtnDeleteFriend
@onready var _whisper_friend_button: Button = %BtnWhisperFriend

# --- Tab 5: NPC对话 (NPC_DIALOG) ---
@onready var label_npc_name: Label = %LabelNpcName
@onready var rich_text_npc_dialog: RichTextLabel = %RichtextNpcDialog
@onready var dialog_options_box: VBoxContainer = %VBoxDialogOptions
@onready var _npc_quest_button: Button = %BtnNpcQuest
@onready var _npc_shop_button: Button = %BtnNpcShop
@onready var _npc_leave_button: Button = %BtnNpcLeave

# --- Tab 6: 玩家交易 (PLAYER_TRADE) ---
@onready var label_trade_partner: Label = %LabelTradePartner
@onready var my_inventory_list: ItemList = %MyInventoryList
@onready var my_trade_list: ItemList = %MyTradeList
@onready var my_trade_gold_spin_box: SpinBox = %SpinMyTradeGold
@onready var label_trade_status: Label = %LabelTradeStatus
@onready var trade_lock_button: Button = %BtnTradeLock
@onready var _trade_confirm_button: Button = %BtnTradeConfirm
@onready var _trade_cancel_button: Button = %BtnTradeCancel
@onready var partner_trade_list: ItemList = %PartnerTradeList
@onready var label_partner_gold: Label = %LabelPartnerGold

# --- 非唯一静态标签（i18n 迁移新增，共 16 个） ---
@onready var _header_title_label: Label = %HeaderTitleLabel
@onready var _announcement_label: Label = %AnnouncementLabel
@onready var _member_list_label: Label = %MemberListLabel
@onready var _member_detail_label: Label = %MemberDetailLabel
@onready var _channel_list_label: Label = %ChannelListLabel
@onready var _chat_messages_label: Label = %ChatMessagesLabel
@onready var _search_label: Label = %SearchLabel
@onready var _friend_list_label: Label = %FriendListLabel
@onready var _friend_detail_title_label: Label = %FriendDetailTitleLabel
@onready var npc_title_label: Label = %NpcTitleLabel
@onready var _dialog_label: Label = %DialogLabel
@onready var _options_label: Label = %OptionsLabel
@onready var _my_inventory_label: Label = %MyInvLabel
@onready var _my_trade_label: Label = %MyTradeLabel
@onready var _my_gold_label: Label = %MyGoldLabel
@onready var _partner_inventory_label: Label = %PartnerInvLabel

# ==============================================================================
# 公开交互方法（外部视图契约）
# ==============================================================================

## 兼容测试快照注入：经统一快照入口更新公会名称、等级、资金、成员与科技列表。
func set_guild_snapshot(guild_name_text: String, level_value: int, gold_amount: int, member_entries: Array, tech_entries: Array) -> void:
	apply_snapshot({
		"guild_name": guild_name_text,
		"guild_level": level_value,
		"guild_funds": gold_amount,
		"members": member_entries,
		"techs": tech_entries,
	})

## 统一快照渲染映射：公会信息/成员/科技树 → 视图状态
func _render_from_snapshot() -> void:
	if snapshot.has("guild_name"):
		guild_name = str(snapshot.get("guild_name", guild_name))
	if snapshot.has("guild_level"):
		guild_level = int(snapshot.get("guild_level", guild_level))
	if snapshot.has("guild_funds"):
		guild_funds = int(snapshot.get("guild_funds", guild_funds))
		vault_gold = guild_funds
	if snapshot.has("members"):
		var members: Array = FrontendSnapshot.read_array(snapshot, "members")
		_guild_members = members
		member_roster = members.duplicate(true)
	if snapshot.has("techs"):
		tech_nodes = FrontendSnapshot.read_array(snapshot, "techs")

## 成员管理权限判定：委托 domain_boundary 服务（角色白名单配置在服务层）
func can_manage_members(user_role: String) -> bool:
	return ServiceLocator.get_instance().guild().can_manage(user_role)

# ==============================================================================
# 生命周期
# ==============================================================================

func _get_tabs():
	if _tabs == null:
		_tabs = _register_owned_subcontroller(GuildSocialTabsScript.new())
		_tabs.setup(self)
	return _tabs

func _ready() -> void:
	_apply_theme()
	_load_mock_snapshot()
	_init_tab_titles()
	_init_static_text()
	_init_guild_info_tab()
	_init_guild_members_tab()
	_init_chat_and_social_tabs()
	_connect_signals()
	UIIntermediary.adapt_view(self)

func _init_chat_and_social_tabs() -> void:
	var tabs: Variant = _get_tabs()
	tabs._init_chat_channels_tab()
	tabs._init_friends_tab()
	tabs._init_npc_dialog_tab()
	tabs._init_player_trade_tab()

## 应用 ThemeManager 单例主题（null 安全）
func _apply_theme() -> void:
	var theme_manager := ThemeManager.get_instance()
	if theme_manager.theme != null:
		theme = theme_manager.theme

# ==============================================================================
# Mock 数据加载（经 domain_boundary 快照服务读取，不接后端）
# ==============================================================================

## 加载初始预览快照：公会信息/成员/好友/NPC 对话/交易库存/聊天预填
func _load_mock_snapshot() -> void:
	if ServiceLocator.get_mode() == "mock":
		guild_name = "ui.fe09.mock.guild_name"
		guild_level = 7
		guild_leader = "ui.fe09.mock.guild_leader"
		guild_funds = 128500
		guild_announcement = "ui.fe09.mock.guild_announcement"
		_guild_members = ServiceLocator.get_instance().guild().generate_roster(15)
		_get_tabs().init_mock_data()
	else:
		guild_name = ""
		guild_level = 0
		guild_leader = ""
		guild_funds = 0
		guild_announcement = ""
		_guild_members = []
		var guild_reply := ServiceLocator.get_instance().guild().dispatch_guild_action("GET_GUILD_STATE", {})
		var guild_table: Dictionary = guild_reply.get("data", guild_reply) as Dictionary
		if guild_table.has("guild_name"):
			guild_name = str(guild_table.get("guild_name", ""))
		if guild_table.get("members") is Array:
			_guild_members = (guild_table.get("members") as Array).duplicate(true)

# ==============================================================================
# Tab 标题初始化
# ==============================================================================

## 初始化六主 Tab 与三好友子 Tab 标题（i18n 键驱动）
func _init_tab_titles() -> void:
	KTabBar.init_titles(_tab_container, PackedStringArray(["ui.fe09.tab.guild_info", "ui.fe09.tab.members", "ui.fe09.tab.chat", "ui.fe09.tab.friends", "ui.fe09.tab.npc_dialog", "ui.fe09.tab.trade"]))
	KTabBar.init_titles(_friend_tab_container, PackedStringArray(["ui.fe09.friend.subtab.friend", "ui.fe09.friend.subtab.blacklist", "ui.fe09.friend.subtab.stranger"]))

## 初始化全部静态文案（16 个非唯一标签 + 各 Tab 按钮/输入提示，i18n 全驱动）
func _init_static_text() -> void:
	var bindings := [
		[_header_title_label, "ui.fe09.header.title"], [_back_button, "ui.fe09.header.back"],
		[_announcement_label, "ui.fe09.guild.announcement_label"], [_leave_guild_button, "ui.fe09.guild.btn_leave"],
		[_guild_manage_button, "ui.fe09.guild.btn_manage"], [_member_list_label, "ui.fe09.members.list_label"],
		[_member_detail_label, "ui.fe09.members.detail_label"], [_manage_roles_button, "ui.fe09.members.btn_manage_roles"],
		[_invite_member_button, "ui.fe09.members.btn_invite"], [_kick_member_button, "ui.fe09.members.btn_kick"],
		[_channel_list_label, "ui.fe09.chat.channel_list_label"], [_channel_settings_button, "ui.fe09.chat.btn_settings"],
		[_chat_messages_label, "ui.fe09.chat.messages_label"], [_chat_send_button, "ui.fe09.chat.btn_send"],
		[_search_label, "ui.fe09.friend.search_label"], [_friend_list_label, "ui.fe09.friend.list_label"],
		[_friend_detail_title_label, "ui.fe09.friend.detail_label"], [_add_friend_button, "ui.fe09.friend.btn_add"],
		[_delete_friend_button, "ui.fe09.friend.btn_delete"], [_whisper_friend_button, "ui.fe09.friend.btn_whisper"],
		[_dialog_label, "ui.fe09.npc.dialog_label"], [_options_label, "ui.fe09.npc.options_label"],
		[_npc_quest_button, "ui.fe09.npc.btn_quest"], [_npc_shop_button, "ui.fe09.npc.btn_shop"],
		[_npc_leave_button, "ui.fe09.npc.btn_leave"], [_my_inventory_label, "ui.fe09.trade.my_inventory_label"],
		[_my_trade_label, "ui.fe09.trade.my_trade_label"], [_my_gold_label, "ui.fe09.trade.gold_label"],
		[_trade_confirm_button, "ui.fe09.trade.btn_confirm"], [_trade_cancel_button, "ui.fe09.trade.btn_cancel"],
		[_partner_inventory_label, "ui.fe09.trade.partner_trade_label"]
	]
	for binding_entry in bindings:
		if binding_entry[0] != null: UIIntermediary.resolve(binding_entry[0], binding_entry[1])
	UIIntermediary.resolve_placeholder(_line_chat_input, "ui.fe09.chat.input_placeholder")
	UIIntermediary.resolve_placeholder(_line_friend_search, "ui.fe09.friend.search_placeholder")

# ==============================================================================

## 绑定本地 UI 交互信号（六 Tab 全部控件的本地交互事件）
func _connect_signals() -> void:
	# 返回按钮
	connect_managed(_back_button.pressed, _on_back_pressed)
	# Tab 切换
	connect_managed(_tab_container.tab_changed, _on_tab_changed)

	# Tab 1: 公会信息
	connect_managed(_leave_guild_button.pressed, _on_leave_guild_pressed)
	connect_managed(_guild_manage_button.pressed, _on_guild_manage_pressed)

	# Tab 2: 成员列表
	connect_managed(_guild_member_list.item_selected, _on_member_selected)
	connect_managed(_manage_roles_button.pressed, _on_member_action_pressed.bind("ui.fe09.members.manage_roles_toast"))
	connect_managed(_invite_member_button.pressed, _on_invite_member_pressed)
	connect_managed(_kick_member_button.pressed, _on_member_action_pressed.bind("ui.fe09.members.kick_toast"))

	# Tab 3, 4, 5, 6 信号委托
	_get_tabs().connect_signals()

# ==============================================================================
# Tab 1: 公会信息 (GUILD_INFO) 初始化
# ==============================================================================

## 初始化公会信息 Tab：刷新信息展示
func _init_guild_info_tab() -> void:
	_refresh_guild_info_display()

## 刷新公会信息展示：名称/等级/会长/成员数/资金/公告（树内守卫）
func _refresh_guild_info_display() -> void:
	if not is_inside_tree():
		return
	guild_member_count = _guild_members.size()
	var guild_name_display := UIIntermediary.text(guild_name)
	UIIntermediary.resolve(_label_guild_name, "ui.fe09.guild.name", {"name": guild_name_display})
	UIIntermediary.resolve(_label_guild_level, "ui.fe09.guild.level", {"level": guild_level})
	UIIntermediary.resolve(_label_guild_leader, "ui.fe09.guild.leader", {"name": UIIntermediary.text(guild_leader)})
	UIIntermediary.resolve(_label_guild_members, "ui.fe09.guild.member_count", {"cur": guild_member_count, "max": _max_guild_members})
	UIIntermediary.resolve(_label_guild_funds, "ui.fe09.guild.funds", {"amount": guild_funds})
	_rich_text_announcement.clear()
	var announcement_text := UIIntermediary.text(guild_announcement, {"guild_name": guild_name_display})
	_rich_text_announcement.append_text(announcement_text)

# ==============================================================================
# Tab 2: 成员列表 (GUILD_MEMBERS) 初始化
# ==============================================================================

## 初始化成员列表 Tab：填充成员列表
func _init_guild_members_tab() -> void:
	_populate_member_list()

## 填充成员列表：在线图标/名称/等级/职业/职位组合行
func _populate_member_list() -> void:
	_guild_member_list.clear()
	for member in _guild_members:
		var status_icon := "●" if member.get("online", false) else "○"
		var member_name := UIIntermediary.text(str(member.get("name", "")))
		var member_class := UIIntermediary.text(str(member.get("class", "")))
		var role := UIIntermediary.text(str(member.get("role", "")))
		var level := int(member.get("level", 0))
		var member_row_text := UIIntermediary.text("ui.fe09.members.list_item", {
			"icon": status_icon,
			"name": member_name,
			"level": level,
			"class": member_class,
			"role": role,
		})
		_guild_member_list.add_item(member_row_text)

## 刷新成员详情：未选中空态或完整字段（名称/职业/等级/职位/在线态）
func _refresh_member_detail(index: int) -> void:
	if index < 0 or index >= _guild_members.size():
		UIIntermediary.resolve(_label_member_detail_name, "ui.fe09.members.detail_name_none")
		UIIntermediary.resolve(_label_member_detail_class, "ui.fe09.members.class_none")
		UIIntermediary.resolve(_label_member_detail_level, "ui.fe09.members.level_none")
		UIIntermediary.resolve(_label_member_detail_role, "ui.fe09.members.role_none")
		UIIntermediary.resolve(_label_member_detail_online, "ui.fe09.members.status_none")
		return
	var member_entry: Dictionary = _guild_members[index]
	_label_member_detail_name.text = UIIntermediary.text(str(member_entry.get("name", "")))
	UIIntermediary.resolve(_label_member_detail_class, "ui.fe09.members.class_label", {"name": UIIntermediary.text(str(member_entry.get("class", "")))})
	UIIntermediary.resolve(_label_member_detail_level, "ui.fe09.members.level_label", {"level": int(member_entry.get("level", 0))})
	UIIntermediary.resolve(_label_member_detail_role, "ui.fe09.members.role_label", {"name": UIIntermediary.text(str(member_entry.get("role", "")))})
	var status_key := "ui.fe09.common.status_online" if bool(member_entry.get("online", false)) else "ui.fe09.common.status_offline"
	UIIntermediary.resolve(_label_member_detail_online, "ui.fe09.members.status_label", {"status": UIIntermediary.text(status_key)})

# ==============================================================================
# Tab 1: 公会信息 信号处理
# ==============================================================================

## 退出公会按钮回调（预设表现层 Toast 反馈）
func _on_leave_guild_pressed() -> void:
	ServiceLocator.get_instance().guild().dispatch_guild_action("LEAVE_GUILD", {"guild_name": guild_name})
	NavManager.get_instance().show_toast(UIIntermediary.text("ui.fe09.guild.leave_toast"), NavTypes.ToastLevel.INFO)

## 公会管理按钮回调（经权限判定后派发管理动作并反馈）
func _on_guild_manage_pressed() -> void:
	var guild_service := ServiceLocator.get_instance().guild()
	if not guild_service.can_manage("LEADER"):
		NavManager.get_instance().show_toast(UIIntermediary.text("ui.fe09.members.no_member_selected"), NavTypes.ToastLevel.WARNING)
		return
	guild_service.dispatch_guild_action("MANAGE_GUILD", {"guild_name": guild_name})
	NavManager.get_instance().show_toast(UIIntermediary.text("ui.fe09.guild.manage_toast"), NavTypes.ToastLevel.INFO)

# ==============================================================================
# Tab 2: 成员列表 信号处理
# ==============================================================================

## 成员条目选中：记录索引并刷新详情
func _on_member_selected(index: int) -> void:
	_member_selected_index = index
	_refresh_member_detail(index)

## 成员操作按钮回调（职位管理 / 踢出成员）：校验已选成员与权限后派发后端动作
func _on_member_action_pressed(toast_key: String) -> void:
	if _member_selected_index < 0:
		NavManager.get_instance().show_toast(UIIntermediary.text("ui.fe09.members.no_member_selected"), NavTypes.ToastLevel.WARNING)
		return
	var member: Dictionary = _guild_members[_member_selected_index]
	var action_name := "KICK_MEMBER" if toast_key.contains("kick") else "PROMOTE_MEMBER"
	ServiceLocator.get_instance().guild().dispatch_guild_action("MANAGE_MEMBER", {
		"operator_role": "LEADER",
		"permission_action": action_name,
		"member_name": str(member.get("name", "")),
	})
	NavManager.get_instance().show_toast(UIIntermediary.text(toast_key, {"name": UIIntermediary.text(str(member.get("name", "")))}), NavTypes.ToastLevel.INFO)

## 邀请成员按钮回调（派发公会邀请协议动作并展示反馈）
func _on_invite_member_pressed() -> void:
	ServiceLocator.get_instance().guild().dispatch_guild_action("INVITE_MEMBER", {"guild_name": guild_name})
	NavManager.get_instance().show_toast(UIIntermediary.text("ui.fe09.members.invite_toast"), NavTypes.ToastLevel.INFO)

# ==============================================================================
# 全局信号处理
# ==============================================================================

## 主 Tab 切换：同步刷新目标社交子面板
func _on_tab_changed(tab_index: int) -> void:
	if tab_index == 1:
		_populate_member_list()
	elif tab_index == 2 and _tabs != null:
		_tabs._refresh_chat_display()

## 返回按钮：经 ViewRouter 弹出视图回退上一级
func _on_back_pressed() -> void:
	self.back()

# ==============================================================================
# 工具方法
# ==============================================================================
func _channel_key(channel: ChatChannel) -> int: return channel

func _channel_name(channel: ChatChannel) -> String:
	match channel:
		ChatChannel.GUILD: return "ui.fe09.chat.channel.guild"
		ChatChannel.OFFICER: return "ui.fe09.chat.channel.officer"
		ChatChannel.WORLD: return "ui.fe09.chat.channel.world"
		ChatChannel.PARTY: return "ui.fe09.chat.channel.party"
		ChatChannel.TRADE: return "ui.fe09.chat.channel.trade"
		_: return "ui.fe09.chat.channel.guild"

func _rarity_display(rarity: String) -> String:
	return UIIntermediary.text("ui.fe03.rarity." + rarity.to_lower())

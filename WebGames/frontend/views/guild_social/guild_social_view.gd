# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第9卷: 社交与公会系统视图控制器
# 文件路径: res://frontend/views/guild_social/guild_social_view.gd
# 职责: 公会管理(信息/成员RBAC/资金)、频道聊天、好友列表与NPC对话分支、玩家交易
# 骨架阶段：纯 UI 交互，Mock 数据驱动，不接 EventBus，所有逻辑本地闭环
# ==============================================================================
class_name GuildSocialView
extends BaseScreen

const KButtonClass = preload("res://frontend/components/k_button.gd")

# ------------------------------------------------------------------------------
# 配置默认值（骨架阶段视图内常量兜底，业务数值经 apply_snapshot 注入，不直读 GameConfig）
# ------------------------------------------------------------------------------
var _max_guild_members: int = 50
var _max_chat_lines: int = 200

# 公会快照
var guild_name: String = ""
var guild_level: int = 1
var guild_leader: String = ""
var guild_funds: int = 0
var vault_gold: int = 0    # 白模测试契约字段（TC-FE09-01 断言金库余额）
var member_roster: Array = [] # 白模测试契约字段（TC-FE09-01 断言成员清单）
var tech_nodes: Array = []  # 白模测试契约字段（TC-FE09-03 断言公会科技树）
var guild_announcement: String = ""
var guild_member_count: int = 0

# 公会成员名册
var _guild_members: Array = []

# 成员详情选中索引
var _member_selected_index: int = -1

# 聊天频道
enum ChatChannel { GUILD, OFFICER, WORLD, PARTY, TRADE }
var _chat_channels: Array = [
	{ "id": "GUILD", "name": "ui.fe09.chat.channel.guild", "messages": [] },
	{ "id": "OFFICER", "name": "ui.fe09.chat.channel.officer", "messages": [] },
	{ "id": "WORLD", "name": "ui.fe09.chat.channel.world", "messages": [] },
	{ "id": "PARTY", "name": "ui.fe09.chat.channel.party", "messages": [] },
	{ "id": "TRADE", "name": "ui.fe09.chat.channel.trade", "messages": [] },
]
var _current_channel_index: int = 0

# 好友系统
enum FriendCategory { FRIEND, BLACKLIST, STRANGER }
var _friends: Array = []
var _friend_selected_index: int = -1
var _current_friend_category: FriendCategory = FriendCategory.FRIEND

# NPC 对话
var _npc_dialogs: Array = []
var _current_dialog_index: int = 0

# 玩家交易
var _trade_partner_name: String = ""
var _my_inventory: Array = []
var _my_trade_items: Array = []
var _partner_trade_items: Array = []
var _trade_locked: bool = false
var _trade_confirmed: bool = false

# ------------------------------------------------------------------------------
# 节点引用（场景树中以 unique_name_in_owner 标记，共 49 个）
# ------------------------------------------------------------------------------

# --- 全局 ---
@onready var _btn_back: Button = %BtnBack
@onready var _tab_container: TabContainer = %TabContainer

# --- Tab 1: 公会信息 (GUILD_INFO) ---
@onready var _label_guild_name: Label = %LabelGuildName
@onready var _label_guild_level: Label = %LabelGuildLevel
@onready var _label_guild_leader: Label = %LabelGuildLeader
@onready var _label_guild_members: Label = %LabelGuildMembers
@onready var _label_guild_funds: Label = %LabelGuildFunds
@onready var _richtext_announcement: RichTextLabel = %RichtextAnnouncement
@onready var _btn_leave_guild: Button = %BtnLeaveGuild
@onready var _btn_guild_manage: Button = %BtnGuildManage

# --- Tab 2: 成员列表 (GUILD_MEMBERS) ---
@onready var _guild_member_list: ItemList = %GuildMemberList
@onready var _label_member_detail_name: Label = %LabelMemberDetailName
@onready var _label_member_detail_class: Label = %LabelMemberDetailClass
@onready var _label_member_detail_level: Label = %LabelMemberDetailLevel
@onready var _label_member_detail_role: Label = %LabelMemberDetailRole
@onready var _label_member_detail_online: Label = %LabelMemberDetailOnline
@onready var _btn_manage_roles: Button = %BtnManageRoles
@onready var _btn_invite_member: Button = %BtnInviteMember
@onready var _btn_kick_member: Button = %BtnKickMember

# --- Tab 3: 聊天频道 (CHAT_CHANNELS) ---
@onready var _channel_list: ItemList = %ChannelList
@onready var _btn_channel_settings: Button = %BtnChannelSettings
@onready var _richtext_chat_messages: RichTextLabel = %RichtextChatMessages
@onready var _line_chat_input: LineEdit = %LineChatInput
@onready var _btn_chat_send: Button = %BtnChatSend

# --- Tab 4: 好友系统 (FRIENDS) ---
@onready var _line_friend_search: LineEdit = %LineFriendSearch
@onready var _friend_tab_container: TabContainer = %FriendTabContainer
@onready var _friend_list: ItemList = %FriendList
@onready var _label_friend_detail_name: Label = %LabelFriendDetailName
@onready var _label_friend_detail_location: Label = %LabelFriendDetailLocation
@onready var _label_friend_detail_online: Label = %LabelFriendDetailOnline
@onready var _btn_add_friend: Button = %BtnAddFriend
@onready var _btn_delete_friend: Button = %BtnDeleteFriend
@onready var _btn_whisper_friend: Button = %BtnWhisperFriend

# --- Tab 5: NPC对话 (NPC_DIALOG) ---
@onready var _label_npc_name: Label = %LabelNpcName
@onready var _richtext_npc_dialog: RichTextLabel = %RichtextNpcDialog
@onready var _vbox_dialog_options: VBoxContainer = %VBoxDialogOptions
@onready var _btn_npc_quest: Button = %BtnNpcQuest
@onready var _btn_npc_shop: Button = %BtnNpcShop
@onready var _btn_npc_leave: Button = %BtnNpcLeave

# --- Tab 6: 玩家交易 (PLAYER_TRADE) ---
@onready var _label_trade_partner: Label = %LabelTradePartner
@onready var _my_inventory_list: ItemList = %MyInventoryList
@onready var _my_trade_list: ItemList = %MyTradeList
@onready var _spin_my_trade_gold: SpinBox = %SpinMyTradeGold
@onready var _label_trade_status: Label = %LabelTradeStatus
@onready var _btn_trade_lock: Button = %BtnTradeLock
@onready var _btn_trade_confirm: Button = %BtnTradeConfirm
@onready var _btn_trade_cancel: Button = %BtnTradeCancel
@onready var _partner_trade_list: ItemList = %PartnerTradeList
@onready var _label_partner_gold: Label = %LabelPartnerGold

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
@onready var _npc_title_label: Label = %NpcTitleLabel
@onready var _dialog_label: Label = %DialogLabel
@onready var _options_label: Label = %OptionsLabel
@onready var _my_inv_label: Label = %MyInvLabel
@onready var _my_trade_label: Label = %MyTradeLabel
@onready var _my_gold_label: Label = %MyGoldLabel
@onready var _partner_inv_label: Label = %PartnerInvLabel

# ==============================================================================
# 公开交互方法（白模测试契约）
# ==============================================================================

## 白模测试契约桩：注入公会快照（经统一快照入口，映射契约字段）
func set_guild_snapshot(p_name: String, lvl: int, gold: int, members: Array, techs: Array) -> void:
	apply_snapshot({
		"guild_name": p_name,
		"guild_level": lvl,
		"guild_funds": gold,
		"members": members,
		"techs": techs,
	})

## 统一快照渲染映射（P81）：公会信息/成员/科技树 → 视图状态
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
	return MockServiceContainer.get_instance().guild().can_manage(user_role)

# ==============================================================================
# 生命周期
# ==============================================================================

## 生命周期初始化：主题/Mock 快照/六 Tab 装配/信号绑定/视觉适配（骨架零接线）
func _ready() -> void:
	_apply_theme()
	_load_mock_snapshot()
	_init_tab_titles()
	_init_static_text()
	_init_guild_info_tab()
	_init_guild_members_tab()
	_init_chat_channels_tab()
	_init_friends_tab()
	_init_npc_dialog_tab()
	_init_player_trade_tab()
	_connect_signals()
	UIIntermediary.adapt_view(self)

## 视图销毁钩子：清理 UIIntermediary 视图绑定（防悬挂引用）
func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		UIIntermediary.clear_view_bindings(self)

## 应用 ThemeManager 单例主题（null 安全）
func _apply_theme() -> void:
	var tm := ThemeManager.get_instance()
	if tm.theme != null:
		theme = tm.theme

# ==============================================================================
# Mock 数据加载（经 domain_boundary 快照服务读取，不接后端）
# ==============================================================================

## 加载骨架 Mock 快照：公会信息/成员/好友/NPC 对话/交易库存/聊天预填
func _load_mock_snapshot() -> void:
	# 公会基础信息
	guild_name = "ui.fe09.mock.guild_name"
	guild_level = 7
	guild_leader = "ui.fe09.mock.guild_leader"
	guild_funds = 128500
	guild_announcement = "ui.fe09.mock.guild_announcement"

	# 15 名公会成员
	_guild_members = MockServiceContainer.get_instance().guild().generate_roster(15)

	# 10 名好友
	_friends = _generate_mock_friends()

	# 3 条 NPC 对话
	_npc_dialogs = _generate_mock_npc_dialogs()

	# 交易 Mock 数据
	_trade_partner_name = "ui.fe09.mock.trade_partner"
	_my_inventory = _generate_mock_inventory()
	_partner_trade_items = _generate_mock_partner_trade_items()

	# 预填频道聊天 Mock 消息
	_seed_chat_mock_messages()

# ==============================================================================
# Mock 数据生成
# ==============================================================================

## 生成 10 条 Mock 好友数据（好友/黑名单/陌生人三分组）
func _generate_mock_friends() -> Array:
	var friend_data := [
		{ "name": "ui.fe09.mock.member.grain", "location": "ui.fe09.mock.location.valan", "online": true, "category": FriendCategory.FRIEND, "level": 28 },
		{ "name": "ui.fe09.mock.member.silvia", "location": "ui.fe09.mock.location.silver_grove", "online": true, "category": FriendCategory.FRIEND, "level": 25 },
		{ "name": "ui.fe09.mock.member.darius", "location": "ui.fe09.mock.location.iron_fortress", "online": false, "category": FriendCategory.FRIEND, "level": 30 },
		{ "name": "ui.fe09.mock.member.eleanor", "location": "ui.fe09.mock.location.dragon_peak", "online": true, "category": FriendCategory.FRIEND, "level": 22 },
		{ "name": "ui.fe09.mock.member.kyle", "location": "ui.fe09.mock.location.valan", "online": false, "category": FriendCategory.FRIEND, "level": 19 },
		{ "name": "ui.fe09.mock.member.lillian", "location": "ui.fe09.mock.location.offline", "online": false, "category": FriendCategory.FRIEND, "level": 27 },
		{ "name": "ui.fe09.mock.friend.blackmerchant", "location": "ui.fe09.mock.location.valan", "online": false, "category": FriendCategory.BLACKLIST, "level": 15 },
		{ "name": "ui.fe09.mock.friend.scammer", "location": "ui.fe09.mock.location.offline", "online": false, "category": FriendCategory.BLACKLIST, "level": 10 },
		{ "name": "ui.fe09.mock.friend.passerby_a", "location": "ui.fe09.mock.location.iron_fortress", "online": true, "category": FriendCategory.STRANGER, "level": 12 },
		{ "name": "ui.fe09.mock.friend.passerby_b", "location": "ui.fe09.mock.location.silver_grove", "online": false, "category": FriendCategory.STRANGER, "level": 8 },
	]
	return friend_data

## 生成 3 条 Mock NPC 对话（铁匠/公会执事/神秘旅者，含选项动作）
func _generate_mock_npc_dialogs() -> Array:
	return [
		{
			"npc_name": "ui.fe09.mock.npc.blacksmith",
			"npc_title": "ui.fe09.mock.npc_title.blacksmith",
			"text": "ui.fe09.mock.dialog.blacksmith.text",
			"options": [
				{ "text": "ui.fe09.mock.dialog.blacksmith.option_quest", "action": "QUEST" },
				{ "text": "ui.fe09.mock.dialog.blacksmith.option_shop", "action": "SHOP" },
				{ "text": "ui.fe09.mock.dialog.blacksmith.option_leave", "action": "LEAVE" },
			],
		},
		{
			"npc_name": "ui.fe09.mock.npc.guild_steward",
			"npc_title": "ui.fe09.mock.npc_title.steward",
			"text": "ui.fe09.mock.dialog.steward.text",
			"options": [
				{ "text": "ui.fe09.mock.dialog.steward.option_quest", "action": "QUEST" },
				{ "text": "ui.fe09.mock.dialog.steward.option_shop", "action": "SHOP" },
				{ "text": "ui.fe09.mock.dialog.steward.option_leave", "action": "LEAVE" },
			],
		},
		{
			"npc_name": "ui.fe09.mock.npc.mysterious_traveler",
			"npc_title": "ui.fe09.mock.npc_title.unknown",
			"text": "ui.fe09.mock.dialog.traveler.text",
			"options": [
				{ "text": "ui.fe09.mock.dialog.traveler.option_quest", "action": "QUEST" },
				{ "text": "ui.fe09.mock.dialog.traveler.option_shop", "action": "SHOP" },
				{ "text": "ui.fe09.mock.dialog.traveler.option_leave", "action": "LEAVE" },
			],
		},
	]

## 生成 8 件 Mock 玩家背包物品（名称/稀有度/数量）
func _generate_mock_inventory() -> Array:
	return [
		{ "name": "ui.fe09.mock.item.mithril_sword", "rarity": "RARE", "qty": 1 },
		{ "name": "ui.fe09.mock.item.leather_armor", "rarity": "COMMON", "qty": 1 },
		{ "name": "ui.fe09.mock.item.hp_potion", "rarity": "COMMON", "qty": 12 },
		{ "name": "ui.fe09.mock.item.mp_potion", "rarity": "COMMON", "qty": 8 },
		{ "name": "ui.fe09.mock.item.mithril_ore", "rarity": "UNCOMMON", "qty": 3 },
		{ "name": "ui.fe09.mock.item.dragon_scale", "rarity": "EPIC", "qty": 2 },
		{ "name": "ui.fe09.mock.item.ancient_scroll", "rarity": "RARE", "qty": 1 },
		{ "name": "ui.fe09.mock.item.speed_charm", "rarity": "UNCOMMON", "qty": 5 },
	]

## 生成 3 件 Mock 交易对方物品
func _generate_mock_partner_trade_items() -> Array:
	return [
		{ "name": "ui.fe09.mock.item.magic_crystal", "rarity": "RARE", "qty": 10 },
		{ "name": "ui.fe09.mock.item.elf_bow", "rarity": "RARE", "qty": 1 },
		{ "name": "ui.fe09.mock.item.silver_herb", "rarity": "COMMON", "qty": 20 },
	]

## 预填五频道 Mock 聊天消息（公会/世界/交易/官员/队伍）
func _seed_chat_mock_messages() -> void:
	# 公会频道
	var guild_msg_key := _channel_key(ChatChannel.GUILD)
	_chat_channels[guild_msg_key]["messages"] = [
		{ "sender": "ui.fe09.mock.member.meryl", "text": "ui.fe09.chat.mock.guild_msg_1" },
		{ "sender": "ui.fe09.mock.member.grain", "text": "ui.fe09.chat.mock.guild_msg_2" },
		{ "sender": "ui.fe09.mock.member.silvia", "text": "ui.fe09.chat.mock.guild_msg_3" },
		{ "sender": "ui.fe09.mock.member.altria", "text": "ui.fe09.chat.mock.guild_msg_4" },
	]
	# 世界频道
	var world_msg_key := _channel_key(ChatChannel.WORLD)
	_chat_channels[world_msg_key]["messages"] = [
		{ "sender": "ui.fe09.mock.friend.passerby_a", "text": "ui.fe09.chat.mock.world_msg_1" },
		{ "sender": "ui.fe09.mock.member.beowulf", "text": "ui.fe09.chat.mock.world_msg_2" },
		{ "sender": "ui.fe09.chat.sender_system", "text": "ui.fe09.chat.mock.world_msg_3" },
	]
	# 交易频道
	var trade_msg_key := _channel_key(ChatChannel.TRADE)
	_chat_channels[trade_msg_key]["messages"] = [
		{ "sender": "ui.fe09.mock.friend.blackmerchant", "text": "ui.fe09.chat.mock.trade_msg_1" },
		{ "sender": "ui.fe09.mock.member.isabella", "text": "ui.fe09.chat.mock.trade_msg_2" },
	]
	# 官员频道
	var officer_msg_key := _channel_key(ChatChannel.OFFICER)
	_chat_channels[officer_msg_key]["messages"] = [
		{ "sender": "ui.fe09.mock.member.altria", "text": "ui.fe09.chat.mock.officer_msg_1" },
		{ "sender": "ui.fe09.mock.member.meryl", "text": "ui.fe09.chat.mock.officer_msg_2" },
	]
	# 队伍频道
	var party_msg_key := _channel_key(ChatChannel.PARTY)
	_chat_channels[party_msg_key]["messages"] = [
		{ "sender": "ui.fe09.chat.sender_system", "text": "ui.fe09.chat.mock.party_msg_1" },
		{ "sender": "ui.fe09.mock.member.kyle", "text": "ui.fe09.chat.mock.party_msg_2" },
	]

# ==============================================================================
# Tab 标题初始化
# ==============================================================================

## 初始化六主 Tab 与三好友子 Tab 标题（i18n 键驱动）
func _init_tab_titles() -> void:
	var tab_keys := [
		"ui.fe09.tab.guild_info",
		"ui.fe09.tab.guild_members",
		"ui.fe09.tab.chat_channels",
		"ui.fe09.tab.friends",
		"ui.fe09.tab.npc_dialog",
		"ui.fe09.tab.player_trade",
	]
	for i in range(tab_keys.size()):
		if i < _tab_container.get_tab_count():
			UIIntermediary.resolve_tab(_tab_container, i, tab_keys[i])

	# 好友子 Tab 标题
	var friend_tab_keys := [
		"ui.fe09.friend.subtab.friend",
		"ui.fe09.friend.subtab.blacklist",
		"ui.fe09.friend.subtab.stranger",
	]
	for i in range(friend_tab_keys.size()):
		if i < _friend_tab_container.get_tab_count():
			UIIntermediary.resolve_tab(_friend_tab_container, i, friend_tab_keys[i])

# ==============================================================================
# 静态文案初始化（非动态数据节点，i18n 绑定）
# ==============================================================================

## 初始化全部静态文案（16 个非唯一标签 + 各 Tab 按钮/占位符，i18n 全驱动）
func _init_static_text() -> void:
	# --- 全局 ---
	UIIntermediary.resolve(_header_title_label, "ui.fe09.header.title")
	UIIntermediary.resolve(_btn_back, "ui.fe09.header.back")

	# --- Tab 1: 公会信息 ---
	UIIntermediary.resolve(_announcement_label, "ui.fe09.guild.announcement_label")
	UIIntermediary.resolve(_btn_leave_guild, "ui.fe09.guild.btn_leave")
	UIIntermediary.resolve(_btn_guild_manage, "ui.fe09.guild.btn_manage")

	# --- Tab 2: 成员列表 ---
	UIIntermediary.resolve(_member_list_label, "ui.fe09.members.list_label")
	UIIntermediary.resolve(_member_detail_label, "ui.fe09.members.detail_label")
	UIIntermediary.resolve(_btn_manage_roles, "ui.fe09.members.btn_manage_roles")
	UIIntermediary.resolve(_btn_invite_member, "ui.fe09.members.btn_invite")
	UIIntermediary.resolve(_btn_kick_member, "ui.fe09.members.btn_kick")

	# --- Tab 3: 聊天频道 ---
	UIIntermediary.resolve(_channel_list_label, "ui.fe09.chat.channel_list_label")
	UIIntermediary.resolve(_btn_channel_settings, "ui.fe09.chat.btn_settings")
	UIIntermediary.resolve(_chat_messages_label, "ui.fe09.chat.messages_label")
	UIIntermediary.resolve_placeholder(_line_chat_input, "ui.fe09.chat.input_placeholder")
	UIIntermediary.resolve(_btn_chat_send, "ui.fe09.chat.btn_send")

	# --- Tab 4: 好友系统 ---
	UIIntermediary.resolve(_search_label, "ui.fe09.friend.search_label")
	UIIntermediary.resolve_placeholder(_line_friend_search, "ui.fe09.friend.search_placeholder")
	UIIntermediary.resolve(_friend_list_label, "ui.fe09.friend.list_label")
	UIIntermediary.resolve(_friend_detail_title_label, "ui.fe09.friend.detail_label")
	UIIntermediary.resolve(_btn_add_friend, "ui.fe09.friend.btn_add")
	UIIntermediary.resolve(_btn_delete_friend, "ui.fe09.friend.btn_delete")
	UIIntermediary.resolve(_btn_whisper_friend, "ui.fe09.friend.btn_whisper")

	# --- Tab 5: NPC对话 ---
	UIIntermediary.resolve(_dialog_label, "ui.fe09.npc.dialog_label")
	UIIntermediary.resolve(_options_label, "ui.fe09.npc.options_label")
	UIIntermediary.resolve(_btn_npc_quest, "ui.fe09.npc.btn_quest")
	UIIntermediary.resolve(_btn_npc_shop, "ui.fe09.npc.btn_shop")
	UIIntermediary.resolve(_btn_npc_leave, "ui.fe09.npc.btn_leave")

	# --- Tab 6: 玩家交易 ---
	UIIntermediary.resolve(_my_inv_label, "ui.fe09.trade.my_inventory_label")
	UIIntermediary.resolve(_my_trade_label, "ui.fe09.trade.my_trade_label")
	UIIntermediary.resolve(_my_gold_label, "ui.fe09.trade.gold_label")
	UIIntermediary.resolve(_btn_trade_confirm, "ui.fe09.trade.btn_confirm")
	UIIntermediary.resolve(_btn_trade_cancel, "ui.fe09.trade.btn_cancel")
	UIIntermediary.resolve(_partner_inv_label, "ui.fe09.trade.partner_trade_label")

# ==============================================================================
# 信号绑定（零接线：所有信号在本地脚本闭环，不接 EventBus）
# ==============================================================================

## 绑定本地 UI 交互信号（零接线：六 Tab 全部控件在本地脚本闭环）
func _connect_signals() -> void:
	# 返回按钮
	_btn_back.pressed.connect(_on_back_pressed)
	# Tab 切换
	_tab_container.tab_changed.connect(_on_tab_changed)

	# Tab 1: 公会信息
	_btn_leave_guild.pressed.connect(_on_leave_guild_pressed)
	_btn_guild_manage.pressed.connect(_on_guild_manage_pressed)

	# Tab 2: 成员列表
	_guild_member_list.item_selected.connect(_on_member_selected)
	_btn_manage_roles.pressed.connect(_on_manage_roles_pressed)
	_btn_invite_member.pressed.connect(_on_invite_member_pressed)
	_btn_kick_member.pressed.connect(_on_kick_member_pressed)

	# Tab 3: 聊天频道
	_channel_list.item_selected.connect(_on_channel_selected)
	_btn_channel_settings.pressed.connect(_on_channel_settings_pressed)
	_btn_chat_send.pressed.connect(_on_chat_send_pressed)
	_line_chat_input.text_submitted.connect(_on_chat_input_submitted)

	# Tab 4: 好友系统
	_line_friend_search.text_changed.connect(_on_friend_search_changed)
	_friend_tab_container.tab_changed.connect(_on_friend_tab_changed)
	_friend_list.item_selected.connect(_on_friend_selected)
	_btn_add_friend.pressed.connect(_on_add_friend_pressed)
	_btn_delete_friend.pressed.connect(_on_delete_friend_pressed)
	_btn_whisper_friend.pressed.connect(_on_whisper_friend_pressed)

	# Tab 5: NPC对话
	_btn_npc_quest.pressed.connect(_on_npc_quest_pressed)
	_btn_npc_shop.pressed.connect(_on_npc_shop_pressed)
	_btn_npc_leave.pressed.connect(_on_npc_leave_pressed)

	# Tab 6: 玩家交易
	_my_inventory_list.item_selected.connect(_on_my_inventory_selected)
	_my_trade_list.item_selected.connect(_on_my_trade_selected)
	_spin_my_trade_gold.value_changed.connect(_on_trade_gold_changed)
	_btn_trade_lock.pressed.connect(_on_trade_lock_pressed)
	_btn_trade_confirm.pressed.connect(_on_trade_confirm_pressed)
	_btn_trade_cancel.pressed.connect(_on_trade_cancel_pressed)

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
	_richtext_announcement.clear()
	var announcement_text := UIIntermediary.text(guild_announcement, {"guild_name": guild_name_display})
	_richtext_announcement.append_text(announcement_text)

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
		var display := UIIntermediary.text("ui.fe09.members.list_item", {
			"icon": status_icon,
			"name": member_name,
			"level": level,
			"class": member_class,
			"role": role,
		})
		_guild_member_list.add_item(display)

## 刷新成员详情：未选中占位或完整字段（名称/职业/等级/职位/在线态）
func _refresh_member_detail(index: int) -> void:
	if index < 0 or index >= _guild_members.size():
		UIIntermediary.resolve(_label_member_detail_name, "ui.fe09.members.detail_name_none")
		UIIntermediary.resolve(_label_member_detail_class, "ui.fe09.members.class_none")
		UIIntermediary.resolve(_label_member_detail_level, "ui.fe09.members.level_none")
		UIIntermediary.resolve(_label_member_detail_role, "ui.fe09.members.role_none")
		UIIntermediary.resolve(_label_member_detail_online, "ui.fe09.members.status_none")
		return
	var member: Dictionary = _guild_members[index]
	var member_name := UIIntermediary.text(str(member.get("name", "")))
	var member_class := UIIntermediary.text(str(member.get("class", "")))
	var role := UIIntermediary.text(str(member.get("role", "")))
	var level := int(member.get("level", 0))
	var online := bool(member.get("online", false))
	var status_key := "ui.fe09.common.status_online" if online else "ui.fe09.common.status_offline"
	_label_member_detail_name.text = member_name
	UIIntermediary.resolve(_label_member_detail_class, "ui.fe09.members.class_label", {"name": member_class})
	UIIntermediary.resolve(_label_member_detail_level, "ui.fe09.members.level_label", {"level": level})
	UIIntermediary.resolve(_label_member_detail_role, "ui.fe09.members.role_label", {"name": role})
	UIIntermediary.resolve(_label_member_detail_online, "ui.fe09.members.status_label", {"status": UIIntermediary.text(status_key)})

# ==============================================================================
# Tab 3: 聊天频道 (CHAT_CHANNELS) 初始化
# ==============================================================================

## 初始化聊天频道 Tab：填充频道列表并默认选中首频道、刷新消息区
func _init_chat_channels_tab() -> void:
	_populate_channel_list()
	# 默认选中第一项
	if _channel_list.get_item_count() > 0:
		_channel_list.select(0)
		_current_channel_index = 0
	_refresh_chat_display()

## 填充频道列表：频道名 + 消息计数
func _populate_channel_list() -> void:
	_channel_list.clear()
	for channel in _chat_channels:
		var msg_count: int = channel.get("messages", []).size()
		var channel_name := UIIntermediary.text(str(channel.get("name", "")))
		var display := UIIntermediary.text("ui.fe09.chat.channel_item", {"name": channel_name, "count": msg_count})
		_channel_list.add_item(display)

## 刷新聊天消息区：当前频道逐条渲染，系统消息独立取色（树内守卫）
func _refresh_chat_display() -> void:
	if not is_inside_tree():
		return
	_richtext_chat_messages.clear()
	if _current_channel_index < 0 or _current_channel_index >= _chat_channels.size():
		return
	var channel: Dictionary = _chat_channels[_current_channel_index]
	var messages: Array = channel.get("messages", [])
	var tm := ThemeManager.get_instance()
	var channel_name := UIIntermediary.text(str(channel.get("name", "")))
	for msg in messages:
		var sender_key: String = str(msg.get("sender", ""))
		var sender := UIIntermediary.text(sender_key)
		var msg_text := UIIntermediary.text(str(msg.get("text", "")))
		var color_tag := tm.get_bbcode_color_tag("GUILD")
		if sender_key == "ui.fe09.chat.sender_system":
			color_tag = tm.get_bbcode_color_tag("SYSTEM")
		var line := UIIntermediary.text("ui.fe09.chat.message_format", {"channel": channel_name, "sender": sender, "text": msg_text})
		_richtext_chat_messages.append_text("%s%s[/color]\n" % [color_tag, line])

# ==============================================================================
# Tab 4: 好友系统 (FRIENDS) 初始化
# ==============================================================================

## 初始化好友系统 Tab：填充好友列表
func _init_friends_tab() -> void:
	_populate_friend_list()

## 填充好友列表：分类 + 关键词双过滤，在线图标/名称/等级/位置组合行
func _populate_friend_list() -> void:
	_friend_list.clear()
	var keyword := _line_friend_search.text.strip_edges().to_lower()
	for friend in _friends:
		# 按当前分类过滤
		if friend.get("category", FriendCategory.FRIEND) != _current_friend_category:
			continue
		# 关键词过滤
		var fname := UIIntermediary.text(str(friend.get("name", "")))
		if not keyword.is_empty() and not fname.to_lower().contains(keyword):
			continue
		var status_icon := "●" if friend.get("online", false) else "○"
		var location := UIIntermediary.text(str(friend.get("location", "")))
		var level := int(friend.get("level", 0))
		var display := UIIntermediary.text("ui.fe09.friend.list_item", {
			"icon": status_icon,
			"name": fname,
			"level": level,
			"location": location,
		})
		_friend_list.add_item(display)

## 刷新好友详情：按可见列表定位，未选中占位或完整字段（名称/位置/在线态）
func _refresh_friend_detail(index: int) -> void:
	# 由于列表经过过滤，需要从可见列表中查找
	var visible_friends := _get_visible_friends()
	if index < 0 or index >= visible_friends.size():
		UIIntermediary.resolve(_label_friend_detail_name, "ui.fe09.friend.detail_name_none")
		UIIntermediary.resolve(_label_friend_detail_location, "ui.fe09.friend.location_none")
		UIIntermediary.resolve(_label_friend_detail_online, "ui.fe09.friend.status_none")
		return
	var friend: Dictionary = visible_friends[index]
	var friend_name := UIIntermediary.text(str(friend.get("name", "")))
	var location := UIIntermediary.text(str(friend.get("location", "")))
	var online := bool(friend.get("online", false))
	var status_key := "ui.fe09.common.status_online" if online else "ui.fe09.common.status_offline"
	_label_friend_detail_name.text = friend_name
	UIIntermediary.resolve(_label_friend_detail_location, "ui.fe09.friend.location_label", {"name": location})
	UIIntermediary.resolve(_label_friend_detail_online, "ui.fe09.friend.status_label", {"status": UIIntermediary.text(status_key)})

## 获取可见好友列表（分类 + 关键词双过滤，与列表渲染同口径）
func _get_visible_friends() -> Array:
	var result := []
	var keyword := _line_friend_search.text.strip_edges().to_lower()
	for friend in _friends:
		if friend.get("category", FriendCategory.FRIEND) != _current_friend_category:
			continue
		var fname := UIIntermediary.text(str(friend.get("name", "")))
		if not keyword.is_empty() and not fname.to_lower().contains(keyword):
			continue
		result.append(friend)
	return result

# ==============================================================================
# Tab 5: NPC对话 (NPC_DIALOG) 初始化
# ==============================================================================

## 初始化 NPC 对话 Tab：重置索引并刷新对话展示
func _init_npc_dialog_tab() -> void:
	_current_dialog_index = 0
	_refresh_npc_dialog_display()

## 刷新 NPC 对话展示：NPC 名/头衔/文本 + 动态生成选项按钮（树内守卫）
func _refresh_npc_dialog_display() -> void:
	if not is_inside_tree():
		return
	if _current_dialog_index < 0 or _current_dialog_index >= _npc_dialogs.size():
		return
	var dialog: Dictionary = _npc_dialogs[_current_dialog_index]
	_label_npc_name.text = UIIntermediary.text(str(dialog.get("npc_name", "")))
	_npc_title_label.text = UIIntermediary.text(str(dialog.get("npc_title", "")))
	_richtext_npc_dialog.clear()
	_richtext_npc_dialog.append_text(UIIntermediary.text(str(dialog.get("text", ""))))
	# 动态生成对话选项按钮
	_clear_dialog_options()
	var options: Array = dialog.get("options", [])
	for i in range(options.size()):
		var option: Dictionary = options[i]
		var btn := KButtonClass.new()
		btn.variant = KButtonClass.StyleVariant.SECONDARY
		btn.text = UIIntermediary.text(str(option.get("text", "")))
		btn.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var action: String = str(option.get("action", "LEAVE"))
		btn.pressed.connect(_on_dialog_option_pressed.bind(i, action))
		_vbox_dialog_options.add_child(btn)

## 清空对话选项按钮容器
func _clear_dialog_options() -> void:
	for child in _vbox_dialog_options.get_children():
		child.queue_free()

# ==============================================================================
# Tab 6: 玩家交易 (PLAYER_TRADE) 初始化
# ==============================================================================

## 初始化玩家交易 Tab：重置锁定/确认态并刷新双方列表与状态
func _init_player_trade_tab() -> void:
	_trade_locked = false
	_trade_confirmed = false
	_my_trade_items = []
	UIIntermediary.resolve(_label_trade_partner, "ui.fe09.trade.partner_label", {"name": UIIntermediary.text(_trade_partner_name)})
	_populate_my_inventory_list()
	_refresh_my_trade_list()
	_refresh_partner_trade_list()
	_refresh_trade_status()
	_spin_my_trade_gold.value = 0
	UIIntermediary.resolve(_label_partner_gold, "ui.fe09.trade.partner_gold_label", {"amount": 3500})

## 填充我的背包列表（名称/稀有度/数量）
func _populate_my_inventory_list() -> void:
	_my_inventory_list.clear()
	for item in _my_inventory:
		var item_name := UIIntermediary.text(str(item.get("name", "")))
		var rarity_display := _rarity_display(str(item.get("rarity", "")))
		var qty := int(item.get("qty", 1))
		var display := UIIntermediary.text("ui.fe09.trade.item_display", {"name": item_name, "rarity": rarity_display, "qty": qty})
		_my_inventory_list.add_item(display)

## 刷新我的交易栏列表
func _refresh_my_trade_list() -> void:
	_my_trade_list.clear()
	for item in _my_trade_items:
		var item_name := UIIntermediary.text(str(item.get("name", "")))
		var rarity_display := _rarity_display(str(item.get("rarity", "")))
		var qty := int(item.get("qty", 1))
		var display := UIIntermediary.text("ui.fe09.trade.item_display", {"name": item_name, "rarity": rarity_display, "qty": qty})
		_my_trade_list.add_item(display)

## 刷新对方交易栏列表
func _refresh_partner_trade_list() -> void:
	_partner_trade_list.clear()
	for item in _partner_trade_items:
		var item_name := UIIntermediary.text(str(item.get("name", "")))
		var rarity_display := _rarity_display(str(item.get("rarity", "")))
		var qty := int(item.get("qty", 1))
		var display := UIIntermediary.text("ui.fe09.trade.item_display", {"name": item_name, "rarity": rarity_display, "qty": qty})
		_partner_trade_list.add_item(display)

## 刷新交易状态文案与按钮可用性（进行中/已锁定/已确认三态）
func _refresh_trade_status() -> void:
	if _trade_confirmed:
		UIIntermediary.resolve(_label_trade_status, "ui.fe09.trade.status_label", {"status": UIIntermediary.text("ui.fe09.trade.status_confirmed")})
	elif _trade_locked:
		UIIntermediary.resolve(_label_trade_status, "ui.fe09.trade.status_label", {"status": UIIntermediary.text("ui.fe09.trade.status_locked")})
	else:
		UIIntermediary.resolve(_label_trade_status, "ui.fe09.trade.status_label", {"status": UIIntermediary.text("ui.fe09.trade.status_in_progress")})
	UIIntermediary.resolve(_btn_trade_lock, "ui.fe09.trade.btn_unlock" if _trade_locked else "ui.fe09.trade.btn_lock")
	_btn_trade_lock.disabled = _trade_confirmed
	_btn_trade_confirm.disabled = not _trade_locked or _trade_confirmed

# ==============================================================================
# Tab 1: 公会信息 信号处理
# ==============================================================================

## 退出公会按钮回调（骨架阶段仅 print 占位，未接线）
func _on_leave_guild_pressed() -> void:
	print("[GuildSocial] 退出公会（骨架阶段：未接线）")

## 公会管理按钮回调（骨架阶段仅 print 占位，未接线）
func _on_guild_manage_pressed() -> void:
	print("[GuildSocial] 打开公会管理面板（骨架阶段：未接线）")

# ==============================================================================
# Tab 2: 成员列表 信号处理
# ==============================================================================

## 成员条目选中：记录索引并刷新详情
func _on_member_selected(index: int) -> void:
	_member_selected_index = index
	_refresh_member_detail(index)

## 职位管理按钮回调：校验已选成员后 print 占位（骨架）
func _on_manage_roles_pressed() -> void:
	if _member_selected_index < 0:
		print("[GuildSocial] 职位管理：未选择成员")
		return
	var member: Dictionary = _guild_members[_member_selected_index]
	print("[GuildSocial] 职位管理: %s" % member.get("name", ""))

## 邀请成员按钮回调（骨架阶段仅 print 占位，未接线）
func _on_invite_member_pressed() -> void:
	print("[GuildSocial] 邀请成员（骨架阶段：未接线）")

## 踢出成员按钮回调：校验已选成员后 print 占位（骨架）
func _on_kick_member_pressed() -> void:
	if _member_selected_index < 0:
		print("[GuildSocial] 踢出成员：未选择成员")
		return
	var member: Dictionary = _guild_members[_member_selected_index]
	print("[GuildSocial] 踢出成员: %s" % member.get("name", ""))

# ==============================================================================
# Tab 3: 聊天频道 信号处理
# ==============================================================================

## 频道选中：切换当前频道并刷新消息区
func _on_channel_selected(index: int) -> void:
	_current_channel_index = index
	_refresh_chat_display()

## 频道设置按钮回调（骨架阶段仅 print 占位，未接线）
func _on_channel_settings_pressed() -> void:
	print("[GuildSocial] 频道设置（骨架阶段：未接线）")

## 发送按钮回调：委托 _send_chat_message
func _on_chat_send_pressed() -> void:
	_send_chat_message()

## 聊天输入框回车提交：委托 _send_chat_message
func _on_chat_input_submitted(_text: String) -> void:
	_send_chat_message()

## 发送聊天消息：追加当前频道、超上限头弹回收、重建频道列表并保持选中态
func _send_chat_message() -> void:
	var text := _line_chat_input.text.strip_edges()
	if text.is_empty():
		return
	if _current_channel_index < 0 or _current_channel_index >= _chat_channels.size():
		return
	var sender := "ui.fe09.mock.local_player_name"
	_chat_channels[_current_channel_index]["messages"].append({ "sender": sender, "text": text })
	# 超出上限回收
	var msg_list: Array = _chat_channels[_current_channel_index]["messages"]
	if msg_list.size() > _max_chat_lines:
		msg_list.pop_front()
	_line_chat_input.clear()
	_populate_channel_list()
	# 重新选中当前频道
	if _current_channel_index < _channel_list.get_item_count():
		_channel_list.select(_current_channel_index)
	_refresh_chat_display()

# ==============================================================================
# Tab 4: 好友系统 信号处理
# ==============================================================================

## 好友搜索变更：重建列表并重置选中详情
func _on_friend_search_changed(_text: String) -> void:
	_populate_friend_list()
	_friend_selected_index = -1
	_refresh_friend_detail(-1)

## 好友子 Tab 切换：更新分类并重建列表、重置选中详情
func _on_friend_tab_changed(tab_index: int) -> void:
	match tab_index:
		0: _current_friend_category = FriendCategory.FRIEND
		1: _current_friend_category = FriendCategory.BLACKLIST
		2: _current_friend_category = FriendCategory.STRANGER
	_populate_friend_list()
	_friend_selected_index = -1
	_refresh_friend_detail(-1)

## 好友条目选中：记录索引并刷新详情
func _on_friend_selected(index: int) -> void:
	_friend_selected_index = index
	_refresh_friend_detail(index)

## 添加好友按钮回调（骨架阶段仅 print 占位，未接线）
func _on_add_friend_pressed() -> void:
	print("[GuildSocial] 添加好友（骨架阶段：未接线）")

## 删除好友按钮回调：校验已选后 print 占位（骨架）
func _on_delete_friend_pressed() -> void:
	var visible := _get_visible_friends()
	if _friend_selected_index < 0 or _friend_selected_index >= visible.size():
		print("[GuildSocial] 删除好友：未选择好友")
		return
	var friend: Dictionary = visible[_friend_selected_index]
	print("[GuildSocial] 删除好友: %s" % friend.get("name", ""))

## 私聊好友按钮回调：校验已选后 print 占位（骨架）
func _on_whisper_friend_pressed() -> void:
	var visible := _get_visible_friends()
	if _friend_selected_index < 0 or _friend_selected_index >= visible.size():
		print("[GuildSocial] 发起私聊：未选择好友")
		return
	var friend: Dictionary = visible[_friend_selected_index]
	print("[GuildSocial] 发起私聊: %s" % friend.get("name", ""))

# ==============================================================================
# Tab 5: NPC对话 信号处理
# ==============================================================================

## NPC 对话选项点击：按 action 分派（QUEST/SHOP 占位、LEAVE 切换下一条对话）
func _on_dialog_option_pressed(option_index: int, action: String) -> void:
	var dialog: Dictionary = _npc_dialogs[_current_dialog_index]
	var options: Array = dialog.get("options", [])
	if option_index >= 0 and option_index < options.size():
		var option: Dictionary = options[option_index]
		print("[GuildSocial] NPC对话选项: %s (action=%s)" % [option.get("text", ""), action])
	# 根据 action 切换对话或执行快捷动作
	match action:
		"QUEST":
			print("[GuildSocial] 接取任务（骨架阶段：未接线）")
		"SHOP":
			print("[GuildSocial] 打开商店（骨架阶段：未接线）")
		"LEAVE":
			# 切换到下一条对话
			_current_dialog_index = (_current_dialog_index + 1) % _npc_dialogs.size()
			_refresh_npc_dialog_display()

## NPC 任务按钮回调（骨架阶段仅 print 占位，未接线）
func _on_npc_quest_pressed() -> void:
	print("[GuildSocial] 任务接取（骨架阶段：未接线）")

## NPC 商店按钮回调（骨架阶段仅 print 占位，未接线）
func _on_npc_shop_pressed() -> void:
	print("[GuildSocial] 打开商店（骨架阶段：未接线）")

## NPC 离开按钮：切换下一条对话
func _on_npc_leave_pressed() -> void:
	# 切换到下一条对话
	_current_dialog_index = (_current_dialog_index + 1) % _npc_dialogs.size()
	_refresh_npc_dialog_display()

# ==============================================================================
# Tab 6: 玩家交易 信号处理
# ==============================================================================

## 背包物品点击：锁定/确认态拦截，放入交易栏并刷新
func _on_my_inventory_selected(index: int) -> void:
	# 点击物品栏：将物品放入交易栏
	if _trade_locked or _trade_confirmed:
		return
	if index < 0 or index >= _my_inventory.size():
		return
	var item: Dictionary = _my_inventory[index]
	_my_trade_items.append(item.duplicate())
	_refresh_my_trade_list()

## 交易栏物品点击：锁定/确认态拦截，移除物品并刷新
func _on_my_trade_selected(index: int) -> void:
	# 点击交易栏：移除物品
	if _trade_locked or _trade_confirmed:
		return
	if index < 0 or index >= _my_trade_items.size():
		return
	_my_trade_items.remove_at(index)
	_refresh_my_trade_list()

## 交易金币输入变化：刷新交易状态
func _on_trade_gold_changed(_value: float) -> void:
	# 金币输入变化时刷新状态
	_refresh_trade_status()

## 锁定/解锁交易：状态机经服务跃迁并刷新
func _on_trade_lock_pressed() -> void:
	_apply_trade_transition("lock")

## 确认交易：状态机经服务守卫（须先锁定）并刷新
func _on_trade_confirm_pressed() -> void:
	_apply_trade_transition("confirm")

## 取消交易：状态机经服务重置，清空交易物品与金币并刷新
func _on_trade_cancel_pressed() -> void:
	_apply_trade_transition("cancel")
	_my_trade_items.clear()
	_spin_my_trade_gold.value = 0
	_refresh_my_trade_list()
	_refresh_trade_status()

## 交易状态机跃迁统一出口（规则与守卫在 domain_boundary 服务）
func _apply_trade_transition(action: String) -> void:
	var result := MockServiceContainer.get_instance().guild().trade_transition({
		"locked": _trade_locked,
		"confirmed": _trade_confirmed,
	}, action)
	if not bool(result.get("success", false)):
		return
	_trade_locked = bool(result.get("locked", _trade_locked))
	_trade_confirmed = bool(result.get("confirmed", _trade_confirmed))
	_refresh_trade_status()

# ==============================================================================
# 全局信号处理
# ==============================================================================

## 主 Tab 切换：骨架阶段占位（预留）
func _on_tab_changed(_tab_index: int) -> void:
	NavManager.get_instance().show_toast("切换公会功能", NavTypes.ToastLevel.INFO, 1.0)

## 返回按钮：经 ViewRouter 弹出视图回退上一级
func _on_back_pressed() -> void:
	# 返回按钮：通过 ViewRouter 返回上一视图
	var router := ViewRouter.get_instance()
	if router != null:
		router.pop_view()

# ==============================================================================
# 工具方法
# ==============================================================================

## 频道枚举 → 频道数组索引（枚举值即下标）
func _channel_key(channel: ChatChannel) -> int:
	return channel

## 频道枚举 → i18n 频道名键（未命中回退公会频道）
func _channel_name(channel: ChatChannel) -> String:
	match channel:
		ChatChannel.GUILD: return "ui.fe09.chat.channel.guild"
		ChatChannel.OFFICER: return "ui.fe09.chat.channel.officer"
		ChatChannel.WORLD: return "ui.fe09.chat.channel.world"
		ChatChannel.PARTY: return "ui.fe09.chat.channel.party"
		ChatChannel.TRADE: return "ui.fe09.chat.channel.trade"
	return "ui.fe09.chat.channel.guild"

## 稀有度码 → i18n 稀有度名（小写化查 fe03 词表）
func _rarity_display(rarity: String) -> String:
	return UIIntermediary.text("ui.fe03.rarity." + rarity.to_lower())

# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第9卷: 社交与公会系统视图控制器
# 文件路径: res://frontend/views/guild_social/guild_social_view.gd
# 职责: 公会管理(信息/成员RBAC/资金)、频道聊天、好友列表与NPC对话分支、玩家交易
# 骨架阶段：纯 UI 交互，Mock 数据驱动，不接 EventBus，所有逻辑本地闭环
# ==============================================================================
class_name GuildSocialView
extends BaseScreen

const GuildSocialTabsScript = preload("res://frontend/views/guild_social/guild_social_tabs.gd")
const KButtonClass = preload("res://frontend/components/k_button.gd")

var _tabs = null


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
var vault_gold: int = 0 # 白模测试契约字段（TC-FE09-01 断言金库余额）
var member_roster: Array = [] # 白模测试契约字段（TC-FE09-01 断言成员清单）
var tech_nodes: Array = [] # 白模测试契约字段（TC-FE09-03 断言公会科技树）
var guild_announcement: String = ""
var guild_member_count: int = 0

# 公会成员名册
var _guild_members: Array = []

# 成员详情选中索引
var _member_selected_index: int = -1

# 聊天频道
enum ChatChannel {GUILD, OFFICER, WORLD, PARTY, TRADE}
var _chat_channels: Array = [ {"id": "GUILD", "name": "ui.fe09.chat.channel.guild", "messages": []}, {"id": "OFFICER", "name": "ui.fe09.chat.channel.officer", "messages": []}, {"id": "WORLD", "name": "ui.fe09.chat.channel.world", "messages": []}, {"id": "PARTY", "name": "ui.fe09.chat.channel.party", "messages": []}, {"id": "TRADE", "name": "ui.fe09.chat.channel.trade", "messages": []}]
var _current_channel_index: int = 0

# 好友系统
enum FriendCategory {FRIEND, BLACKLIST, STRANGER}
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
func _get_tabs():
	if _tabs == null:
		_tabs = GuildSocialTabsScript.new()
		_tabs.setup(self)
	return _tabs

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

	# 好友/NPC/交易/聊天委托 Tabs 初始化
	_get_tabs().init_mock_data()

# ==============================================================================
# Tab 标题初始化
# ==============================================================================

## 初始化六主 Tab 与三好友子 Tab 标题（i18n 键驱动）
func _init_tab_titles() -> void:
	KTabBar.init_titles(_tab_container, PackedStringArray(["ui.fe09.tab.guild_info", "ui.fe09.tab.members", "ui.fe09.tab.chat", "ui.fe09.tab.friends", "ui.fe09.tab.npc_dialog", "ui.fe09.tab.trade"]))
	KTabBar.init_titles(_friend_tab_container, PackedStringArray(["ui.fe09.friend.subtab.friend", "ui.fe09.friend.subtab.blacklist", "ui.fe09.friend.subtab.stranger"]))

# ==============================================================================

## 初始化全部静态文案（16 个非唯一标签 + 各 Tab 按钮/占位符，i18n 全驱动）
func _init_static_text() -> void:
	var bindings := [
		[_header_title_label, "ui.fe09.header.title"], [_btn_back, "ui.fe09.header.back"],
		[_announcement_label, "ui.fe09.guild.announcement_label"], [_btn_leave_guild, "ui.fe09.guild.btn_leave"],
		[_btn_guild_manage, "ui.fe09.guild.btn_manage"], [_member_list_label, "ui.fe09.members.list_label"],
		[_member_detail_label, "ui.fe09.members.detail_label"], [_btn_manage_roles, "ui.fe09.members.btn_manage_roles"],
		[_btn_invite_member, "ui.fe09.members.btn_invite"], [_btn_kick_member, "ui.fe09.members.btn_kick"],
		[_channel_list_label, "ui.fe09.chat.channel_list_label"], [_btn_channel_settings, "ui.fe09.chat.btn_settings"],
		[_chat_messages_label, "ui.fe09.chat.messages_label"], [_btn_chat_send, "ui.fe09.chat.btn_send"],
		[_search_label, "ui.fe09.friend.search_label"], [_friend_list_label, "ui.fe09.friend.list_label"],
		[_friend_detail_title_label, "ui.fe09.friend.detail_label"], [_btn_add_friend, "ui.fe09.friend.btn_add"],
		[_btn_delete_friend, "ui.fe09.friend.btn_delete"], [_btn_whisper_friend, "ui.fe09.friend.btn_whisper"],
		[_dialog_label, "ui.fe09.npc.dialog_label"], [_options_label, "ui.fe09.npc.options_label"],
		[_btn_npc_quest, "ui.fe09.npc.btn_quest"], [_btn_npc_shop, "ui.fe09.npc.btn_shop"],
		[_btn_npc_leave, "ui.fe09.npc.btn_leave"], [_my_inv_label, "ui.fe09.trade.my_inventory_label"],
		[_my_trade_label, "ui.fe09.trade.my_trade_label"], [_my_gold_label, "ui.fe09.trade.gold_label"],
		[_btn_trade_confirm, "ui.fe09.trade.btn_confirm"], [_btn_trade_cancel, "ui.fe09.trade.btn_cancel"],
		[_partner_inv_label, "ui.fe09.trade.partner_trade_label"]
	]
	for b in bindings:
		if b[0] != null: UIIntermediary.resolve(b[0], b[1])
	UIIntermediary.resolve_placeholder(_line_chat_input, "ui.fe09.chat.input_placeholder")
	UIIntermediary.resolve_placeholder(_line_friend_search, "ui.fe09.friend.search_placeholder")

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
	var m: Dictionary = _guild_members[index]
	_label_member_detail_name.text = UIIntermediary.text(str(m.get("name", "")))
	UIIntermediary.resolve(_label_member_detail_class, "ui.fe09.members.class_label", {"name": UIIntermediary.text(str(m.get("class", "")))})
	UIIntermediary.resolve(_label_member_detail_level, "ui.fe09.members.level_label", {"level": int(m.get("level", 0))})
	UIIntermediary.resolve(_label_member_detail_role, "ui.fe09.members.role_label", {"name": UIIntermediary.text(str(m.get("role", "")))})
	var status_key := "ui.fe09.common.status_online" if bool(m.get("online", false)) else "ui.fe09.common.status_offline"
	UIIntermediary.resolve(_label_member_detail_online, "ui.fe09.members.status_label", {"status": UIIntermediary.text(status_key)})

# ==============================================================================
# Tab 3, 4, 5, 6 初始化委托给 GuildSocialTabs
# ==============================================================================

func _init_chat_channels_tab() -> void: _get_tabs()._init_chat_channels_tab()
func _populate_channel_list() -> void: _get_tabs()._populate_channel_list()
func _refresh_chat_display() -> void: _get_tabs()._refresh_chat_display()
func _init_friends_tab() -> void: _get_tabs()._init_friends_tab()
func _init_npc_dialog_tab() -> void: _get_tabs()._init_npc_dialog_tab()
func _init_player_trade_tab() -> void: _get_tabs()._init_player_trade_tab()

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
# Tab 3 交互回调委托给 GuildSocialTabs
# ==============================================================================

func _on_channel_selected(index: int) -> void: _get_tabs()._on_channel_selected(index)
func _on_channel_settings_pressed() -> void: _get_tabs()._on_channel_settings_pressed()
func _on_chat_send_pressed() -> void: _get_tabs()._on_chat_send_pressed()
func _on_chat_input_submitted(text: String) -> void: _get_tabs()._on_chat_input_submitted(text)
func _send_chat_message() -> void: _get_tabs()._send_chat_message()

# ==============================================================================
# 全局信号处理
# ==============================================================================

## 主 Tab 切换：骨架阶段占位（预留）
func _on_tab_changed(_tab_index: int) -> void:
	NavManager.get_instance().show_toast("切换公会功能", NavTypes.ToastLevel.INFO, 1.0)

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

# ==============================================================================
# 模块归属: 前端社交视图域 (fe09 公会社交页签委托)
# 文件路径: res://frontend/views/guild_social/guild_social_tabs.gd
# 架构定位: BaseScreen 附属页签委托控制器；承接聊天、好友、NPC 对话与玩家交易页签
# 依赖与触发: 依赖 GuildSocialView、ThemeManager、UIIntermediary 与 ServiceLocator
# 职责说明: 初始化社交页签预设数据、列表填充、动态对话按钮池及交易状态流转
# 退出语义与设计依据: 随 GuildSocialView 生命周期由 _register_owned_subcontroller 统一清理
# ==============================================================================
## 公会社交页签委托控制器，负责聊天频道、好友、NPC 对话与玩家交易子面板逻辑。
class_name GuildSocialTabs
extends BaseScreen

const KButtonClass = preload("res://frontend/components/k_button.gd")
const KPageHeaderClass = preload("res://frontend/components/k_page_header.gd")
const KSearchBarClass = preload("res://frontend/components/k_search_bar.gd")
const KRarityTagClass = preload("res://frontend/components/k_rarity_tag.gd")

enum FriendCategory {FRIEND, BLACKLIST, STRANGER}

var page_header: KPageHeader = null
var search_bar: KSearchBar = null
var _view: Variant = null

## 绑定宿主社交视图实例。
func setup(host_view: BaseScreen) -> void:
	_view = host_view

## 创建并缓存页面统一标题栏控件。
func create_page_header(title_key: String) -> KPageHeader:
	page_header = _ensure_page_header(page_header, KPageHeaderClass, title_key, _view) as KPageHeader
	return page_header

## 创建并缓存搜索栏控件，支持可选占位符文本键。
func create_search_bar(placeholder_key: String = "") -> KSearchBar:
	search_bar = _ensure_search_bar(search_bar, KSearchBarClass, placeholder_key) as KSearchBar
	return search_bar

# ==============================================================================
# 信号绑定
# ==============================================================================

## 绑定聊天频道、好友列表、NPC 对话与玩家交易控件信号。
func connect_signals() -> void:
	if _view == null:
		return
	# Tab 3: 聊天频道
	connect_managed(_view._channel_list.item_selected, _on_channel_selected)
	connect_managed(_view._channel_settings_button.pressed, _on_channel_settings_pressed)
	connect_managed(_view._chat_send_button.pressed, _on_chat_send_pressed)
	connect_managed(_view._line_chat_input.text_submitted, _on_chat_input_submitted)

	# Tab 4: 好友系统
	connect_managed(_view._line_friend_search.text_changed, _on_friend_search_changed)
	connect_managed(_view._friend_tab_container.tab_changed, _on_friend_tab_changed)
	connect_managed(_view._friend_list.item_selected, _on_friend_selected)
	connect_managed(_view._add_friend_button.pressed, _on_add_friend_pressed)
	connect_managed(_view._delete_friend_button.pressed, _on_friend_action_pressed.bind("ui.fe09.friend.delete_toast"))
	connect_managed(_view._whisper_friend_button.pressed, _on_friend_action_pressed.bind("ui.fe09.friend.whisper_toast"))

	# Tab 5: NPC对话
	connect_managed(_view._npc_quest_button.pressed, _on_npc_action_pressed.bind("ui.fe09.npc.quest_toast"))
	connect_managed(_view._npc_shop_button.pressed, _on_npc_action_pressed.bind("ui.fe09.npc.shop_toast"))
	connect_managed(_view._npc_leave_button.pressed, _on_npc_leave_pressed)

	# Tab 6: 玩家交易
	connect_managed(_view._my_inventory_list.item_selected, _on_my_inventory_selected)
	connect_managed(_view._my_trade_list.item_selected, _on_my_trade_selected)
	connect_managed(_view._my_trade_gold_spin_box.value_changed, _on_trade_gold_changed)
	connect_managed(_view._trade_lock_button.pressed, _on_trade_lock_pressed)
	connect_managed(_view._trade_confirm_button.pressed, _on_trade_confirm_pressed)
	connect_managed(_view._trade_cancel_button.pressed, _on_trade_cancel_pressed)

# ==============================================================================
# Mock 数据装配
# ==============================================================================

## 装配好友、NPC 对话、玩家交易及各聊天频道预设快照数据。
func init_mock_data() -> void:
	if _view == null:
		return
	_view._friends = [
		{"name": "ui.fe09.mock.member.grain", "location": "ui.fe09.mock.location.valan", "online": true, "category": FriendCategory.FRIEND, "level": 28},
		{"name": "ui.fe09.mock.member.silvia", "location": "ui.fe09.mock.location.silver_grove", "online": true, "category": FriendCategory.FRIEND, "level": 25},
		{"name": "ui.fe09.mock.member.darius", "location": "ui.fe09.mock.location.iron_fortress", "online": false, "category": FriendCategory.FRIEND, "level": 30},
		{"name": "ui.fe09.mock.member.eleanor", "location": "ui.fe09.mock.location.dragon_peak", "online": true, "category": FriendCategory.FRIEND, "level": 22},
		{"name": "ui.fe09.mock.member.kyle", "location": "ui.fe09.mock.location.valan", "online": false, "category": FriendCategory.FRIEND, "level": 19},
		{"name": "ui.fe09.mock.member.lillian", "location": "ui.fe09.mock.location.offline", "online": false, "category": FriendCategory.FRIEND, "level": 27},
		{"name": "ui.fe09.mock.friend.blackmerchant", "location": "ui.fe09.mock.location.valan", "online": false, "category": FriendCategory.BLACKLIST, "level": 15},
		{"name": "ui.fe09.mock.friend.scammer", "location": "ui.fe09.mock.location.offline", "online": false, "category": FriendCategory.BLACKLIST, "level": 10},
		{"name": "ui.fe09.mock.friend.passerby_a", "location": "ui.fe09.mock.location.iron_fortress", "online": true, "category": FriendCategory.STRANGER, "level": 12},
		{"name": "ui.fe09.mock.friend.passerby_b", "location": "ui.fe09.mock.location.silver_grove", "online": false, "category": FriendCategory.STRANGER, "level": 8},
	]
	_view._npc_dialogs = [
		{"npc_name": "ui.fe09.mock.npc.blacksmith", "npc_title": "ui.fe09.mock.npc_title.blacksmith", "text": "ui.fe09.mock.dialog.blacksmith.text", "options": [ {"text": "ui.fe09.mock.dialog.blacksmith.option_quest", "action": "QUEST"}, {"text": "ui.fe09.mock.dialog.blacksmith.option_shop", "action": "SHOP"}, {"text": "ui.fe09.mock.dialog.blacksmith.option_leave", "action": "LEAVE"}]},
		{"npc_name": "ui.fe09.mock.npc.guild_steward", "npc_title": "ui.fe09.mock.npc_title.steward", "text": "ui.fe09.mock.dialog.steward.text", "options": [ {"text": "ui.fe09.mock.dialog.steward.option_quest", "action": "QUEST"}, {"text": "ui.fe09.mock.dialog.steward.option_shop", "action": "SHOP"}, {"text": "ui.fe09.mock.dialog.steward.option_leave", "action": "LEAVE"}]},
		{"npc_name": "ui.fe09.mock.npc.mysterious_traveler", "npc_title": "ui.fe09.mock.npc_title.unknown", "text": "ui.fe09.mock.dialog.traveler.text", "options": [ {"text": "ui.fe09.mock.dialog.traveler.option_quest", "action": "QUEST"}, {"text": "ui.fe09.mock.dialog.traveler.option_shop", "action": "SHOP"}, {"text": "ui.fe09.mock.dialog.traveler.option_leave", "action": "LEAVE"}]},
	]
	_view._trade_partner_name = "ui.fe09.mock.trade_partner"
	_view._my_inventory = [
		{"name": "ui.fe09.mock.item.mithril_sword", "rarity": "RARE", "qty": 1},
		{"name": "ui.fe09.mock.item.leather_armor", "rarity": "COMMON", "qty": 1},
		{"name": "ui.fe09.mock.item.hp_potion", "rarity": "COMMON", "qty": 12},
		{"name": "ui.fe09.mock.item.mp_potion", "rarity": "COMMON", "qty": 8},
		{"name": "ui.fe09.mock.item.mithril_ore", "rarity": "UNCOMMON", "qty": 3},
		{"name": "ui.fe09.mock.item.dragon_scale", "rarity": "EPIC", "qty": 2},
		{"name": "ui.fe09.mock.item.ancient_scroll", "rarity": "RARE", "qty": 1},
		{"name": "ui.fe09.mock.item.speed_charm", "rarity": "UNCOMMON", "qty": 5},
	]
	_view._partner_trade_items = [
		{"name": "ui.fe09.mock.item.magic_crystal", "rarity": "RARE", "qty": 10},
		{"name": "ui.fe09.mock.item.elf_bow", "rarity": "RARE", "qty": 1},
		{"name": "ui.fe09.mock.item.silver_herb", "rarity": "COMMON", "qty": 20},
	]
	_view._chat_channels[0]["messages"] = [
		{"sender": "ui.fe09.mock.member.meryl", "text": "ui.fe09.chat.mock.guild_msg_1"},
		{"sender": "ui.fe09.mock.member.grain", "text": "ui.fe09.chat.mock.guild_msg_2"},
		{"sender": "ui.fe09.mock.member.silvia", "text": "ui.fe09.chat.mock.guild_msg_3"},
		{"sender": "ui.fe09.mock.member.altria", "text": "ui.fe09.chat.mock.guild_msg_4"},
	]
	_view._chat_channels[1]["messages"] = [
		{"sender": "ui.fe09.mock.member.altria", "text": "ui.fe09.chat.mock.officer_msg_1"},
		{"sender": "ui.fe09.mock.member.meryl", "text": "ui.fe09.chat.mock.officer_msg_2"},
	]
	_view._chat_channels[2]["messages"] = [
		{"sender": "ui.fe09.mock.friend.passerby_a", "text": "ui.fe09.chat.mock.world_msg_1"},
		{"sender": "ui.fe09.mock.member.beowulf", "text": "ui.fe09.chat.mock.world_msg_2"},
		{"sender": "ui.fe09.chat.sender_system", "text": "ui.fe09.chat.mock.world_msg_3"},
	]
	_view._chat_channels[3]["messages"] = [
		{"sender": "ui.fe09.chat.sender_system", "text": "ui.fe09.chat.mock.party_msg_1"},
		{"sender": "ui.fe09.mock.member.kyle", "text": "ui.fe09.chat.mock.party_msg_2"},
	]
	_view._chat_channels[4]["messages"] = [
		{"sender": "ui.fe09.mock.friend.blackmerchant", "text": "ui.fe09.chat.mock.trade_msg_1"},
		{"sender": "ui.fe09.mock.member.isabella", "text": "ui.fe09.chat.mock.trade_msg_2"},
	]

# ==============================================================================
# Tab 3: 聊天频道 (CHAT_CHANNELS)
# ==============================================================================

func _init_chat_channels_tab() -> void:
	_populate_channel_list()
	if _view._channel_list.get_item_count() > 0:
		_view._channel_list.select(0)
		_view._current_channel_index = 0
	_refresh_chat_display()

func _populate_channel_list() -> void:
	_view._channel_list.clear()
	var empty_messages: Array = []
	for channel in _view._chat_channels:
		var message_count: int = channel.get("messages", empty_messages).size()
		var channel_name := UIIntermediary.text(str(channel.get("name", "")))
		var channel_item_text := UIIntermediary.text("ui.fe09.chat.channel_item", {"name": channel_name, "count": message_count})
		_view._channel_list.add_item(channel_item_text)

func _refresh_chat_display() -> void:
	if not _view.is_inside_tree():
		return
	_view._rich_text_chat_messages.clear()
	if _view._current_channel_index < 0 or _view._current_channel_index >= _view._chat_channels.size():
		return
	var channel: Dictionary = _view._chat_channels[_view._current_channel_index]
	var messages: Array = channel.get("messages", [])
	var theme_manager := ThemeManager.get_instance()
	var channel_name := UIIntermediary.text(str(channel.get("name", "")))
	for message_entry in messages:
		var sender_key: String = str(message_entry.get("sender", ""))
		var sender := UIIntermediary.text(sender_key)
		var message_text := UIIntermediary.text(str(message_entry.get("text", "")))
		var color_tag := theme_manager.get_bbcode_color_tag("GUILD")
		if sender_key == "ui.fe09.chat.sender_system":
			color_tag = theme_manager.get_bbcode_color_tag("SYSTEM")
		var formatted_message := UIIntermediary.text("ui.fe09.chat.message_format", {"channel": channel_name, "sender": sender, "text": message_text})
		_view._rich_text_chat_messages.append_text("%s%s[/color]\n" % [color_tag, formatted_message])

func _on_channel_selected(index: int) -> void:
	_view._current_channel_index = index
	_refresh_chat_display()

func _on_channel_settings_pressed() -> void:
	NavManager.get_instance().show_toast(UIIntermediary.text("ui.fe09.chat.settings_toast"), NavTypes.ToastLevel.INFO)

func _on_chat_send_pressed() -> void:
	_send_chat_message()

func _on_chat_input_submitted(_text: String) -> void:
	_send_chat_message()

func _send_chat_message() -> void:
	var text: String = _view._line_chat_input.text.strip_edges()
	if text.is_empty() or _view._current_channel_index < 0 or _view._current_channel_index >= _view._chat_channels.size():
		return
	var sender := "ui.fe09.mock.local_player_name"
	var channel: Dictionary = _view._chat_channels[_view._current_channel_index]
	var message_list: Array = channel["messages"]
	message_list.append({"sender": sender, "text": text})
	if message_list.size() > _view._max_chat_lines:
		message_list.pop_front()
	_view._line_chat_input.clear()
	var channel_name := UIIntermediary.text(str(channel.get("name", "")))
	if _view._current_channel_index < _view._channel_list.get_item_count():
		var channel_item_text := UIIntermediary.text("ui.fe09.chat.channel_item", {"name": channel_name, "count": message_list.size()})
		_view._channel_list.set_item_text(_view._current_channel_index, channel_item_text)
		_view._channel_list.select(_view._current_channel_index)
	if _view.is_inside_tree() and _view._rich_text_chat_messages != null:
		var theme_manager := ThemeManager.get_instance()
		var color_tag := theme_manager.get_bbcode_color_tag("GUILD")
		var formatted_message := UIIntermediary.text("ui.fe09.chat.message_format", {"channel": channel_name, "sender": UIIntermediary.text(sender), "text": UIIntermediary.text(text)})
		_view._rich_text_chat_messages.append_text("%s%s[/color]\n" % [color_tag, formatted_message])
		while _view._rich_text_chat_messages.get_paragraph_count() > _view._max_chat_lines:
			_view._rich_text_chat_messages.remove_paragraph(0)

# ==============================================================================
# Tab 4: 好友系统 (FRIENDS)
# ==============================================================================

func _init_friends_tab() -> void:
	_populate_friend_list()

func _populate_friend_list() -> void:
	_view._friend_list.clear()
	for friend_entry in _get_visible_friends():
		var friend_name := UIIntermediary.text(str(friend_entry.get("name", "")))
		var status_icon := "●" if friend_entry.get("online", false) else "○"
		var location := UIIntermediary.text(str(friend_entry.get("location", "")))
		var level := int(friend_entry.get("level", 0))
		var friend_item_text := UIIntermediary.text("ui.fe09.friend.list_item", {
			"icon": status_icon, "name": friend_name, "level": level, "location": location,
		})
		_view._friend_list.add_item(friend_item_text)

func _refresh_friend_detail(index: int) -> void:
	var visible_friends := _get_visible_friends()
	if index < 0 or index >= visible_friends.size():
		UIIntermediary.resolve(_view._label_friend_detail_name, "ui.fe09.friend.detail_name_none")
		UIIntermediary.resolve(_view._label_friend_detail_location, "ui.fe09.friend.location_none")
		UIIntermediary.resolve(_view._label_friend_detail_online, "ui.fe09.friend.status_none")
		return
	var friend_entry: Dictionary = visible_friends[index]
	var friend_name := UIIntermediary.text(str(friend_entry.get("name", "")))
	var location := UIIntermediary.text(str(friend_entry.get("location", "")))
	var online := bool(friend_entry.get("online", false))
	var status_key := "ui.fe09.common.status_online" if online else "ui.fe09.common.status_offline"
	_view._label_friend_detail_name.text = friend_name
	UIIntermediary.resolve(_view._label_friend_detail_location, "ui.fe09.friend.location_label", {"name": location})
	UIIntermediary.resolve(_view._label_friend_detail_online, "ui.fe09.friend.status_label", {"status": UIIntermediary.text(status_key)})

func _get_visible_friends() -> Array:
	var visible_friends := []
	var keyword: String = _view._line_friend_search.text.strip_edges().to_lower()
	for friend_entry in _view._friends:
		if friend_entry.get("category", FriendCategory.FRIEND) != _view._current_friend_category:
			continue
		var friend_name := UIIntermediary.text(str(friend_entry.get("name", "")))
		if not keyword.is_empty() and not friend_name.to_lower().contains(keyword):
			continue
		visible_friends.append(friend_entry)
	return visible_friends

func _on_friend_search_changed(_text: String) -> void:
	_populate_friend_list()
	_view._friend_selected_index = -1
	_refresh_friend_detail(-1)

func _on_friend_tab_changed(tab_index: int) -> void:
	match tab_index:
		0: _view._current_friend_category = FriendCategory.FRIEND
		1: _view._current_friend_category = FriendCategory.BLACKLIST
		2: _view._current_friend_category = FriendCategory.STRANGER
	_populate_friend_list()
	_view._friend_selected_index = -1
	_refresh_friend_detail(-1)

func _on_friend_selected(index: int) -> void:
	_view._friend_selected_index = index
	_refresh_friend_detail(index)

func _on_add_friend_pressed() -> void:
	NavManager.get_instance().show_toast(UIIntermediary.text("ui.fe09.friend.add_toast"), NavTypes.ToastLevel.INFO)

func _on_friend_action_pressed(toast_key: String) -> void:
	var visible_friends := _get_visible_friends()
	if _view._friend_selected_index >= 0 and _view._friend_selected_index < visible_friends.size():
		var friend_entry: Dictionary = visible_friends[_view._friend_selected_index]
		NavManager.get_instance().show_toast(UIIntermediary.text(toast_key, {"name": UIIntermediary.text(str(friend_entry.get("name", "")))}), NavTypes.ToastLevel.INFO)

# ==============================================================================
# Tab 5: NPC对话 (NPC_DIALOG)
# ==============================================================================

func _init_npc_dialog_tab() -> void:
	_view._current_dialog_index = 0
	_refresh_npc_dialog_display()

func _refresh_npc_dialog_display() -> void:
	if not _view.is_inside_tree() or _view._npc_dialogs.is_empty():
		return
	var dialog_entry: Dictionary = _view._npc_dialogs[_view._current_dialog_index]
	_view._label_npc_name.text = UIIntermediary.text(str(dialog_entry.get("npc_name", "")))
	_view._npc_title_label.text = UIIntermediary.text(str(dialog_entry.get("npc_title", "")))
	_view._rich_text_npc_dialog.clear()
	_view._rich_text_npc_dialog.append_text(UIIntermediary.text(str(dialog_entry.get("text", ""))))
	var options: Array = dialog_entry.get("options", [])
	for option_index in range(options.size()):
		var option_entry: Dictionary = options[option_index]
		var option_button: Button = _acquire_dialog_option_button(option_index)
		option_button.visible = true
		option_button.text = UIIntermediary.text(str(option_entry.get("text", "")))
		option_button.set_meta("dialog_action", str(option_entry.get("action", "LEAVE")))
	for child_index in range(options.size(), _view._dialog_options_box.get_child_count()):
		_view._dialog_options_box.get_child(child_index).visible = false

## 获取或创建 NPC 对话选项按钮（池化复用，动态读取选项动作元数据）
func _acquire_dialog_option_button(index: int) -> Button:
	if index < _view._dialog_options_box.get_child_count():
		return _view._dialog_options_box.get_child(index) as Button
	var option_button := KButtonClass.new()
	option_button.variant = KButtonClass.StyleVariant.SECONDARY
	option_button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	connect_managed(option_button.pressed, func():
		var dialog_action: String = str(option_button.get_meta("dialog_action", "LEAVE"))
		_on_dialog_option_pressed(index, dialog_action)
	)
	_view._dialog_options_box.add_child(option_button)
	return option_button

func _on_dialog_option_pressed(_option_index: int, action: String) -> void:
	match action:
		"QUEST":
			NavManager.get_instance().show_toast(UIIntermediary.text("ui.fe09.npc.quest_toast"), NavTypes.ToastLevel.INFO)
		"SHOP":
			NavManager.get_instance().show_toast(UIIntermediary.text("ui.fe09.npc.shop_toast"), NavTypes.ToastLevel.INFO)
		"LEAVE":
			_on_npc_leave_pressed()

func _on_npc_action_pressed(toast_key: String) -> void:
	NavManager.get_instance().show_toast(UIIntermediary.text(toast_key), NavTypes.ToastLevel.INFO)

func _on_npc_leave_pressed() -> void:
	_view._current_dialog_index = (_view._current_dialog_index + 1) % _view._npc_dialogs.size()
	_refresh_npc_dialog_display()

# ==============================================================================
# Tab 6: 玩家交易 (PLAYER_TRADE)
# ==============================================================================

func _init_player_trade_tab() -> void:
	_view._trade_locked = false
	_view._trade_confirmed = false
	_view._my_trade_items = []
	UIIntermediary.resolve(_view._label_trade_partner, "ui.fe09.trade.partner_label", {"name": UIIntermediary.text(_view._trade_partner_name)})
	_populate_trade_item_list(_view._my_inventory_list, _view._my_inventory)
	_populate_trade_item_list(_view._my_trade_list, _view._my_trade_items)
	_populate_trade_item_list(_view._partner_trade_list, _view._partner_trade_items)
	_refresh_trade_status()
	_view._my_trade_gold_spin_box.value = 0
	UIIntermediary.resolve(_view._label_partner_gold, "ui.fe09.trade.partner_gold_label", {"amount": 3500})

func _populate_trade_item_list(target_item_list: ItemList, item_entries: Array) -> void:
	target_item_list.clear()
	var item_parameters: Dictionary = {"name": "", "rarity": "", "qty": 1}
	for trade_item in item_entries:
		item_parameters["name"] = UIIntermediary.text(str(trade_item.get("name", "")))
		item_parameters["rarity"] = _rarity_display(str(trade_item.get("rarity", "")))
		item_parameters["qty"] = int(trade_item.get("qty", 1))
		target_item_list.add_item(UIIntermediary.text("ui.fe09.trade.item_display", item_parameters))

func _refresh_trade_status() -> void:
	if _view._trade_confirmed:
		UIIntermediary.resolve(_view._label_trade_status, "ui.fe09.trade.status_label", {"status": UIIntermediary.text("ui.fe09.trade.status_confirmed")})
	elif _view._trade_locked:
		UIIntermediary.resolve(_view._label_trade_status, "ui.fe09.trade.status_label", {"status": UIIntermediary.text("ui.fe09.trade.status_locked")})
	else:
		UIIntermediary.resolve(_view._label_trade_status, "ui.fe09.trade.status_label", {"status": UIIntermediary.text("ui.fe09.trade.status_in_progress")})
	UIIntermediary.resolve(_view._trade_lock_button, "ui.fe09.trade.btn_unlock" if _view._trade_locked else "ui.fe09.trade.btn_lock")
	_view._trade_lock_button.disabled = _view._trade_confirmed
	_view._trade_confirm_button.disabled = not _view._trade_locked or _view._trade_confirmed

func _on_my_inventory_selected(index: int) -> void:
	if _view._trade_locked or _view._trade_confirmed or index < 0 or index >= _view._my_inventory.size():
		return
	var selected_item: Dictionary = _view._my_inventory[index]
	_view._my_trade_items.append(selected_item.duplicate())
	_populate_trade_item_list(_view._my_trade_list, _view._my_trade_items)

func _on_my_trade_selected(index: int) -> void:
	if _view._trade_locked or _view._trade_confirmed or index < 0 or index >= _view._my_trade_items.size():
		return
	_view._my_trade_items.remove_at(index)
	_populate_trade_item_list(_view._my_trade_list, _view._my_trade_items)

func _on_trade_gold_changed(_gold_amount: float) -> void:
	_refresh_trade_status()

func _on_trade_lock_pressed() -> void:
	_apply_trade_transition("lock")

func _on_trade_confirm_pressed() -> void:
	_apply_trade_transition("confirm")

func _on_trade_cancel_pressed() -> void:
	_apply_trade_transition("cancel")
	_view._my_trade_items.clear()
	_view._my_trade_gold_spin_box.value = 0
	_populate_trade_item_list(_view._my_trade_list, _view._my_trade_items)
	_refresh_trade_status()

func _apply_trade_transition(action: String) -> void:
	var transition_result := ServiceLocator.get_instance().guild().trade_transition({
		"locked": _view._trade_locked,
		"confirmed": _view._trade_confirmed,
	}, action)
	if not bool(transition_result.get("success", false)):
		return
	_view._trade_locked = bool(transition_result.get("locked", _view._trade_locked))
	_view._trade_confirmed = bool(transition_result.get("confirmed", _view._trade_confirmed))
	_refresh_trade_status()

func _rarity_display(rarity: String) -> String:
	return UIIntermediary.text("ui.fe03.rarity." + rarity.to_lower())

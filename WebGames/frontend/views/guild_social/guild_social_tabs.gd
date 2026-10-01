# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第9卷: 公会社交 Tab 子面板控制器
# 文件路径: res://frontend/views/guild_social/guild_social_tabs.gd
# 职责: 承接聊天频道/好友系统/NPC对话/玩家交易四个 Tab 的初始化、列表填充、事件处理与Mock数据
# ==============================================================================
class_name GuildSocialTabs
extends BaseScreen

enum FriendCategory {FRIEND, BLACKLIST, STRANGER}

const KButtonClass = preload("res://frontend/components/k_button.gd")
const KPageHeaderClass = preload("res://frontend/components/k_page_header.gd")
const KSearchBarClass = preload("res://frontend/components/k_search_bar.gd")
const KRarityTagClass = preload("res://frontend/components/k_rarity_tag.gd")

var page_header: KPageHeader = null
var search_bar: KSearchBar = null
var _view = null

func setup(view: BaseScreen) -> void:
	_view = view

func create_page_header(title_key: String) -> KPageHeader:
	if page_header == null:
		page_header = KPageHeaderClass.new(); page_header.title_key = title_key
		page_header.back_pressed.connect(func(): if _view != null: _view.back())
	return page_header

func create_search_bar(ph_key: String = "") -> KSearchBar:
	if search_bar == null:
		search_bar = KSearchBarClass.new(); search_bar.placeholder_key = ph_key
	return search_bar

# ==============================================================================
# 信号绑定
# ==============================================================================

func connect_signals() -> void:
	if _view == null:
		return
	# Tab 3: 聊天频道
	_view._channel_list.item_selected.connect(_on_channel_selected)
	_view._btn_channel_settings.pressed.connect(_on_channel_settings_pressed)
	_view._btn_chat_send.pressed.connect(_on_chat_send_pressed)
	_view._line_chat_input.text_submitted.connect(_on_chat_input_submitted)

	# Tab 4: 好友系统
	_view._line_friend_search.text_changed.connect(_on_friend_search_changed)
	_view._friend_tab_container.tab_changed.connect(_on_friend_tab_changed)
	_view._friend_list.item_selected.connect(_on_friend_selected)
	_view._btn_add_friend.pressed.connect(_on_add_friend_pressed)
	_view._btn_delete_friend.pressed.connect(_on_delete_friend_pressed)
	_view._btn_whisper_friend.pressed.connect(_on_whisper_friend_pressed)

	# Tab 5: NPC对话
	_view._btn_npc_quest.pressed.connect(_on_npc_quest_pressed)
	_view._btn_npc_shop.pressed.connect(_on_npc_shop_pressed)
	_view._btn_npc_leave.pressed.connect(_on_npc_leave_pressed)

	# Tab 6: 玩家交易
	_view._my_inventory_list.item_selected.connect(_on_my_inventory_selected)
	_view._my_trade_list.item_selected.connect(_on_my_trade_selected)
	_view._spin_my_trade_gold.value_changed.connect(_on_trade_gold_changed)
	_view._btn_trade_lock.pressed.connect(_on_trade_lock_pressed)
	_view._btn_trade_confirm.pressed.connect(_on_trade_confirm_pressed)
	_view._btn_trade_cancel.pressed.connect(_on_trade_cancel_pressed)

# ==============================================================================
# Mock 数据装配
# ==============================================================================

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
	for channel in _view._chat_channels:
		var msg_count: int = channel.get("messages", []).size()
		var channel_name := UIIntermediary.text(str(channel.get("name", "")))
		var display := UIIntermediary.text("ui.fe09.chat.channel_item", {"name": channel_name, "count": msg_count})
		_view._channel_list.add_item(display)

func _refresh_chat_display() -> void:
	if not _view.is_inside_tree():
		return
	_view._richtext_chat_messages.clear()
	if _view._current_channel_index < 0 or _view._current_channel_index >= _view._chat_channels.size():
		return
	var channel: Dictionary = _view._chat_channels[_view._current_channel_index]
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
		_view._richtext_chat_messages.append_text("%s%s[/color]\n" % [color_tag, line])

func _on_channel_selected(index: int) -> void:
	_view._current_channel_index = index
	_refresh_chat_display()

func _on_channel_settings_pressed() -> void:
	print("[GuildSocial] 频道设置（骨架阶段：未接线）")

func _on_chat_send_pressed() -> void:
	_send_chat_message()

func _on_chat_input_submitted(_text: String) -> void:
	_send_chat_message()

func _send_chat_message() -> void:
	var text: String = _view._line_chat_input.text.strip_edges()
	if text.is_empty() or _view._current_channel_index < 0 or _view._current_channel_index >= _view._chat_channels.size():
		return
	var sender := "ui.fe09.mock.local_player_name"
	_view._chat_channels[_view._current_channel_index]["messages"].append({"sender": sender, "text": text})
	var msg_list: Array = _view._chat_channels[_view._current_channel_index]["messages"]
	if msg_list.size() > _view._max_chat_lines:
		msg_list.pop_front()
	_view._line_chat_input.clear()
	_populate_channel_list()
	if _view._current_channel_index < _view._channel_list.get_item_count():
		_view._channel_list.select(_view._current_channel_index)
	_refresh_chat_display()

# ==============================================================================
# Tab 4: 好友系统 (FRIENDS)
# ==============================================================================

func _init_friends_tab() -> void:
	_populate_friend_list()

func _populate_friend_list() -> void:
	_view._friend_list.clear()
	var keyword: String = _view._line_friend_search.text.strip_edges().to_lower()
	for friend in _view._friends:
		if friend.get("category", FriendCategory.FRIEND) != _view._current_friend_category:
			continue
		var fname := UIIntermediary.text(str(friend.get("name", "")))
		if not keyword.is_empty() and not fname.to_lower().contains(keyword):
			continue
		var status_icon := "●" if friend.get("online", false) else "○"
		var location := UIIntermediary.text(str(friend.get("location", "")))
		var level := int(friend.get("level", 0))
		var display := UIIntermediary.text("ui.fe09.friend.list_item", {
			"icon": status_icon, "name": fname, "level": level, "location": location,
		})
		_view._friend_list.add_item(display)

func _refresh_friend_detail(index: int) -> void:
	var visible_friends := _get_visible_friends()
	if index < 0 or index >= visible_friends.size():
		UIIntermediary.resolve(_view._label_friend_detail_name, "ui.fe09.friend.detail_name_none")
		UIIntermediary.resolve(_view._label_friend_detail_location, "ui.fe09.friend.location_none")
		UIIntermediary.resolve(_view._label_friend_detail_online, "ui.fe09.friend.status_none")
		return
	var friend: Dictionary = visible_friends[index]
	var friend_name := UIIntermediary.text(str(friend.get("name", "")))
	var location := UIIntermediary.text(str(friend.get("location", "")))
	var online := bool(friend.get("online", false))
	var status_key := "ui.fe09.common.status_online" if online else "ui.fe09.common.status_offline"
	_view._label_friend_detail_name.text = friend_name
	UIIntermediary.resolve(_view._label_friend_detail_location, "ui.fe09.friend.location_label", {"name": location})
	UIIntermediary.resolve(_view._label_friend_detail_online, "ui.fe09.friend.status_label", {"status": UIIntermediary.text(status_key)})

func _get_visible_friends() -> Array:
	var result := []
	var keyword: String = _view._line_friend_search.text.strip_edges().to_lower()
	for friend in _view._friends:
		if friend.get("category", FriendCategory.FRIEND) != _view._current_friend_category:
			continue
		var fname := UIIntermediary.text(str(friend.get("name", "")))
		if not keyword.is_empty() and not fname.to_lower().contains(keyword):
			continue
		result.append(friend)
	return result

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
	print("[GuildSocial] 添加好友（骨架阶段：未接线）")

func _on_delete_friend_pressed() -> void:
	var visible_friends := _get_visible_friends()
	if _view._friend_selected_index >= 0 and _view._friend_selected_index < visible_friends.size():
		var friend: Dictionary = visible_friends[_view._friend_selected_index]
		print("[GuildSocial] 删除好友: %s" % friend.get("name", ""))

func _on_whisper_friend_pressed() -> void:
	var visible_friends := _get_visible_friends()
	if _view._friend_selected_index >= 0 and _view._friend_selected_index < visible_friends.size():
		var friend: Dictionary = visible_friends[_view._friend_selected_index]
		print("[GuildSocial] 私聊好友: %s" % friend.get("name", ""))

# ==============================================================================
# Tab 5: NPC对话 (NPC_DIALOG)
# ==============================================================================

func _init_npc_dialog_tab() -> void:
	_view._current_dialog_index = 0
	_refresh_npc_dialog_display()

func _refresh_npc_dialog_display() -> void:
	if not _view.is_inside_tree() or _view._npc_dialogs.is_empty():
		return
	var dialog: Dictionary = _view._npc_dialogs[_view._current_dialog_index]
	_view._label_npc_name.text = UIIntermediary.text(str(dialog.get("npc_name", "")))
	_view._npc_title_label.text = UIIntermediary.text(str(dialog.get("npc_title", "")))
	_view._richtext_npc_dialog.clear()
	_view._richtext_npc_dialog.append_text(UIIntermediary.text(str(dialog.get("text", ""))))
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
		_view._vbox_dialog_options.add_child(btn)

func _clear_dialog_options() -> void:
	for child in _view._vbox_dialog_options.get_children():
		child.queue_free()

func _on_dialog_option_pressed(_option_index: int, action: String) -> void:
	match action:
		"QUEST": print("[GuildSocial] 接取任务（骨架阶段：未接线）")
		"SHOP": print("[GuildSocial] 打开商店（骨架阶段：未接线）")
		"LEAVE":
			_view._current_dialog_index = (_view._current_dialog_index + 1) % _view._npc_dialogs.size()
			_refresh_npc_dialog_display()

func _on_npc_quest_pressed() -> void:
	print("[GuildSocial] 任务接取（骨架阶段：未接线）")

func _on_npc_shop_pressed() -> void:
	print("[GuildSocial] 打开商店（骨架阶段：未接线）")

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
	_populate_my_inventory_list()
	_refresh_my_trade_list()
	_refresh_partner_trade_list()
	_refresh_trade_status()
	_view._spin_my_trade_gold.value = 0
	UIIntermediary.resolve(_view._label_partner_gold, "ui.fe09.trade.partner_gold_label", {"amount": 3500})

func _populate_my_inventory_list() -> void:
	_view._my_inventory_list.clear()
	for item in _view._my_inventory:
		var item_name := UIIntermediary.text(str(item.get("name", "")))
		var rarity_display := _rarity_display(str(item.get("rarity", "")))
		var qty := int(item.get("qty", 1))
		var display := UIIntermediary.text("ui.fe09.trade.item_display", {"name": item_name, "rarity": rarity_display, "qty": qty})
		_view._my_inventory_list.add_item(display)

func _refresh_my_trade_list() -> void:
	_view._my_trade_list.clear()
	for item in _view._my_trade_items:
		var item_name := UIIntermediary.text(str(item.get("name", "")))
		var rarity_display := _rarity_display(str(item.get("rarity", "")))
		var qty := int(item.get("qty", 1))
		var display := UIIntermediary.text("ui.fe09.trade.item_display", {"name": item_name, "rarity": rarity_display, "qty": qty})
		_view._my_trade_list.add_item(display)

func _refresh_partner_trade_list() -> void:
	_view._partner_trade_list.clear()
	for item in _view._partner_trade_items:
		var item_name := UIIntermediary.text(str(item.get("name", "")))
		var rarity_display := _rarity_display(str(item.get("rarity", "")))
		var qty := int(item.get("qty", 1))
		var display := UIIntermediary.text("ui.fe09.trade.item_display", {"name": item_name, "rarity": rarity_display, "qty": qty})
		_view._partner_trade_list.add_item(display)

func _refresh_trade_status() -> void:
	if _view._trade_confirmed:
		UIIntermediary.resolve(_view._label_trade_status, "ui.fe09.trade.status_label", {"status": UIIntermediary.text("ui.fe09.trade.status_confirmed")})
	elif _view._trade_locked:
		UIIntermediary.resolve(_view._label_trade_status, "ui.fe09.trade.status_label", {"status": UIIntermediary.text("ui.fe09.trade.status_locked")})
	else:
		UIIntermediary.resolve(_view._label_trade_status, "ui.fe09.trade.status_label", {"status": UIIntermediary.text("ui.fe09.trade.status_in_progress")})
	UIIntermediary.resolve(_view._btn_trade_lock, "ui.fe09.trade.btn_unlock" if _view._trade_locked else "ui.fe09.trade.btn_lock")
	_view._btn_trade_lock.disabled = _view._trade_confirmed
	_view._btn_trade_confirm.disabled = not _view._trade_locked or _view._trade_confirmed

func _on_my_inventory_selected(index: int) -> void:
	if _view._trade_locked or _view._trade_confirmed or index < 0 or index >= _view._my_inventory.size():
		return
	var item: Dictionary = _view._my_inventory[index]
	_view._my_trade_items.append(item.duplicate())
	_refresh_my_trade_list()

func _on_my_trade_selected(index: int) -> void:
	if _view._trade_locked or _view._trade_confirmed or index < 0 or index >= _view._my_trade_items.size():
		return
	_view._my_trade_items.remove_at(index)
	_refresh_my_trade_list()

func _on_trade_gold_changed(_value: float) -> void:
	_refresh_trade_status()

func _on_trade_lock_pressed() -> void:
	_apply_trade_transition("lock")

func _on_trade_confirm_pressed() -> void:
	_apply_trade_transition("confirm")

func _on_trade_cancel_pressed() -> void:
	_apply_trade_transition("cancel")
	_view._my_trade_items.clear()
	_view._spin_my_trade_gold.value = 0
	_refresh_my_trade_list()
	_refresh_trade_status()

func _apply_trade_transition(action: String) -> void:
	var result := MockServiceContainer.get_instance().guild().trade_transition({
		"locked": _view._trade_locked,
		"confirmed": _view._trade_confirmed,
	}, action)
	if not bool(result.get("success", false)):
		return
	_view._trade_locked = bool(result.get("locked", _view._trade_locked))
	_view._trade_confirmed = bool(result.get("confirmed", _view._trade_confirmed))
	_refresh_trade_status()

func _rarity_display(rarity: String) -> String:
	return UIIntermediary.text("ui.fe03.rarity." + rarity.to_lower())

# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Mocks)
# 文件路径: res://frontend/domain_boundary/mocks/mock_social_mail_fixtures.gd
# 架构定位: Guild, Mail & Misc Edge Mock Fixture Module
# 依赖与触发: 上游: MockDataCatalog | 下游: 无（静态演示数据真源）
# 职责说明: 提供公会社交、邮件信箱与杂项边界域的静态模拟夹具。
# 退出语义与设计依据: 模拟数据单一真源与按域模块化拆分契约
# ==============================================================================

## 公会社交、邮件信箱与杂项边界域静态模拟数据集
class_name MockSocialMailFixtures
extends RefCounted

static func _friend(name_key: String, location_slug: String, online: bool, category_index: int, member_level: int) -> Dictionary:
	return {
		"name": "ui.fe09.mock." + name_key,
		"location": "ui.fe09.mock.location." + location_slug,
		"online": online,
		"category": category_index,
		"level": member_level,
	}

static func _npc_dialog(npc_slug: String, title_slug: String, dialog_slug: String) -> Dictionary:
	var dialog_prefix := "ui.fe09.mock.dialog." + dialog_slug + "."
	return {
		"npc_name": "ui.fe09.mock.npc." + npc_slug,
		"npc_title": "ui.fe09.mock.npc_title." + title_slug,
		"text": dialog_prefix + "text",
		"options": [
			{"text": dialog_prefix + "option_quest", "action": "QUEST"},
			{"text": dialog_prefix + "option_shop", "action": "SHOP"},
			{"text": dialog_prefix + "option_leave", "action": "LEAVE"},
		],
	}

static func _mail(mid: String, mail_index: String, category_name: String, is_read: bool, has_att: bool, claimed: bool, attachment_count: int) -> Dictionary:
	var mail_prefix := "ui.fe08.mock.mail_" + mail_index + "_"
	var atts: Array = []
	for attach_index in range(attachment_count):
		atts.append(mail_prefix + "attach_" + str(attach_index))
	return {
		"mail_id": mid,
		"category": category_name,
		"sender_key": mail_prefix + "sender",
		"recipient_key": mail_prefix + "recipient",
		"subject_key": mail_prefix + "subject",
		"body_key": mail_prefix + "body",
		"time_key": mail_prefix + "time",
		"is_read": is_read,
		"has_attachment": has_att,
		"is_claimed": claimed,
		"attachment_keys": atts,
	}

## 构建公会成员、NPC 对话、个人交易栏位与聊天消息模拟数据
static func build_guild_data() -> Dictionary:
	var item_prefix := "ui.fe09.mock.item."
	return {
		"guild_name": "ui.fe09.mock.guild_name",
		"guild_level": 7,
		"guild_leader": "ui.fe09.mock.guild_leader",
		"guild_funds": 128500,
		"guild_announcement": "ui.fe09.mock.guild_announcement",
		"friends": [
			_friend("member.grain", "valan", true, 0, 28),
			_friend("member.silvia", "silver_grove", true, 0, 25),
			_friend("member.darius", "iron_fortress", false, 0, 30),
			_friend("member.eleanor", "dragon_peak", true, 0, 22),
			_friend("member.kyle", "valan", false, 0, 19),
			_friend("member.lillian", "offline", false, 0, 27),
			_friend("friend.blackmerchant", "valan", false, 1, 15),
			_friend("friend.scammer", "offline", false, 1, 10),
			_friend("friend.passerby_a", "iron_fortress", true, 2, 12),
			_friend("friend.passerby_b", "silver_grove", false, 2, 8),
		],
		"npc_dialogs": [
			_npc_dialog("blacksmith", "blacksmith", "blacksmith"),
			_npc_dialog("guild_steward", "steward", "steward"),
			_npc_dialog("mysterious_traveler", "unknown", "traveler"),
		],
		"trade_partner_name": "ui.fe09.mock.trade_partner",
		"my_inventory": [
			{"name": item_prefix + "mithril_sword", "rarity": "RARE", "qty": 1},
			{"name": item_prefix + "leather_armor", "rarity": "COMMON", "qty": 1},
			{"name": item_prefix + "hp_potion", "rarity": "COMMON", "qty": 12},
			{"name": item_prefix + "mp_potion", "rarity": "COMMON", "qty": 8},
			{"name": item_prefix + "mithril_ore", "rarity": "UNCOMMON", "qty": 3},
			{"name": item_prefix + "dragon_scale", "rarity": "EPIC", "qty": 2},
			{"name": item_prefix + "ancient_scroll", "rarity": "RARE", "qty": 1},
			{"name": item_prefix + "speed_charm", "rarity": "UNCOMMON", "qty": 5},
		],
		"partner_trade_items": [
			{"name": item_prefix + "magic_crystal", "rarity": "RARE", "qty": 10},
			{"name": item_prefix + "elf_bow", "rarity": "RARE", "qty": 1},
			{"name": item_prefix + "silver_herb", "rarity": "COMMON", "qty": 20},
		],
		"chat_messages_by_channel": _build_chat_channels(),
	}

static func _build_chat_channels() -> Array:
	var member_prefix := "ui.fe09.mock."
	var chat_prefix := "ui.fe09.chat.mock."
	var sys := "ui.fe09.chat.sender_system"
	return [
		[
			{"sender": member_prefix + "member.meryl", "text": chat_prefix + "guild_msg_1"},
			{"sender": member_prefix + "member.grain", "text": chat_prefix + "guild_msg_2"},
			{"sender": member_prefix + "member.silvia", "text": chat_prefix + "guild_msg_3"},
			{"sender": member_prefix + "member.altria", "text": chat_prefix + "guild_msg_4"},
		],
		[
			{"sender": member_prefix + "member.altria", "text": chat_prefix + "officer_msg_1"},
			{"sender": member_prefix + "member.meryl", "text": chat_prefix + "officer_msg_2"},
		],
		[
			{"sender": member_prefix + "friend.passerby_a", "text": chat_prefix + "world_msg_1"},
			{"sender": member_prefix + "member.beowulf", "text": chat_prefix + "world_msg_2"},
			{"sender": sys, "text": chat_prefix + "world_msg_3"},
		],
		[
			{"sender": sys, "text": chat_prefix + "party_msg_1"},
			{"sender": member_prefix + "member.kyle", "text": chat_prefix + "party_msg_2"},
		],
		[
			{"sender": member_prefix + "friend.blackmerchant", "text": chat_prefix + "trade_msg_1"},
			{"sender": member_prefix + "member.isabella", "text": chat_prefix + "trade_msg_2"},
		],
	]

## 构建邮箱邮件列表模拟数据
static func build_mail_data() -> Dictionary:
	return {
		"unread_count": 2,
		"mails": [
			_mail("M_01", "01", "REWARD", false, true, false, 2),
			_mail("M_02", "02", "REWARD", false, true, false, 1),
			_mail("M_03", "03", "GUILD", true, false, false, 0),
			_mail("M_04", "04", "GUILD", true, false, false, 0),
			_mail("M_05", "05", "PLAYER", true, true, true, 1),
			_mail("M_06", "06", "PLAYER", true, false, false, 0),
			_mail("M_07", "07", "SYSTEM", true, true, true, 2),
			_mail("M_08", "08", "GUILD", true, false, false, 0),
			_mail("M_09", "09", "PLAYER", true, true, true, 1),
			_mail("M_10", "10", "REWARD", false, true, false, 2),
		],
	}

## 构建杂项更名历史记录模拟数据
static func build_misc_edge_data() -> Dictionary:
	return {
		"name_history": [
			{"type": 0, "name_key": "ui.fe17.mock.char.real_name", "time": "2026-08-01 10:00", "success": true},
			{"type": 2, "name_key": "ui.fe17.mock.guild.dawn_wing", "time": "2026-08-15 14:30", "success": true},
		],
	}

# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Mocks)
# 文件路径: res://frontend/domain_boundary/mocks/mock_social_mail_fixtures.gd
# 架构定位: Guild, Mail & Misc Edge Mock Fixture Module
# 依赖与触发: 上游: MockDataCatalog | 下游: 无（静态演示数据真源）
# 职责说明: 提供公会社交、邮件信箱与杂项边界域的静态模拟夹具。
# 退出语义与设计依据: 模拟数据单一真源与按域模块化拆分契约
# ==============================================================================

## 公会社交、邮件信箱与杂项边界域静态模拟数据集
extends RefCounted

static func _friend(name_key: String, loc_slug: String, online: bool, cat: int, lvl: int) -> Dictionary:
	return {
		"name": "ui.fe09.mock." + name_key,
		"location": "ui.fe09.mock.location." + loc_slug,
		"online": online,
		"category": cat,
		"level": lvl,
	}

static func _npc_dialog(npc_slug: String, title_slug: String, dlg_slug: String) -> Dictionary:
	var dp := "ui.fe09.mock.dialog." + dlg_slug + "."
	return {
		"npc_name": "ui.fe09.mock.npc." + npc_slug,
		"npc_title": "ui.fe09.mock.npc_title." + title_slug,
		"text": dp + "text",
		"options": [
			{"text": dp + "option_quest", "action": "QUEST"},
			{"text": dp + "option_shop", "action": "SHOP"},
			{"text": dp + "option_leave", "action": "LEAVE"},
		],
	}

static func _mail(mid: String, num: String, cat: String, is_read: bool, has_att: bool, claimed: bool, att_n: int) -> Dictionary:
	var mp := "ui.fe08.mock.mail_" + num + "_"
	var atts: Array = []
	for i in range(att_n):
		atts.append(mp + "attach_" + str(i))
	return {
		"mail_id": mid,
		"category": cat,
		"sender_key": mp + "sender",
		"recipient_key": mp + "recipient",
		"subject_key": mp + "subject",
		"body_key": mp + "body",
		"time_key": mp + "time",
		"is_read": is_read,
		"has_attachment": has_att,
		"is_claimed": claimed,
		"attachment_keys": atts,
	}

## 构建公会成员、NPC 对话、个人交易栏位与聊天消息模拟数据
static func build_guild_data() -> Dictionary:
	var ip := "ui.fe09.mock.item."
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
			{"name": ip + "mithril_sword", "rarity": "RARE", "qty": 1},
			{"name": ip + "leather_armor", "rarity": "COMMON", "qty": 1},
			{"name": ip + "hp_potion", "rarity": "COMMON", "qty": 12},
			{"name": ip + "mp_potion", "rarity": "COMMON", "qty": 8},
			{"name": ip + "mithril_ore", "rarity": "UNCOMMON", "qty": 3},
			{"name": ip + "dragon_scale", "rarity": "EPIC", "qty": 2},
			{"name": ip + "ancient_scroll", "rarity": "RARE", "qty": 1},
			{"name": ip + "speed_charm", "rarity": "UNCOMMON", "qty": 5},
		],
		"partner_trade_items": [
			{"name": ip + "magic_crystal", "rarity": "RARE", "qty": 10},
			{"name": ip + "elf_bow", "rarity": "RARE", "qty": 1},
			{"name": ip + "silver_herb", "rarity": "COMMON", "qty": 20},
		],
		"chat_messages_by_channel": _build_chat_channels(),
	}

static func _build_chat_channels() -> Array:
	var mp := "ui.fe09.mock."
	var cp := "ui.fe09.chat.mock."
	var sys := "ui.fe09.chat.sender_system"
	return [
		[
			{"sender": mp + "member.meryl", "text": cp + "guild_msg_1"},
			{"sender": mp + "member.grain", "text": cp + "guild_msg_2"},
			{"sender": mp + "member.silvia", "text": cp + "guild_msg_3"},
			{"sender": mp + "member.altria", "text": cp + "guild_msg_4"},
		],
		[
			{"sender": mp + "member.altria", "text": cp + "officer_msg_1"},
			{"sender": mp + "member.meryl", "text": cp + "officer_msg_2"},
		],
		[
			{"sender": mp + "friend.passerby_a", "text": cp + "world_msg_1"},
			{"sender": mp + "member.beowulf", "text": cp + "world_msg_2"},
			{"sender": sys, "text": cp + "world_msg_3"},
		],
		[
			{"sender": sys, "text": cp + "party_msg_1"},
			{"sender": mp + "member.kyle", "text": cp + "party_msg_2"},
		],
		[
			{"sender": mp + "friend.blackmerchant", "text": cp + "trade_msg_1"},
			{"sender": mp + "member.isabella", "text": cp + "trade_msg_2"},
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

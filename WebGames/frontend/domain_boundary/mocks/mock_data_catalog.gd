# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端数据桩: 全域 Mock 数据集
# 文件路径: res://frontend/domain_boundary/mocks/mock_data_catalog.gd
# 职责: 集中提供覆盖 17 个视图的完整 100% Mock 演示数据集，支持无后端独立运转
# ==============================================================================
class_name MockDataCatalog
extends RefCounted

## 获取指定域的 Mock 数据快照
static func get_domain_data(domain_id: String) -> Dictionary:
	match domain_id:
		"account":
			return {
				"default_servers": [
					{ "id": "LOCAL_OFFLINE", "name": "单机离线·瓦尔兰大陆", "status": "ONLINE", "ping_ms": 0 },
					{ "id": "SERVER_01", "name": "启蒙之森 [电信]", "status": "ONLINE", "ping_ms": 18 },
					{ "id": "SERVER_02", "name": "永夜深渊 [网通]", "status": "MAINTENANCE", "ping_ms": 999 }
				],
				"character_slots": [
					{ "slot_id": "SLOT_01", "name": "阿尔托莉雅", "race": "HUMAN", "class": "SwordSaint", "level": 25, "town": "VALAN_CAPITAL", "empty": false },
					{ "slot_id": "SLOT_02", "name": "梅莉尔", "race": "ELF", "class": "ArchMage", "level": 18, "town": "SILVER_GROVE", "empty": false },
					{ "slot_id": "SLOT_03", "name": "", "race": "", "class": "", "level": 0, "town": "", "empty": true }
				]
			}
		"character":
			return {
				"name": "阿尔托莉雅",
				"title": "剑道宗师 / 圣魔导师 / 极效魔剑士",
				"age_years": 20,
				"age_months": 5,
				"attributes": {
					"STR": 14, "AGI": 12, "CON": 13, "INT": 16, "WIS": 15, "CHA": 10
				},
				"potential_points": 5,
				"vitality": { "sf": 0.72, "msf": 0.85, "hunger": 80, "energy": 65 },
				"equipped_slots": {
					"MAIN_HAND": { "name": "秘银长剑", "rarity": "RARE", "atk": 28 },
					"OFF_HAND": null,
					"HEAD": null,
					"CHEST": { "name": "精制皮甲", "rarity": "COMMON", "def": 12 },
					"LEGS": null,
					"FEET": null,
					"NECK": null,
					"RING_L": null,
					"RING_R": null
				},
				"inventory_count": 23,
				"inventory_max": 30
			}
		"hud_snapshot":
			return {
				"character_id": "CHAR_ARTORIA_01",
				"character_name": "阿尔托莉雅",
				"race_name": "HUMAN",
				"location_name": "瓦尔兰王都",
				"hp_current": 100.0,
				"hp_max": 100.0,
				"ap_current": 10.0,
				"ap_max": 10.0,
				"gold": 12580,
				"silver": 45,
				"copper": 500,
				"mana_monocrystals": 12,
				"attribute_values": { "STR": 14.5, "AGI": 12.0, "CON": 13.0, "INT": 16.0, "WIS": 15.0, "CHA": 10.0 },
				"attribute_levels": { "STR": 2, "AGI": 2, "CON": 2, "INT": 3, "WIS": 3, "CHA": 1 }
			}
		"combat":
			return {
				"boss_name": "炎狱魔龙",
				"boss_hp": 8500.0,
				"boss_max_hp": 12000.0,
				"boss_parts": [
					{ "part_name": "龙头", "hp": 2000.0, "max_hp": 2000.0, "is_broken": false },
					{ "part_name": "左翼", "hp": 800.0, "max_hp": 1500.0, "is_broken": false },
					{ "part_name": "右翼", "hp": 0.0, "max_hp": 1500.0, "is_broken": true },
					{ "part_name": "龙尾", "hp": 1000.0, "max_hp": 1000.0, "is_broken": false }
				],
				"player_hp_current": 100.0,
				"player_hp_max": 100.0,
				"player_ap_current": 10.0,
				"player_ap_max": 10.0
			}
		"world_map":
			return {
				"landmarks": [
					{ "id": "VALAN_CAPITAL", "name": "瓦尔兰王都", "type": "CAPITAL", "x": 320, "y": 180 },
					{ "id": "SILVER_GROVE", "name": "银林精灵村", "type": "TOWN", "x": 180, "y": 250 },
					{ "id": "IRON_FORTRESS", "name": "铁岩要塞", "type": "FORTRESS", "x": 450, "y": 120 },
					{ "id": "DRAGON_PEAK", "name": "龙脊峰", "type": "DUNGEON", "x": 560, "y": 280 }
				],
				"marching_routes": [
					{ "from": "VALAN_CAPITAL", "to": "IRON_FORTRESS", "hours_remain": 6, "terrain": "PLAINS" }
				]
			}
		"economy":
			return {
				"wallet": { "gold": 50, "silver": 20, "copper": 500, "mana_monocrystals": 5 },
				"shop_title": "瓦尔兰老铁匠杂货铺",
				"shop_items": [
					{ "id": "IRON_SWORD", "name": "铁剑", "price_copper": 5000, "stock": 12 },
					{ "id": "HEALTH_POTION", "name": "治疗药水", "price_copper": 800, "stock": 45 },
					{ "id": "MANA_CRYSTAL_S", "name": "小型魔单晶", "price_copper": 12000, "stock": 3 }
				],
				"price_trend": [
					{ "day": -6, "iron_ore": 85 },
					{ "day": -5, "iron_ore": 88 },
					{ "day": -4, "iron_ore": 92 },
					{ "day": -3, "iron_ore": 90 },
					{ "day": -2, "iron_ore": 95 },
					{ "day": -1, "iron_ore": 98 },
					{ "day": 0, "iron_ore": 102 }
				]
			}
		"guild":
			return {
				"guild_name": "拂晓骑士团",
				"level": 5,
				"members_count": 28,
				"notice": "今晚八点公会领地首领战，请各位团员准时集合。"
			}
		"mail":
			return {
				"unread_count": 2,
				"mails": [
					{ "id": "MAIL_01", "title": "开服拓荒先驱补给", "sender": "系统管理员", "date": "2026-09-09", "read": false },
					{ "id": "MAIL_02", "title": "维护补偿", "sender": "运营团队", "date": "2026-09-08", "read": true }
				]
			}
		# R-25：可证伪的空态夹具——「非空」类断言注入本域即被证伪
		"empty_sample":
			return {}
		# R-25：极值/边界夹具——0 值、上限 1.0、int64 最大值，供防御与格式化边界用例
		"extreme_sample":
			return { "hp_current": 0.0, "hp_max": 1.0, "amount": 9223372036854775807 }
		_:
			# R-25：未登记域不再无条件返回非空兜底，使「非空」断言恢复可证伪。
			# 可诊断性说明：此处不得使用 push_warning（TC-LG-19 全库 push 散落零容忍，
			# 且前端严禁后端 ErrorReporter 直连），拼写错误的 domain_id 由
			# 「非空断言被空字典证伪」的契约测试路径暴露。
			return {}

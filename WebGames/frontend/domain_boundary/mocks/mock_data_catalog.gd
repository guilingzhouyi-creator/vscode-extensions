# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Mocks)
# 文件路径: res://frontend/domain_boundary/mocks/mock_data_catalog.gd
# 架构定位: Centralized Mock Data Catalog (Falsifiable Fixture Source)
# 依赖与触发: 上游: 各 Mock*Service 与无头视图测试 | 下游: 无（静态演示数据真源）
# 职责说明: 集中提供覆盖各业务域的演示数据集与边界夹具，支持无后端环境独立运转与可证伪测试。
# 退出语义与设计依据: 模拟数据单一真源与未登记域空态可证伪契约
# ==============================================================================

## MockDataCatalog：前端模拟数据集与可证伪测试夹具目录
class_name MockDataCatalog
extends RefCounted

## 获取指定域的 Mock 数据快照
static func get_domain_data(domain_id: String) -> Dictionary:
	match domain_id:
		"account":
			return {
				"default_servers": [
					{ "id": "LOCAL_OFFLINE", "name": "Local Offline Sandbox", "status": "ONLINE", "ping_ms": 0 },
					{ "id": "SERVER_01", "name": "Sandbox Realm 01", "status": "ONLINE", "ping_ms": 18 },
					{ "id": "SERVER_02", "name": "Sandbox Realm 02", "status": "MAINTENANCE", "ping_ms": 999 }
				],
				"character_slots": [
					{ "slot_id": "SLOT_01", "name": "SandboxHero01", "race": "MOCK_RACE", "class": "Vanguard", "level": 25, "town": "SANDBOX_HUB", "empty": false },
					{ "slot_id": "SLOT_02", "name": "SandboxHero02", "race": "MOCK_MAGE", "class": "Arcanist", "level": 18, "town": "OUTPOST_WEST", "empty": false },
					{ "slot_id": "SLOT_03", "name": "", "race": "", "class": "", "level": 0, "town": "", "empty": true }
				]
			}
		"character":
			return {
				"name": "SandboxHero01",
				"title": "Vanguard / Arcanist",
				"age_years": 20,
				"age_months": 5,
				"attributes": {
					"STR": 14, "AGI": 12, "CON": 13, "INT": 16, "WIS": 15, "CHA": 10
				},
				"potential_points": 5,
				"vitality": { "sf": 0.72, "msf": 0.85, "hunger": 80, "energy": 65 },
				"equipped_slots": {
					"MAIN_HAND": { "name": "Mock Steel Blade", "rarity": "RARE", "atk": 28 },
					"OFF_HAND": null,
					"HEAD": null,
					"CHEST": { "name": "Mock Hide Armor", "rarity": "COMMON", "def": 12 },
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
				"character_id": "CHAR_MOCK_01",
				"character_name": "SandboxHero01",
				"race_name": "MOCK_RACE",
				"location_name": "SANDBOX_HUB",
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
				"boss_name": "Sandbox Construct Alpha",
				"boss_hp": 8500.0,
				"boss_max_hp": 12000.0,
				"boss_parts": [
					{ "part_name": "Core Head", "hp": 2000.0, "max_hp": 2000.0, "is_broken": false },
					{ "part_name": "Left Wing", "hp": 800.0, "max_hp": 1500.0, "is_broken": false },
					{ "part_name": "Right Wing", "hp": 0.0, "max_hp": 1500.0, "is_broken": true },
					{ "part_name": "Tail", "hp": 1000.0, "max_hp": 1000.0, "is_broken": false }
				],
				"player_hp_current": 100.0,
				"player_hp_max": 100.0,
				"player_ap_current": 10.0,
				"player_ap_max": 10.0
			}
		"world_map":
			return {
				"landmarks": [
					{ "id": "SANDBOX_HUB", "name": "Sandbox Hub", "type": "CAPITAL", "x": 320, "y": 180 },
					{ "id": "OUTPOST_WEST", "name": "Western Outpost", "type": "TOWN", "x": 180, "y": 250 },
					{ "id": "BASTION_NORTH", "name": "Northern Bastion", "type": "FORTRESS", "x": 450, "y": 120 },
					{ "id": "RUINS_EAST", "name": "Eastern Ruins", "type": "DUNGEON", "x": 560, "y": 280 }
				],
				"marching_routes": [
					{ "from": "SANDBOX_HUB", "to": "BASTION_NORTH", "hours_remain": 6, "terrain": "PLAINS" }
				],
				"town_facilities": [
					{ "id": "FAC_INN", "name": "ui.fe10.mock.fac.inn.name", "desc": "ui.fe10.mock.fac.inn.desc" },
					{ "id": "FAC_SMITH", "name": "ui.fe10.mock.fac.smith.name", "desc": "ui.fe10.mock.fac.smith.desc" },
					{ "id": "FAC_GUILD", "name": "ui.fe10.mock.fac.guild.name", "desc": "ui.fe10.mock.fac.guild.desc" },
					{ "id": "FAC_MARKET", "name": "ui.fe10.mock.fac.market.name", "desc": "ui.fe10.mock.fac.market.desc" }
				],
				"town_npcs": [
					{ "id": "NPC_INNKEEPER", "name": "ui.fe10.mock.npc.innkeeper.name", "desc": "ui.fe10.mock.npc.innkeeper.desc" },
					{ "id": "NPC_BLACKSMITH", "name": "ui.fe10.mock.npc.blacksmith.name", "desc": "ui.fe10.mock.npc.blacksmith.desc" },
					{ "id": "NPC_GUILDMASTER", "name": "ui.fe10.mock.npc.guildmaster.name", "desc": "ui.fe10.mock.npc.guildmaster.desc" }
				],
				"territories": [
					{ "id": "TERR_01", "name": "ui.fe10.mock.terr.farmland.name", "food": 50, "wood": 10, "ore": 0, "garrison": 20, "construction": 0.65 },
					{ "id": "TERR_02", "name": "ui.fe10.mock.terr.silver_woods.name", "food": 20, "wood": 80, "ore": 5, "garrison": 10, "construction": 1.0 }
				],
				"sovereignty": {
					"nation_name": "ui.fe10.mock.sov.nation_name",
					"monarch": "ui.fe10.mock.sov.monarch",
					"population": 1200,
					"territory_count": 2,
					"level": "ui.fe10.mock.sov.level"
				}
			}
		"economy":
			return {
				"wallet": { "gold": 50, "silver": 20, "copper": 500, "mana_monocrystals": 5 },
				"shop_title": "Sandbox General Store",
				"shop_items": [
					{ "id": "ITEM_SWORD_MOCK", "name": "Mock Iron Sword", "price_copper": 5000, "stock": 12 },
					{ "id": "ITEM_POTION_MOCK", "name": "Mock Healing Potion", "price_copper": 800, "stock": 45 },
					{ "id": "ITEM_CRYSTAL_MOCK", "name": "Mock Mana Shard", "price_copper": 12000, "stock": 3 }
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
				"guild_name": "Sandbox Vanguard Guild",
				"level": 5,
				"members_count": 28,
				"notice": "Sandbox guild drill scheduled at 20:00."
			}
		"mail":
			return {
				"unread_count": 2,
				"mails": [
					{ "id": "MAIL_01", "title": "Sandbox Pioneer Supply", "sender": "System", "date": "2026-09-09", "read": false },
					{ "id": "MAIL_02", "title": "Maintenance Notice", "sender": "System", "date": "2026-09-08", "read": true }
				]
			}
		# 可证伪的空态夹具：「非空」类断言注入本域即被证伪
		"empty_sample":
			return {}
		# 极值/边界夹具：0 值、上限 1.0、int64 最大值，供防御与格式化边界用例验证
		"extreme_sample":
			return { "hp_current": 0.0, "hp_max": 1.0, "amount": 9223372036854775807 }
		_:
			# 未登记域不返回非空默认回退，确保「非空」断言可证伪。
			# 可诊断性说明：此处不得使用 push_warning（全库 push_warning 散落零容忍，
			# 且前端严禁后端 ErrorReporter 直连），拼写错误的 domain_id 由
			# 「非空断言被空字典证伪」的契约测试路径暴露。
			return {}

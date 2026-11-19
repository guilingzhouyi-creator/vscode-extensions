# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Mocks)
# 文件路径: res://frontend/domain_boundary/mocks/mock_world_combat_fixtures.gd
# 架构定位: HUD, Combat & World Map Mock Fixture Module
# 依赖与触发: 上游: MockDataCatalog | 下游: 无（静态演示数据真源）
# 职责说明: 提供主界面快照、战斗与世界地图域的静态模拟夹具。
# 退出语义与设计依据: 模拟数据单一真源与按域模块化拆分契约
# ==============================================================================

## 主界面快照、战斗与世界地图域静态模拟数据集
class_name MockWorldCombatFixtures
extends RefCounted

static func _boss_part(slug: String, current_hp: float, max_hp: float, broken: bool) -> Dictionary:
	return {
		"part_name": "ui.fe04.mock.part." + slug,
		"hp": current_hp,
		"max_hp": max_hp,
		"is_broken": broken,
	}

static func _fac_or_npc(entry_id: String, prefix: String) -> Dictionary:
	return {
		"id": entry_id,
		"name": prefix + ".name",
		"desc": prefix + ".desc",
	}

## 构建主 HUD 状态、任务与终端日志快照数据
static func build_hud_snapshot_data() -> Dictionary:
	return {
		"character_id": "CHAR_MOCK_01",
		"character_name": "SandboxHero01",
		"char_name_key": "ui.fe02.mock.char_name",
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
		"wallet_mana_crystals": 5,
		"coord_x": 320,
		"coord_y": 180,
		"attribute_values": {
			"STR": 14.5, "AGI": 12.0, "CON": 13.0,
			"INT": 16.0, "WIS": 15.0, "CHA": 10.0,
		},
		"attribute_levels": {
			"STR": 2, "AGI": 2, "CON": 2,
			"INT": 3, "WIS": 3, "CHA": 1,
		},
		"quests": [
			{"title": "ui.fe02.quest.main_title", "desc": "ui.fe02.quest.main_desc", "progress": 0.15},
			{"title": "ui.fe02.quest.side_title", "desc": "ui.fe02.quest.side_desc", "progress": 0.30},
			{"title": "ui.fe02.quest.daily_title", "desc": "ui.fe02.quest.daily_desc", "progress": 1.0},
		],
		"terminal_logs": [
			{"channel": "SYSTEM", "key": "ui.fe02.chat.mock.welcome"},
			{"channel": "WORLD", "key": "ui.fe02.chat.mock.world_msg", "use_char_name": true},
			{"channel": "GUILD", "key": "ui.fe02.chat.mock.guild_msg", "name_key": "ui.fe02.mock.name_meryl"},
		],
		"battle_logs": [
			{"channel": "COMBAT", "key": "ui.fe02.battle_log.mock.combat_hit", "params": {"damage": 128}},
			{"channel": "COMBAT", "key": "ui.fe02.battle_log.mock.combat_hit_back", "params": {"damage": 15}},
			{"channel": "LOOT", "key": "ui.fe02.battle_log.mock.loot"},
		],
	}

## 构建 Boss 部位破坏与战斗日志演示数据
static func build_combat_data() -> Dictionary:
	return {
		"boss_name": "ui.fe04.boss.name",
		"boss_hp": 8500.0,
		"boss_max_hp": 12000.0,
		"boss_parts": [
			_boss_part("head", 2000.0, 2000.0, false),
			_boss_part("wing_left", 800.0, 1500.0, false),
			_boss_part("wing_right", 300.0, 1500.0, true),
			_boss_part("tail", 1000.0, 1000.0, false),
		],
		"player_hp": 100.0,
		"player_max_hp": 100.0,
		"player_ap": 10.0,
		"player_max_ap": 10.0,
		"battle_logs": [
			{"channel": "COMBAT", "message_key": "ui.fe04.log.boss_awaken"},
			{"channel": "SYSTEM", "message_key": "ui.fe04.log.battle_start"},
			{
				"channel": "SKILL",
				"message_key": "ui.fe04.log.skill_cd",
				"skill_key": "ui.fe04.skill.SKILL_FIREBALL",
				"seconds": "2.0",
			},
			{"channel": "LOOT", "message_key": "ui.fe04.log.part_broken_loot"},
		],
	}

## 构建世界地标、行军路线、城镇设施与领地主权模拟数据
static func build_world_map_data() -> Dictionary:
	return {
		"landmarks": [
			{"id": "SANDBOX_HUB", "name": "Sandbox Hub", "type": "CAPITAL", "x": 320, "y": 180},
			{"id": "OUTPOST_WEST", "name": "Western Outpost", "type": "TOWN", "x": 180, "y": 250},
			{"id": "BASTION_NORTH", "name": "Northern Bastion", "type": "FORTRESS", "x": 450, "y": 120},
			{"id": "RUINS_EAST", "name": "Eastern Ruins", "type": "DUNGEON", "x": 560, "y": 280},
		],
		"marching_routes": [
			{"from": "SANDBOX_HUB", "to": "BASTION_NORTH", "hours_remain": 6, "terrain": "PLAINS"},
		],
		"town_facilities": [
			_fac_or_npc("FAC_INN", "ui.fe10.mock.fac.inn"),
			_fac_or_npc("FAC_SMITH", "ui.fe10.mock.fac.smith"),
			_fac_or_npc("FAC_GUILD", "ui.fe10.mock.fac.guild"),
			_fac_or_npc("FAC_MARKET", "ui.fe10.mock.fac.market"),
		],
		"town_npcs": [
			_fac_or_npc("NPC_INNKEEPER", "ui.fe10.mock.npc.innkeeper"),
			_fac_or_npc("NPC_BLACKSMITH", "ui.fe10.mock.npc.blacksmith"),
			_fac_or_npc("NPC_GUILDMASTER", "ui.fe10.mock.npc.guildmaster"),
		],
		"territories": [
			{
				"id": "TERR_01",
				"name": "ui.fe10.mock.terr.farmland.name",
				"food": 50,
				"wood": 10,
				"ore": 0,
				"garrison": 20,
				"construction": 0.65,
			},
			{
				"id": "TERR_02",
				"name": "ui.fe10.mock.terr.silver_woods.name",
				"food": 20,
				"wood": 80,
				"ore": 5,
				"garrison": 10,
				"construction": 1.0,
			},
		],
		"sovereignty": {
			"nation_name": "ui.fe10.mock.sov.nation_name",
			"monarch": "ui.fe10.mock.sov.monarch",
			"population": 1200,
			"territory_count": 2,
			"level": "ui.fe10.mock.sov.level",
		},
	}

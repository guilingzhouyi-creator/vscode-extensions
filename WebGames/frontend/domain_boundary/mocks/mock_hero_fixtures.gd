# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Mocks)
# 文件路径: res://frontend/domain_boundary/mocks/mock_hero_fixtures.gd
# 架构定位: Account & Character Mock Fixture Module
# 依赖与触发: 上游: MockDataCatalog | 下游: 无（静态演示数据真源）
# 职责说明: 提供账号与角色域的静态模拟夹具，通过构造器消除重复键值并控密。
# 退出语义与设计依据: 模拟数据单一真源与按域模块化拆分契约
# ==============================================================================

## 账号与角色域静态模拟数据集
extends RefCounted

static func _inv(id: String, slug: String, cat: String, qty: int, weight: float) -> Dictionary:
	return {
		"id": id,
		"name": "ui.fe03.mock.item." + slug,
		"category": cat,
		"qty": qty,
		"weight": weight,
	}

static func _skill(id: String, slug: String, level: int, status: String) -> Dictionary:
	return {
		"id": id,
		"name": "ui.fe03.mock.skill." + slug,
		"level": level,
		"status": status,
		"desc": "ui.fe03.mock.skill." + slug + ".desc",
	}

static func _title(id: String, slug: String, rank: String, equipped: bool) -> Dictionary:
	return {
		"id": id,
		"name": "ui.fe03.mock.title." + slug,
		"rank": "ui.fe03.title.rank." + rank,
		"equipped": equipped,
	}

## 构建账号域默认服务器与角色槽位演示数据
static func build_account_data() -> Dictionary:
	return {
		"default_servers": [
			{"id": "LOCAL_OFFLINE", "name": "Local Offline Sandbox", "status": "ONLINE", "ping_ms": 0},
			{"id": "SERVER_01", "name": "Sandbox Realm 01", "status": "ONLINE", "ping_ms": 18},
			{"id": "SERVER_02", "name": "Sandbox Realm 02", "status": "MAINTENANCE", "ping_ms": 999},
		],
		"character_slots": [
			{
				"slot_id": "SLOT_01",
				"name": "SandboxHero01",
				"race": "MOCK_RACE",
				"class": "Vanguard",
				"level": 25,
				"town": "SANDBOX_HUB",
				"empty": false,
			},
			{
				"slot_id": "SLOT_02",
				"name": "SandboxHero02",
				"race": "MOCK_MAGE",
				"class": "Arcanist",
				"level": 18,
				"town": "OUTPOST_WEST",
				"empty": false,
			},
			{
				"slot_id": "SLOT_03",
				"name": "",
				"race": "",
				"class": "",
				"level": 0,
				"town": "",
				"empty": true,
			},
		],
	}

## 构建角色属性、装备、技能、称号与背包模拟数据
static func build_character_data() -> Dictionary:
	var lore_p := "ui.fe03.mock.lore."
	return {
		"name": "SandboxHero01",
		"title": "Vanguard / Arcanist",
		"age_years": 20,
		"age_months": 5,
		"attributes": {
			"STR": 14, "AGI": 12, "CON": 13,
			"INT": 16, "WIS": 15, "CHA": 10,
		},
		"potential_points": 5,
		"vitality": {"sf": 0.72, "msf": 0.85, "hunger": 80, "energy": 65},
		"equipped_slots": {
			"MAIN_HAND": {"name": "Mock Steel Blade", "rarity": "RARE", "atk": 28},
			"OFF_HAND": null,
			"HEAD": null,
			"CHEST": {"name": "Mock Hide Armor", "rarity": "COMMON", "def": 12},
			"LEGS": null,
			"FEET": null,
			"NECK": null,
			"RING_L": null,
			"RING_R": null,
		},
		"inventory_count": 23,
		"inventory_max": 30,
		"skills": [
			_skill("SKILL_SLASH", "slash", 3, "LEARNED"),
			_skill("SKILL_FIREBALL", "fireball", 2, "LEARNED"),
			_skill("SKILL_DASH", "dash", 1, "LEARNED"),
			_skill("SKILL_FORGE", "forge", 0, "LOCKED"),
			_skill("SKILL_DRAGON", "dragon", 0, "LOCKED"),
		],
		"titles": [
			_title("TITLE_SWORD_MASTER", "sword_master", "heroic", true),
			_title("TITLE_ARCH_MAGE", "arch_mage", "heroic", false),
			_title("TITLE_MAGIC_SWORD", "magic_sword", "heroic", false),
			_title("TITLE_DRAGON_SLAYER", "dragon_slayer", "legendary", false),
			_title("TITLE_EXPLORER", "explorer", "mortal", false),
		],
		"lore": {
			"background": lore_p + "background",
			"milestones": [
				lore_p + "milestone1", lore_p + "milestone2",
				lore_p + "milestone3", lore_p + "milestone4", lore_p + "milestone5",
			],
			"achievements": [
				lore_p + "achievement1", lore_p + "achievement2",
				lore_p + "achievement3", lore_p + "achievement4", lore_p + "achievement5",
			],
		},
		"inventory_items": [
			_inv("ITEM_SWORD_MITHRIL", "sword_mithril", "WEAPON", 1, 3.5),
			_inv("ITEM_SWORD_IRON", "sword_iron", "WEAPON", 1, 2.8),
			_inv("ITEM_STAFF_MAGIC", "staff_magic", "WEAPON", 1, 1.5),
			_inv("ITEM_ARMOR_LEATHER", "armor_leather", "ARMOR", 1, 4.0),
			_inv("ITEM_HELM_IRON", "helm_iron", "ARMOR", 1, 2.0),
			_inv("ITEM_LEGS_CHAIN", "legs_chain", "ARMOR", 1, 3.5),
			_inv("ITEM_POTION_HP", "potion_hp", "CONSUMABLE", 5, 0.5),
			_inv("ITEM_POTION_MP", "potion_mp", "CONSUMABLE", 3, 0.5),
			_inv("ITEM_HERB_ANTIDOTE", "herb_antidote", "CONSUMABLE", 2, 0.1),
			_inv("ITEM_ORE_MITHRIL", "ore_mithril", "MATERIAL", 3, 1.0),
			_inv("ITEM_SCALE_DRAGON", "scale_dragon", "MATERIAL", 1, 0.8),
			_inv("ITEM_HERB_MAGIC", "herb_magic", "MATERIAL", 4, 0.2),
		],
	}

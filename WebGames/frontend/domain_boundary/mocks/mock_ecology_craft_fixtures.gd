# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Mocks)
# 文件路径: res://frontend/domain_boundary/mocks/mock_ecology_craft_fixtures.gd
# 架构定位: Monster Ecology, Crafting & Grimoire Mock Fixture Module
# 依赖与触发: 上游: MockDataCatalog | 下游: 无（静态演示数据真源）
# 职责说明: 提供怪物生态图鉴、锻造拆解材料与魔导书静态模拟夹具。
# 退出语义与设计依据: 模拟数据单一真源与按域模块化拆分契约
# ==============================================================================

## 怪物生态、合成工坊与魔导书域静态模拟数据集
extends RefCounted

static func _m(id: String, slug: String, level: int, category: int, drops: Array, weak: Array, discovered: bool) -> Dictionary:
	var p := "ui.fe11.bestiary.monster." + slug + "_"
	var drop_keys: Array = []
	for item in drops:
		drop_keys.append("ui.fe11.bestiary.drop." + str(item))
	var weak_keys: Array = []
	for elem in weak:
		weak_keys.append("ui.fe11.bestiary.element." + str(elem))
	return {
		"monster_id": id,
		"name_key": p + "name",
		"level": level,
		"category": category,
		"habitat_key": p + "habitat",
		"desc_key": p + "desc",
		"drop_keys": drop_keys,
		"weakness_keys": weak_keys,
		"discovered": discovered,
	}

static func _mat(slug: String, rarity: String, cat: String, qty: int) -> Dictionary:
	var k := "ui.fe12.mock.material." + slug
	return {
		"name": k,
		"rarity": rarity,
		"category": cat,
		"qty": qty,
		"desc": k,
		"source": "ui.fe12.mat_category." + cat,
	}

## 构建怪物生态图鉴模拟列表
static func build_monster_ecology_data() -> Dictionary:
	return {
		"monsters": [
			_m("MON_001", "mon001", 15, 0, ["dragon_scale_2", "fire_crystal_1"], ["ice", "water"], true),
			_m("MON_002", "mon002", 45, 0, ["ice_dragon_crystal_3", "frost_heart_1"], ["fire", "thunder"], false),
			_m("MON_003", "mon003", 8, 1, ["bone_fragment_5", "rusty_sword_1"], ["fire", "holy"], true),
			_m("MON_004", "mon004", 40, 1, ["lich_crown_1", "curse_scroll_2"], ["holy", "fire"], false),
			_m("MON_005", "mon005", 12, 2, ["wolf_pelt_2", "sharp_tooth_1"], ["fire", "thunder"], true),
			_m("MON_006", "mon006", 25, 2, ["snake_lizard_scale_3", "poison_sac_1"], ["ice", "thunder"], false),
			_m("MON_007", "mon007", 6, 3, ["beeswax_3", "poison_needle_1"], ["fire", "ice"], true),
			_m("MON_008", "mon008", 30, 3, ["spider_silk_5", "spider_queen_venom_1"], ["fire", "thunder"], false),
			_m("MON_009", "mon009", 10, 4, ["nectar_2", "vine_3"], ["fire", "ice"], true),
			_m("MON_010", "mon010", 28, 4, ["living_wood_3", "tree_heart_1"], ["fire", "dark"], false),
			_m("MON_011", "mon011", 18, 5, ["fire_crystal_1", "element_core_1"], ["water", "ice"], true),
			_m("MON_012", "mon012", 20, 5, ["wind_crystal_2", "element_core_1"], ["thunder", "earth"], false),
			_m("MON_013", "mon013", 5, 6, ["copper_coin_10", "rusty_dagger_1"], ["fire", "thunder"], true),
			_m("MON_014", "mon014", 22, 6, ["magic_scroll_1", "ogre_tooth_2"], ["ice", "holy"], false),
			_m("MON_015", "mon015", 8, 7, ["fish_scale_3", "sawtooth_1"], ["thunder", "fire"], true),
			_m("MON_016", "mon016", 35, 7, ["octopus_ink_3", "tentacle_2"], ["thunder", "fire"], false),
			_m("MON_017", "mon017", 16, 8, ["magic_stone_2", "stone_block_5"], ["thunder", "water"], true),
			_m("MON_018", "mon018", 38, 8, ["fine_iron_3", "golem_core_1"], ["thunder", "water"], false),
		],
	}

## 构建合成配方、拆解返还与材料库存模拟数据
static func build_crafting_data() -> Dictionary:
	var mp := "ui.fe12.mock.material."
	var fp := "ui.fe12.mock.forge."
	var dp := "ui.fe12.mock.dismantle."
	var forge_recipes := [
		{
			"name": fp + "mithril_sword", "rarity": "RARE", "category": "weapon",
			"materials": [{"name": mp + "mithril_ingot", "qty": 3}, {"name": mp + "iron_ore", "qty": 2}],
			"enhancement_level": 0, "learned": true,
		},
		{
			"name": fp + "leather_armor", "rarity": "COMMON", "category": "armor",
			"materials": [{"name": mp + "leather", "qty": 4}, {"name": mp + "thread", "qty": 2}],
			"enhancement_level": 2, "learned": true,
		},
		{
			"name": fp + "wind_bow", "rarity": "RARE", "category": "weapon",
			"materials": [{"name": mp + "wood", "qty": 5}, {"name": mp + "thread", "qty": 1}],
			"enhancement_level": 0, "learned": false,
		},
		{
			"name": fp + "arcane_staff", "rarity": "EPIC", "category": "weapon",
			"materials": [{"name": mp + "mana_shard", "qty": 6}, {"name": mp + "wood", "qty": 3}],
			"enhancement_level": 0, "learned": true,
		},
		{
			"name": fp + "dragon_armor", "rarity": "LEGENDARY", "category": "armor",
			"materials": [{"name": mp + "dragon_scale", "qty": 8}, {"name": mp + "mithril_ingot", "qty": 4}],
			"enhancement_level": 0, "learned": false,
		},
	]
	return {
		"forge_recipes": forge_recipes,
		"recipe_catalog": forge_recipes.duplicate(true),
		"dismantle_items": [
			{"name": dp + "old_sword", "rarity": "COMMON", "category": "weapon", "qty": 2, "yield": [{"name": mp + "iron_ore", "qty": 3}]},
			{"name": dp + "old_leather", "rarity": "COMMON", "category": "armor", "qty": 1, "yield": [{"name": mp + "leather", "qty": 2}]},
			{"name": dp + "broken_staff", "rarity": "RARE", "category": "weapon", "qty": 1, "yield": [{"name": mp + "mana_shard", "qty": 2}, {"name": mp + "wood", "qty": 2}]},
			{"name": dp + "excess_mithril", "rarity": "RARE", "category": "material", "qty": 5, "yield": [{"name": mp + "mana_shard", "qty": 1}]},
		],
		"materials": [
			_mat("iron_ore", "COMMON", "ore", 12),
			_mat("mithril_ingot", "RARE", "ore", 5),
			_mat("leather", "COMMON", "leather", 8),
			_mat("thread", "COMMON", "leather", 10),
			_mat("wood", "COMMON", "herb", 9),
			_mat("mana_shard", "EPIC", "gem", 6),
			_mat("dragon_scale", "LEGENDARY", "relic", 4),
		],
	}

## 构建魔导书术式图录模拟数据
static func build_grimoire_data() -> Dictionary:
	return {
		"grimoires": [
			{"id": "GRIM_001", "key": "g001", "rarity": "common", "category": 0, "learned": true},
			{"id": "GRIM_002", "key": "g002", "rarity": "rare", "category": 0, "learned": false},
			{"id": "GRIM_003", "key": "g003", "rarity": "common", "category": 1, "learned": true},
			{"id": "GRIM_004", "key": "g004", "rarity": "rare", "category": 1, "learned": false},
			{"id": "GRIM_005", "key": "g005", "rarity": "common", "category": 2, "learned": true},
			{"id": "GRIM_006", "key": "g006", "rarity": "common", "category": 2, "learned": false},
			{"id": "GRIM_007", "key": "g007", "rarity": "rare", "category": 3, "learned": false},
			{"id": "GRIM_008", "key": "g008", "rarity": "common", "category": 3, "learned": false},
			{"id": "GRIM_009", "key": "g009", "rarity": "common", "category": 4, "learned": true},
			{"id": "GRIM_010", "key": "g010", "rarity": "common", "category": 4, "learned": false},
			{"id": "GRIM_011", "key": "g011", "rarity": "common", "category": 5, "learned": true},
			{"id": "GRIM_012", "key": "g012", "rarity": "rare", "category": 5, "learned": false},
		],
	}

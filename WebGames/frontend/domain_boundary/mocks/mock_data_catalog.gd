# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Mocks)
# 文件路径: res://frontend/domain_boundary/mocks/mock_data_catalog.gd
# 架构定位: Centralized Mock Data Catalog (Falsifiable Fixture Source)
# 依赖与触发: 上游: 各 Mock*Service 与无头视图测试 | 下游: mock_*_fixtures.gd
# 职责说明: 按域路由调度演示数据集与边界夹具，支持无后端环境独立运转与可证伪测试。
# 退出语义与设计依据: 模拟数据单一真源与未登记域空态可证伪契约
# ==============================================================================

## MockDataCatalog：前端模拟数据集与可证伪测试夹具目录
class_name MockDataCatalog
extends RefCounted

const HeroFixtures := preload("res://frontend/domain_boundary/mocks/mock_hero_fixtures.gd")
const WorldCombatFixtures := preload("res://frontend/domain_boundary/mocks/mock_world_combat_fixtures.gd")
const MarketGachaFixtures := preload("res://frontend/domain_boundary/mocks/mock_market_gacha_fixtures.gd")
const QuestSystemFixtures := preload("res://frontend/domain_boundary/mocks/mock_quest_system_fixtures.gd")
const SocialMailFixtures := preload("res://frontend/domain_boundary/mocks/mock_social_mail_fixtures.gd")
const EcologyCraftFixtures := preload("res://frontend/domain_boundary/mocks/mock_ecology_craft_fixtures.gd")

## 获取指定域的 Mock 数据快照（未登记域返回空字典以确保断言可证伪）
static func get_domain_data(domain_id: String) -> Dictionary:
	var builders: Dictionary = {
		"account": HeroFixtures.build_account_data,
		"character": HeroFixtures.build_character_data,
		"hud_snapshot": WorldCombatFixtures.build_hud_snapshot_data,
		"combat": WorldCombatFixtures.build_combat_data,
		"world_map": WorldCombatFixtures.build_world_map_data,
		"economy": MarketGachaFixtures.build_economy_data,
		"gacha": MarketGachaFixtures.build_gacha_data,
		"quest": QuestSystemFixtures.build_quest_data,
		"guild": SocialMailFixtures.build_guild_data,
		"mail": SocialMailFixtures.build_mail_data,
		"monster_ecology": EcologyCraftFixtures.build_monster_ecology_data,
		"crafting": EcologyCraftFixtures.build_crafting_data,
		"grimoire": EcologyCraftFixtures.build_grimoire_data,
		"notification": QuestSystemFixtures.build_notification_data,
		"system_save": QuestSystemFixtures.build_system_save_data,
		"misc_edge": SocialMailFixtures.build_misc_edge_data,
		"empty_sample": func() -> Dictionary: return {},
		"extreme_sample": func() -> Dictionary: return {"hp_current": 0.0, "hp_max": 1.0, "amount": 9223372036854775807},
	}
	var key := domain_id.strip_edges()
	if builders.has(key):
		return (builders[key] as Callable).call()
	return {}

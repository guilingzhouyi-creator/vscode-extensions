# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/sovereignty_realm/sovereignty_entities.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/sovereignty.json | 信号: EventBus 领域广播
# 职责说明: 爵位头衔等级、封地领地自治实体与动态主权国家聚合根。 国家/封地默认值由 config/sovereignty.json 驱动。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name KnighthoodTitle extends RefCounted

enum TitleRank {
	COMMONER, # 平民
	KNIGHT,   # 骑士
	BARON,    # 男爵 (领有城镇)
	COUNT,    # 伯爵 (领有多镇)
	DUKE,     # 公爵 (封疆大吏)
	MONARCH   # 国王/皇帝
}

class FiefDemesneEntity extends RefCounted:
	var fief_id: String = ""
	var assigned_town_id: String = ""
	var lord_entity_id: String = ""
	var lord_tax_rate: float = GameConfig.get_float("domains.sovereignty", "fief_defaults/lord_tax_rate", 0.10)
	var title_rank: int = GameConfig.get_int("domains.sovereignty", "fief_defaults/title_rank", 2)

class NationRealmAggregate extends RefCounted:
	var nation_id: String = ""
	var canonical_nation_name: String = GameConfig.get_string("domains.sovereignty", "nation_defaults/canonical_nation_name", "卡拉尔至高神圣帝国")
	var sovereign_ruler_id: String = GameConfig.get_string("domains.sovereignty", "nation_defaults/sovereign_ruler_id", "RULER_EMPEROR")
	var territory_town_ids: Array = []
	var national_treasury_gold: int = GameConfig.get_int("domains.sovereignty", "nation_defaults/national_treasury_gold", 100000)
	var stability_percent: float = GameConfig.get_float("domains.sovereignty", "nation_defaults/stability_percent", 85.0)
	var tax_rate: float = GameConfig.get_float("domains.sovereignty", "nation_defaults/tax_rate", 0.15)
	var fiefs: Dictionary = {} # fief_id -> FiefDemesneEntity

	## 序列化主权国家聚合为字典
	func serialize() -> Dictionary:
		return {
			"nation_id": nation_id,
			"canonical_nation_name": canonical_nation_name,
			"sovereign_ruler_id": sovereign_ruler_id,
			"territory_town_ids": territory_town_ids,
			"national_treasury_gold": national_treasury_gold,
			"stability_percent": stability_percent,
			"tax_rate": tax_rate
		}

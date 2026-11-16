# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/sovereignty_realm/nation_realm_aggregate.gd
# 架构定位: Domain Logic Component
# 依赖与触发: 上游: SovereigntyAndFeoffmentSolver, NationSovereigntyAndCoupFSM | 下游: GameConfig
# 职责说明: 国家疆域聚合根实体模型，管理国库金币、稳定度、税率与封地集合。
# 退出语义与设计依据: 业务领域第一性原理与单文件单类映射契约
# ==============================================================================

## NationRealmAggregate：国家疆域聚合根实体模型，管理国库金币、稳定度、税率与封地集合。
class_name NationRealmAggregate
extends RefCounted

var nation_id: String = ""
var canonical_nation_name: String = GameConfig.get_string("domains.sovereignty", "nation_defaults/canonical_nation_name", "未命名城邦")
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

# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_navigation/town_settlement_aggregate.gd
# 架构定位: Domain Logic Component
# 依赖与触发: 上游: WorldTravelAndSettlementFSM | 下游: GameConfig | 配置: config/domains/world.json
# 职责说明: 城镇聚落聚合根实体模型，管理人口、治安、粮储、镇库资金与集市数据。
# 退出语义与设计依据: 业务领域第一性原理与单文件单类映射契约
# ==============================================================================

## TownSettlementAggregate：城镇聚落聚合根实体模型，管理人口、治安、粮储、镇库资金与集市数据。
class_name TownSettlementAggregate
extends RefCounted

var town_id: String = ""
var town_name: String = GameConfig.get_string("domains.world", "town_defaults/town_name", "未名要塞")
var governing_nation_id: String = GameConfig.get_string("domains.world", "town_defaults/governing_nation_id", "NATION_EMPIRE")
var population_count: int = GameConfig.get_int("domains.world", "town_defaults/population_count", 5000)
var public_order_percent: float = GameConfig.get_float("domains.world", "town_defaults/public_order_percent", 85.0) # 0 ~ 100
var food_reserve_days: float = GameConfig.get_float("domains.world", "town_defaults/food_reserve_days", 30.0)
var town_treasury_gold: int = GameConfig.get_int("domains.world", "town_defaults/town_treasury_gold", 1500)
var market_inventory: Dictionary = {}
var tavern_rumors: Array = []

## 序列化城镇定居点为字典（市场库存/酒馆传闻引用原表）
func serialize() -> Dictionary:
	return {
		"town_id": town_id,
		"town_name": town_name,
		"governing_nation_id": governing_nation_id,
		"population_count": population_count,
		"public_order_percent": public_order_percent,
		"food_reserve_days": food_reserve_days,
		"town_treasury_gold": town_treasury_gold,
		"market_inventory": market_inventory,
		"tavern_rumors": tavern_rumors
	}

# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_navigation/world_map_entities.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/world.json | 信号: EventBus 领域广播
# 职责说明: 地理图节点、地形介质阻抗、城镇定居点子图聚合。 节点/城镇默认值由 config/world.json 驱动。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name WorldMapGraphNode extends RefCounted

var node_id: String = ""
var node_name: String = ""
var continent_id: String = GameConfig.get_string("domains.world", "node_defaults/continent_id", "CENTRAL_CONTINENT")
var coordinates: Vector2 = Vector2.ZERO
var terrain_type: String = GameConfig.get_string("domains.world", "node_defaults/terrain_type", "PLAINS") # PLAINS / SWAMP / SNOW_MOUNTAIN / VOID_OCEAN
var regional_mana_density: float = GameConfig.get_float("domains.world", "node_defaults/regional_mana_density", 1.0) # 0.1 ~ 10.0
var outgoing_edges: Array = [] # [{ "target_node_id": "...", "distance": 10.0, "impedance": 1.0 }]

class TownSettlementAggregate extends RefCounted:
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

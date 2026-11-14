# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_navigation/world_map_graph_node.gd
# 架构定位: Domain Logic Component
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/world.json | 信号: EventBus 领域广播
# 职责说明: 地理图节点、地形介质阻抗、城镇定居点子图聚合。 节点/城镇默认值由 config/world.json 驱动。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
## WorldMapGraphNode：Domain Logic Component
class_name WorldMapGraphNode
extends RefCounted

var node_id: String = ""
var node_name: String = ""
var continent_id: String = GameConfig.get_string(
	"domains.world",
	"node_defaults/continent_id",
	"CENTRAL_CONTINENT"
)
var coordinates: Vector2 = Vector2.ZERO
var terrain_type: String = GameConfig.get_string(
	"domains.world",
	"node_defaults/terrain_type",
	"PLAINS"
) # PLAINS / SWAMP / SNOW_MOUNTAIN / VOID_OCEAN
var regional_mana_density: float = GameConfig.get_float("domains.world", "node_defaults/regional_mana_density", 1.0) # 0.1 ~ 10.0
var outgoing_edges: Array = [] # [{ "target_node_id": "...", "distance": 10.0, "impedance": 1.0 }]

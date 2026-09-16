# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/spatial_movement/spatial_location_entity.gd
# 架构定位: Domain Entity / Aggregate Root
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/spatial_movement.json | 信号: EventBus 领域广播
# 职责说明: 宏观离散图论索引与微观实数连续欧氏坐标并存，支持文字向 2D/3D 平滑演化
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name SpatialLocationEntity
extends RefCounted

# 1. 宏观离散图论定位（缺省值配置驱动：大陆/街区取本域 location_defaults，
#    定居点取世界默认城镇，多定居点扩展时只改 config/domains/world.json 一处）
var continent_id: String = GameConfig.get_string("domains.spatial_movement", "location_defaults/continent_id", "CONTINENT_CENTRAL")   # 大陆 ID
var region_node_id: String = GameConfig.get_string("domains.world", "node_defaults/town_id", "TOWN_VALAN")        # 定居点/城镇节点 ID
var interior_subgraph_id: String = GameConfig.get_string("domains.spatial_movement", "location_defaults/interior_subgraph_id", "MAIN_STREET")# 室内/街区子图 ID

# 2. 微观连续空间坐标 (米制, 1.0 = 1米)
var local_coordinates: Vector2 = Vector2.ZERO
var orientation_facing: Vector2 = Vector2.UP     # 当前朝向单位向量

# 移动力学属性
var base_move_speed_mps: float = GameConfig.get_float("domains.spatial_movement", "movement/base_move_speed_mps", 4.5)             # 基础移速 (米/秒)
var current_velocity: Vector2 = Vector2.ZERO     # 当前实时速度向量

## 传空串视为「未指定」，回落配置缺省值（GDScript 默认参数必须是常量，故用空串哨兵）
func _init(
	p_continent: String = "",
	p_region: String = "",
	p_subgraph: String = "",
	p_coords: Vector2 = Vector2.ZERO
) -> void:
	if not p_continent.is_empty():
		continent_id = p_continent
	if not p_region.is_empty():
		region_node_id = p_region
	if not p_subgraph.is_empty():
		interior_subgraph_id = p_subgraph
	local_coordinates = p_coords

func get_global_spatial_fingerprint() -> String:
	return "%s:%s:%s:(%.2f,%.2f)" % [continent_id, region_node_id, interior_subgraph_id, local_coordinates.x, local_coordinates.y]

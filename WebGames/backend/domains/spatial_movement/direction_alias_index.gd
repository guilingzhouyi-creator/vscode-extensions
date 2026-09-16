# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/spatial_movement/direction_alias_index.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/spatial_movement.json | 信号: EventBus 领域广播
# 职责说明: 维护文字方位别名到归一化物理向量的 O(1) 散列映射缓存
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name DirectionAliasIndex
extends RefCounted

var alias_to_vector_map: Dictionary = {}
var is_initialized: bool = false
var last_updated_utc: int = 0

func _init() -> void:
	alias_to_vector_map = {}
	is_initialized = false
	last_updated_utc = 0

func get_vector(key: String) -> Vector2:
	return alias_to_vector_map.get(key.strip_edges().to_upper(), Vector2.ZERO)

func has_alias(key: String) -> bool:
	return alias_to_vector_map.has(key.strip_edges().to_upper())

func to_dto() -> Dictionary:
	var serialized_map := {}
	for k in alias_to_vector_map.keys():
		var v: Vector2 = alias_to_vector_map[k]
		serialized_map[k] = [v.x, v.y]
	return {
		"alias_count": alias_to_vector_map.size(),
		"last_updated_utc": last_updated_utc,
		"map": serialized_map
	}

# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/spatial_movement/movement_vector_bridge_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/spatial_movement.json | 信号: EventBus 领域广播
# 职责说明: 将文字方位动词解析为连续物理速度向量，计算地形阻抗与负重衰减 优化: 引入 DirectionAliasIndex 静态倒排映射缓存与结构化参数，消除热路径高频配置读与循环比对
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name MovementVectorBridgeSolver
extends RefCounted

## 结构化缓存：移动核心参数
class MovementParams extends RefCounted:
	var agi_ref: float = 10.0
	var agi_factor_per: float = 0.005
	var agi_min: float = 0.5
	var load_threshold: float = 30.0
	var load_divisor: float = 100.0
	var load_min: float = 0.2
	var impedance_floor: float = 0.1
	var facing_thresh_sq: float = 0.0001

static var _alias_table: Dictionary = {}
static var _params_cache: MovementParams = null
## 缓存构建时的配置热重载版本（不一致即重建，Phase 64 P2 修复热重载失效）
static var _cached_config_version: int = -1

## 缓存新鲜度守卫：未构建或配置热重载版本推进时触发重建
static func _ensure_cache_fresh() -> void:
	if _params_cache == null or _cached_config_version != GameConfig.config_reload_version():
		init_or_rebuild_cache()

## 预编译倒排索引表与结构化参数（启动首用或配置热重载版本推进时触发）
static func init_or_rebuild_cache() -> void:
	var aliases: Dictionary = GameConfig.get_dict("domains.spatial_movement", "movement/direction_aliases", {})
	var table: Dictionary = {}
	for dir_key in aliases:
		var raw_alias: Variant = aliases[dir_key]
		if raw_alias is not Array:
			continue
		var dir_vec := _map_dir_key_to_vector(str(dir_key))
		for alias in (raw_alias as Array):
			var key := str(alias).strip_edges().to_upper()
			table[key] = dir_vec

	# 默认方向回退保障（配置缺失时零退化）
	var fallback_map := {
		"NORTH": Vector2(0, -1), "N": Vector2(0, -1), "北": Vector2(0, -1),
		"SOUTH": Vector2(0, 1), "S": Vector2(0, 1), "南": Vector2(0, 1),
		"EAST": Vector2(1, 0), "E": Vector2(1, 0), "东": Vector2(1, 0),
		"WEST": Vector2(-1, 0), "W": Vector2(-1, 0), "西": Vector2(-1, 0),
		"NORTHEAST": Vector2(1, -1).normalized(), "NE": Vector2(1, -1).normalized(), "东北": Vector2(1, -1).normalized(),
		"NORTHWEST": Vector2(-1, -1).normalized(), "NW": Vector2(-1, -1).normalized(), "西北": Vector2(-1, -1).normalized(),
		"SOUTHEAST": Vector2(1, 1).normalized(), "SE": Vector2(1, 1).normalized(), "东南": Vector2(1, 1).normalized(),
		"SOUTHWEST": Vector2(-1, 1).normalized(), "SW": Vector2(-1, 1).normalized(), "西南": Vector2(-1, 1).normalized()
	}
	for k in fallback_map:
		if not table.has(k):
			table[k] = fallback_map[k]

	_alias_table = table

	var p := MovementParams.new()
	p.agi_ref = GameConfig.get_float("domains.spatial_movement", "movement/agi_reference_stat", 10.0)
	p.agi_factor_per = GameConfig.get_float("domains.spatial_movement", "movement/agi_factor_per_point", 0.005)
	p.agi_min = GameConfig.get_float("domains.spatial_movement", "movement/agi_factor_min", 0.5)
	p.load_threshold = GameConfig.get_float("domains.spatial_movement", "movement/load_threshold_kg", 30.0)
	p.load_divisor = GameConfig.get_float("domains.spatial_movement", "movement/load_excess_divisor", 100.0)
	p.load_min = GameConfig.get_float("domains.spatial_movement", "movement/load_penalty_min", 0.2)
	p.impedance_floor = GameConfig.get_float("domains.spatial_movement", "movement/impedance_floor", 0.1)
	p.facing_thresh_sq = GameConfig.get_float("domains.spatial_movement", "movement/facing_threshold_sq", 0.0001)
	_params_cache = p
	_cached_config_version = GameConfig.config_reload_version()

## 方向键到向量映射
static func _map_dir_key_to_vector(dir_key: String) -> Vector2:
	match dir_key.to_lower():
		"north": return Vector2(0, -1)
		"south": return Vector2(0, 1)
		"east": return Vector2(1, 0)
		"west": return Vector2(-1, 0)
		"northeast": return Vector2(1, -1).normalized()
		"northwest": return Vector2(-1, -1).normalized()
		"southeast": return Vector2(1, 1).normalized()
		"southwest": return Vector2(-1, 1).normalized()
		_: return Vector2.ZERO

## 文字方位解析：基于倒排散列索引 O(1) 检索，乘距离得位移向量
static func translate_text_step_to_vector(verb_direction: String, distance_meters: float) -> Vector2:
	_ensure_cache_fresh()
	var key := verb_direction.strip_edges().to_upper()
	var dir: Vector2 = _alias_table.get(key, Vector2.ZERO)
	return dir * distance_meters

## 有效速度：敏捷因子（下限钳制）× 负重衰减（超阈线性下降）× 地形阻抗（下限地板）
## 经结构化参数缓存读取，无重复配置字典查寻
static func calculate_effective_speed(
	base_speed: float,
	agi_stat: float,
	total_load_kg: float,
	terrain_impedance_multiplier: float = 1.0
) -> float:
	_ensure_cache_fresh()
	var p := _params_cache
	var agi_factor := 1.0 + (agi_stat - p.agi_ref) * p.agi_factor_per
	agi_factor = maxf(p.agi_min, agi_factor)

	var load_penalty := 1.0
	if total_load_kg > p.load_threshold:
		var excess := total_load_kg - p.load_threshold
		load_penalty = maxf(p.load_min, 1.0 - (excess / p.load_divisor))

	var safe_impedance := maxf(p.impedance_floor, terrain_impedance_multiplier)
	return (base_speed * agi_factor * load_penalty) / safe_impedance

## 位移应用：累加坐标并越过阈值时更新朝向
static func apply_displacement(
	location: SpatialLocationEntity,
	delta_vector: Vector2
) -> Vector2:
	location.local_coordinates += delta_vector
	_ensure_cache_fresh()
	if delta_vector.length_squared() > _params_cache.facing_thresh_sq:
		location.orientation_facing = delta_vector.normalized()
	return location.local_coordinates

# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Pool Management Orchestration)
# 文件路径: res://backend/infrastructure/object_pool_manager.gd
# 架构定位: Object Pool Central Orchestrator & Registry
# 跨域依赖: 上游: GameBootstrap, 各业务域工厂 | 下游: ObjectPool, GameConfig, EventBusCore | 配置: config/infrastructure/object_pool.json | 信号: 对象池装配/清空事件
# 职责说明: 全域对象池集中管理中枢：提供单例池注册、配置装配驱动、对称反装配
#           与集中生命周期追踪，消除散落无序的对象池实例化与内存泄漏。
# 设计依据: 演进 03 高承压对象池与数据导向无头处理器架构规范
# ==============================================================================

class_name ObjectPoolManager extends RefCounted

const ObjectPoolConfigDTO = preload("res://backend/infrastructure/object_pool_config_dto.gd")
const ObjectPool = preload("res://backend/infrastructure/object_pool.gd")

const CONFIG_TABLE_OBJECT_POOL: String = "infrastructure.object_pool"
const PREFIX_POOLS: String = "pools/"
const PATH_PREALLOCATE_SIZE: String = "/preallocate_size"
const PATH_MAX_CAPACITY: String = "/max_capacity"
const PATH_ALLOW_OVERFLOW: String = "/allow_overflow_alloc"
const PATH_OVERFLOW_THRESHOLD: String = "/overflow_warning_threshold"
const DEFAULT_PREALLOC_SIZE: int = 32
const DEFAULT_MAX_CAPACITY: int = 512
const DEFAULT_OVERFLOW_THRESHOLD: int = 256

static var _pools: Dictionary = {}
static var _initialized: bool = false

static func initialize() -> void:
	if _initialized:
		return
	_pools.clear()
	_initialized = true

static func register_pool(pool_name: String, factory: Callable, config_override: ObjectPoolConfigDTO = null) -> ObjectPool:
	initialize()
	var cfg := config_override if config_override != null else _load_pool_config(pool_name)
	var pool := ObjectPool.new(factory, cfg)
	_pools[pool_name] = pool
	return pool

static func get_pool(pool_name: String) -> ObjectPool:
	return _pools.get(pool_name, null)

static func teardown() -> void:
	for pool in _pools.values():
		if pool != null:
			pool.clear()
	_pools.clear()
	_initialized = false

static func _load_pool_config(pool_name: String) -> ObjectPoolConfigDTO:
	var prefix := PREFIX_POOLS + pool_name
	var dto := ObjectPoolConfigDTO.new()
	dto.pool_name = pool_name
	dto.preallocate_size = maxi(0, GameConfig.get_int(CONFIG_TABLE_OBJECT_POOL, prefix + PATH_PREALLOCATE_SIZE, DEFAULT_PREALLOC_SIZE))
	dto.max_capacity = maxi(dto.preallocate_size, GameConfig.get_int(CONFIG_TABLE_OBJECT_POOL, prefix + PATH_MAX_CAPACITY, DEFAULT_MAX_CAPACITY))
	dto.allow_overflow_alloc = GameConfig.get_bool(CONFIG_TABLE_OBJECT_POOL, prefix + PATH_ALLOW_OVERFLOW, true)
	dto.overflow_warning_threshold = maxi(1, GameConfig.get_int(CONFIG_TABLE_OBJECT_POOL, prefix + PATH_OVERFLOW_THRESHOLD, DEFAULT_OVERFLOW_THRESHOLD))
	return dto

static func get_pool_count() -> int:
	return _pools.size()

static func get_all_pool_names() -> Array[String]:
	var names: Array[String] = []
	for k in _pools.keys():
		names.append(String(k))
	return names

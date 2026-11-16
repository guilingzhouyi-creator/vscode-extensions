# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Pool Management Orchestration)
# 文件路径: res://backend/infrastructure/object_pool_manager.gd
# 架构定位: Object Pool Central Orchestrator & Registry
# 依赖与触发: 上游: GameBootstrap, 各业务域工厂 | 下游: ObjectPool, GameConfig, EventBusCore | 配置: config/infrastructure/object_pool.json | 信号: 对象池装配/清空事件
# 职责说明: 全域对象池集中管理中枢：提供单例池注册、配置装配驱动、对称反装配
#           与集中生命周期追踪，消除散落无序的对象池实例化与内存泄漏。
# 退出语义与设计依据: 演进 03 高承压对象池与数据导向无头处理器架构规范
# ==============================================================================

## ObjectPoolManager：Object Pool Central Orchestrator & Registry
class_name ObjectPoolManager extends RefCounted

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
static var _is_initialized: bool = false

## 初始化组件或实体的内部运行状态
static func initialize() -> void:
	if _is_initialized:
		return
	_pools.clear()
	_is_initialized = true

## 注册指定名称的对象池与生成工厂
static func register_pool(pool_name: String, factory: Callable, config_override: ObjectPoolConfigDTO = null) -> ObjectPool:
	initialize()
	var effective_config := config_override if config_override != null else _load_pool_config(pool_name)
	var pool := ObjectPool.new(factory, effective_config)
	_pools[pool_name] = pool
	return pool

## 获取指定事件或对象的专用缓存池
static func get_pool(pool_name: String) -> ObjectPool:
	return _pools.get(pool_name, null)

## 销毁清理所有对象池与静态资源
static func teardown() -> void:
	for pool in _pools.values():
		if pool != null:
			pool.clear()
	_pools.clear()
	_is_initialized = false

static func _load_pool_config(pool_name: String) -> ObjectPoolConfigDTO:
	var prefix := PREFIX_POOLS + pool_name
	var config_dto := ObjectPoolConfigDTO.new()
	config_dto.pool_name = pool_name
	config_dto.preallocate_size = maxi(0, GameConfig.get_int(CONFIG_TABLE_OBJECT_POOL, prefix + PATH_PREALLOCATE_SIZE, DEFAULT_PREALLOC_SIZE))
	config_dto.max_capacity = maxi(config_dto.preallocate_size, GameConfig.get_int(CONFIG_TABLE_OBJECT_POOL, prefix + PATH_MAX_CAPACITY, DEFAULT_MAX_CAPACITY))
	config_dto.allow_overflow_alloc = GameConfig.get_bool(CONFIG_TABLE_OBJECT_POOL, prefix + PATH_ALLOW_OVERFLOW, true)
	config_dto.overflow_warning_threshold = maxi(1, GameConfig.get_int(CONFIG_TABLE_OBJECT_POOL, prefix + PATH_OVERFLOW_THRESHOLD, DEFAULT_OVERFLOW_THRESHOLD))
	return config_dto

## 获取当前已注册对象池总数
static func get_pool_count() -> int:
	return _pools.size()

## 获取所有已注册对象池的名称清单
static func get_all_pool_names() -> Array[String]:
	var names: Array[String] = []
	for pool_name in _pools.keys():
		names.append(String(pool_name))
	return names

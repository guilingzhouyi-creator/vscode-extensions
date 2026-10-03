# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · High Pressure Pooling)
# 文件路径: res://backend/infrastructure/object_pool.gd
# 架构定位: Generic RefCounted Object Pool
# 跨域依赖: 上游: ObjectPoolManager, 业务系统 | 下游: ObjectPoolConfigDTO, ObjectPoolStatsDTO | 配置: config/infrastructure/object_pool.json | 信号: 溢出告警
# 职责说明: 泛化引用计数对象池核心实现：提供 O(1) LIFO 借还管理、借出彻底重置（reset_state）、
#           防双重释放安全拦截与基于容量上限的自动丢弃策略，阻断瞬态堆内存碎片。
# 设计依据: 演进 03 高承压对象池与数据导向无头处理器架构规范
# ==============================================================================

class_name ObjectPool extends RefCounted

const ObjectPoolConfigDTO = preload("res://backend/infrastructure/object_pool_config_dto.gd")
const ObjectPoolStatsDTO = preload("res://backend/infrastructure/object_pool_stats_dto.gd")

const METHOD_RESET_STATE: String = "reset_state"
const LOG_OVERFLOW_WARN: String = "ObjectPool[%s] 活跃分配达到溢出预警阈值 (%d >= %d)"
const LOG_HARD_LIMIT_ERR: String = "ObjectPool[%s] 达到硬性上限且禁止溢出分配"
const LOG_DOUBLE_RELEASE: String = "ObjectPool[%s] 拦截到非法归还：对象未被借出或已重复归还"

var _config: ObjectPoolConfigDTO = null
var _pool_name: String = ""
var _factory_func: Callable = Callable()
var _idle_stack: Array = []
var _acquired_set: Dictionary = {}
var _stats: ObjectPoolStatsDTO = null

func _init(factory: Callable, config: ObjectPoolConfigDTO = null) -> void:
	_factory_func = factory
	_config = config if config != null else ObjectPoolConfigDTO.new()
	_pool_name = _config.pool_name
	_stats = ObjectPoolStatsDTO.new()
	_stats.pool_name = _pool_name
	_preallocate()

func _preallocate() -> void:
	var count := _config.preallocate_size
	for i in range(count):
		var obj: RefCounted = _factory_func.call()
		if obj != null:
			_idle_stack.append(obj)
			_stats.total_allocated += 1
	_stats.idle_in_pool = _idle_stack.size()

## 借出对象 (O(1) LIFO 优先局部性)
func acquire() -> RefCounted:
	_stats.total_acquires += 1
	var obj: RefCounted = null
	if not _idle_stack.is_empty():
		obj = _idle_stack.pop_back()
	elif _config.allow_overflow_alloc:
		obj = _factory_func.call()
		_stats.total_allocated += 1
		_stats.total_overflows += 1
		if _stats.total_allocated >= _config.overflow_warning_threshold:
			EventBusCore.get_instance().emit_log("warn", LOG_OVERFLOW_WARN % [_pool_name, _stats.total_allocated, _config.overflow_warning_threshold])
	else:
		EventBusCore.get_instance().emit_log("error", LOG_HARD_LIMIT_ERR % _pool_name)
		return null

	if obj != null:
		if obj.has_method(METHOD_RESET_STATE):
			obj.reset_state()
		var obj_id: int = obj.get_instance_id()
		_acquired_set[obj_id] = true
		_stats.active_in_use += 1
		_stats.idle_in_pool = _idle_stack.size()
		_stats.peak_active = maxi(_stats.peak_active, _stats.active_in_use)
	return obj

## 归还对象 (带双重释放与容量钳制守卫)
func release(obj: RefCounted) -> bool:
	if obj == null:
		return false
	var obj_id: int = obj.get_instance_id()
	if not _acquired_set.has(obj_id):
		EventBusCore.get_instance().emit_log("warn", LOG_DOUBLE_RELEASE % _pool_name)
		return false
	_acquired_set.erase(obj_id)
	_stats.total_releases += 1
	_stats.active_in_use = maxi(0, _stats.active_in_use - 1)

	# 容量超限时丢弃，由 Godot 引用计数自动回收
	if _idle_stack.size() < _config.max_capacity:
		if obj.has_method(METHOD_RESET_STATE):
			obj.reset_state()
		_idle_stack.append(obj)
		_stats.idle_in_pool = _idle_stack.size()
		return true
	else:
		_stats.total_allocated = maxi(0, _stats.total_allocated - 1)
		_stats.idle_in_pool = _idle_stack.size()
		return true

func clear() -> void:
	_idle_stack.clear()
	_acquired_set.clear()
	_stats.idle_in_pool = 0
	_stats.active_in_use = 0
	_stats.total_allocated = 0

func get_stats() -> ObjectPoolStatsDTO:
	return _stats

func get_config() -> ObjectPoolConfigDTO:
	return _config

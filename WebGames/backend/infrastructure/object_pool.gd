# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · High Pressure Pooling)
# 文件路径: res://backend/infrastructure/object_pool.gd
# 架构定位: Generic RefCounted Object Pool
# 依赖与触发: 上游: ObjectPoolManager, 业务系统 | 下游: ObjectPoolConfigDTO, ObjectPoolStatsDTO | 配置: config/infrastructure/object_pool.json | 信号: 溢出告警
# 职责说明: 泛化引用计数对象池核心实现：提供 O(1) LIFO 借还管理、借出彻底重置（reset_state）、
#           防双重释放安全拦截与基于容量上限的自动丢弃策略，阻断瞬态堆内存碎片。
# 退出语义与设计依据: 演进 03 高承压对象池与数据导向无头处理器架构规范
# ==============================================================================

## ObjectPool：Generic RefCounted Object Pool
class_name ObjectPool extends RefCounted

const METHOD_RESET_STATE: String = "reset_state"
const METHOD_MARK_ACQUIRE: String = "mark_pooled_acquire"
const METHOD_MARK_RELEASE: String = "mark_pooled_release"

var _config: ObjectPoolConfigDTO = null
var _pool_name: String = ""
var _factory_func: Callable = Callable()
var _idle_stack: Array = []
var _acquired_set: Dictionary = {}
var _pool_statistics: ObjectPoolStatsDTO = null
var _has_overflow_warned: bool = false
var _has_reset_capability: int = -1
var _has_pool_lifecycle_capability: int = -1

func _init(factory: Callable, pool_config: ObjectPoolConfigDTO = null) -> void:
	_factory_func = factory
	_config = pool_config if pool_config != null else ObjectPoolConfigDTO.new()
	_pool_name = _config.pool_name
	_pool_statistics = ObjectPoolStatsDTO.new()
	_pool_statistics.pool_name = _pool_name
	_preallocate()

func _detect_capabilities(pooled_object: RefCounted) -> void:
	# 首次接触实例时缓存方法存在标记，避免后续每次 borrow/release 热路径重复执行 has_method 反射
	if _has_reset_capability == -1:
		_has_reset_capability = 1 if pooled_object.has_method(METHOD_RESET_STATE) else 0
	if _has_pool_lifecycle_capability == -1:
		_has_pool_lifecycle_capability = 1 if (pooled_object.has_method(METHOD_MARK_ACQUIRE) and pooled_object.has_method(METHOD_MARK_RELEASE)) else 0

func _preallocate() -> void:
	var preallocate_count := _config.preallocate_size
	for slot_index in range(preallocate_count):
		var pooled_object: RefCounted = _factory_func.call()
		if pooled_object != null:
			_detect_capabilities(pooled_object)
			_idle_stack.append(pooled_object)
			_pool_statistics.total_allocated += 1
	_pool_statistics.idle_in_pool = _idle_stack.size()

## 借出对象 (O(1) LIFO 优先局部性)
func acquire() -> RefCounted:
	_pool_statistics.total_acquires += 1
	var pooled_object: RefCounted = null
	var is_reused: bool = false
	if not _idle_stack.is_empty():
		pooled_object = _idle_stack.pop_back()
		is_reused = true
	elif _config.allow_overflow_alloc:
		pooled_object = _factory_func.call()
		_pool_statistics.total_allocated += 1
		_pool_statistics.total_overflows += 1
		if _pool_statistics.total_allocated >= _config.overflow_warning_threshold and not _has_overflow_warned:
			_has_overflow_warned = true
			EventBusCore.get_instance().emit_log(LogConstants.LEVEL_LOWER_WARN, SystemBaseMessages.format(SystemBaseMessages.MSG_POOL_OVERFLOW_WARN, {
				"pool_name": _pool_name,
				"allocated": _pool_statistics.total_allocated,
				"threshold": _config.overflow_warning_threshold
			}))
	else:
		EventBusCore.get_instance().emit_log(LogConstants.LEVEL_LOWER_ERROR, SystemBaseMessages.format(SystemBaseMessages.MSG_POOL_HARD_LIMIT_ERR, {"pool_name": _pool_name}))
		return null

	if pooled_object != null:
		_detect_capabilities(pooled_object)
		if not is_reused and _has_reset_capability == 1 and _has_pool_lifecycle_capability == 0:
			pooled_object.call(METHOD_RESET_STATE)
		if _has_pool_lifecycle_capability == 1:
			pooled_object.call(METHOD_MARK_ACQUIRE)
		var object_id: int = pooled_object.get_instance_id()
		_acquired_set[object_id] = true
		_pool_statistics.active_in_use += 1
		_pool_statistics.idle_in_pool = _idle_stack.size()
		_pool_statistics.peak_active = maxi(_pool_statistics.peak_active, _pool_statistics.active_in_use)
	return pooled_object

## 归还对象 (带双重释放与容量钳制守卫，释放时单次重置减少热路径反射开销)
func release(pooled_object: RefCounted) -> bool:
	if pooled_object == null:
		return false
	var object_id: int = pooled_object.get_instance_id()
	if not _acquired_set.has(object_id):
		EventBusCore.get_instance().emit_log(LogConstants.LEVEL_LOWER_WARN, SystemBaseMessages.format(SystemBaseMessages.MSG_POOL_DOUBLE_RELEASE, {"pool_name": _pool_name}))
		return false
	_acquired_set.erase(object_id)
	_pool_statistics.total_releases += 1
	_pool_statistics.active_in_use = maxi(0, _pool_statistics.active_in_use - 1)
	if _has_overflow_warned and _pool_statistics.active_in_use < _config.overflow_warning_threshold:
		_has_overflow_warned = false

	# 容量超限时丢弃，由 Godot 引用计数自动回收
	if _idle_stack.size() < _config.max_capacity:
		_detect_capabilities(pooled_object)
		if _has_pool_lifecycle_capability == 1:
			pooled_object.call(METHOD_MARK_RELEASE)
		elif _has_reset_capability == 1:
			pooled_object.call(METHOD_RESET_STATE)
		_idle_stack.append(pooled_object)
		_pool_statistics.idle_in_pool = _idle_stack.size()
		return true
	_pool_statistics.total_allocated = maxi(0, _pool_statistics.total_allocated - 1)
	_pool_statistics.idle_in_pool = _idle_stack.size()
	return true

## 峰值过后将多余空闲对象裁剪至目标水位，释放闲置内存
func trim_idle(target_idle: int = -1) -> int:
	var keep_limit: int = clampi(target_idle if target_idle >= 0 else _config.preallocate_size, 0, _config.max_capacity)
	var trimmed_count: int = 0
	while _idle_stack.size() > keep_limit:
		_idle_stack.pop_back()
		_pool_statistics.total_allocated = maxi(0, _pool_statistics.total_allocated - 1)
		trimmed_count += 1
	_pool_statistics.idle_in_pool = _idle_stack.size()
	return trimmed_count

## 清空当前容器或管理器内的所有记录与缓存
func clear() -> void:
	_idle_stack.clear()
	_acquired_set.clear()
	_has_overflow_warned = false
	_pool_statistics.idle_in_pool = 0
	_pool_statistics.active_in_use = 0
	_pool_statistics.total_allocated = 0

## 获取当前对象池的运行统计数据快照
func get_stats() -> ObjectPoolStatsDTO:
	return _pool_statistics

## 获取当前组件配置参数数据传输对象
func get_config() -> ObjectPoolConfigDTO:
	return _config

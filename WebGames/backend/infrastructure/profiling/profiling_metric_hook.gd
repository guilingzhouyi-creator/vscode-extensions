# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Profiling & Telemetry)
# 文件路径: res://backend/infrastructure/profiling/profiling_metric_hook.gd
# 架构定位: Telemetry Probe / Metric Collector
# 跨域依赖: 上游: GameBootstrap, CombatSessionManager | 下游: UnifiedLoggerService | 配置: config/infrastructure/profiling.json | 信号: 性能超限告警
# 职责说明: 低开销性能探针与遥测采集钩子：监控关键核心路径耗时（微秒级）、内存堆分配量、对象池复用率，输出可供门禁比对的基准快照。
# 设计依据: Phase 60 性能治理与基准审计架构
# ==============================================================================

class_name ProfilingMetricHook extends RefCounted

# ==============================================================================
# 一、性能指标采样包
# ==============================================================================

## 性能指标采样包
class PerformanceSample extends RefCounted:
	var metric_name: String = ""
	var category: String = "" # MEMORY, EXECUTION_TIME, RESOURCE_COUNT, TICK_LATENCY
	var value: float = 0.0
	var timestamp: float = 0.0
	var tags: Dictionary = {}
	
	## 序列化为字典（遥测/导出用）
	func to_dict() -> Dictionary:
		return {
			"metric_name": metric_name,
			"category": category,
			"value": value,
			"timestamp": timestamp,
			"tags": tags
		}

# ==============================================================================
# 二、采样状态与记录
# ==============================================================================

var _enabled: bool = false
var _samples: Array[PerformanceSample] = []
var _max_samples: int = 500

## 构造：指定有界缓冲上限（下限 10，防 0 容量误配）
func _init(p_max_samples: int = 500) -> void:
	_max_samples = maxi(10, p_max_samples)

## 开关采样（默认关闭零开销）
func set_enabled(p_enabled: bool) -> void:
	_enabled = p_enabled

## 采样是否开启
func is_enabled() -> bool:
	return _enabled

## 记录一条指标（未开启时零开销跳过；超上限淘汰最旧）
func record_metric(p_name: String, p_category: String, p_val: float, p_tags: Dictionary = {}) -> void:
	if not _enabled:
		return
	while _samples.size() >= _max_samples:
		_samples.pop_front()
	
	var sample := PerformanceSample.new()
	sample.metric_name = p_name
	sample.category = p_category
	sample.value = p_val
	sample.timestamp = Time.get_unix_time_from_system()
	sample.tags = p_tags.duplicate(true)
	_samples.append(sample)

## 按分类筛选样本（只读）
func get_samples_by_category(p_cat: String) -> Array[PerformanceSample]:
	var res: Array[PerformanceSample] = []
	for s in _samples:
		if s.category == p_cat:
			res.append(s)
	return res

## 当前样本总数
func sample_count() -> int:
	return _samples.size()

## 清空全部样本
func clear() -> void:
	_samples.clear()

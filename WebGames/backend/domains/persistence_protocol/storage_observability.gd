# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/persistence_protocol/storage_observability.gd
# 架构定位: Dual-Domain Storage Observability & Telemetry Collector
# 依赖与触发: 上游: PrimaryStorageEngine, AuxiliaryWorkerPool, FrameBudgetDispatcher | 下游: StorageMetricsDTO, EventBusCore
# 职责说明: 双域储存观测指标收集器：聚合主要数据恢复、TTFI、辅助资源吞吐、
#           主线程 IO 等待、队列长度、缓存命中率、内存峰值、单帧提交预算与重试失败率
#           九维核心度量，向监控系统与质量看板输出快照。
# 退出语义与设计依据: 双域储存架构观测指标看板规范
# ==============================================================================

## StorageObservability：Dual-Domain Storage Observability & Telemetry Collector
class_name StorageObservability extends PoolableDtoBase

const PoolableDtoBase = preload("res://backend/domains/persistence_protocol/poolable_dto_base.gd")

const StorageMetricsDTO = preload("res://backend/domains/persistence_protocol/dto/storage_metrics_dto.gd")
const AuxiliaryWorkerPool = preload("res://backend/domains/persistence_protocol/auxiliary_worker_pool.gd")
const FrameBudgetDispatcher = preload("res://backend/domains/persistence_protocol/frame_budget_dispatcher.gd")

const BYTES_TO_MB: float = 1048576.0
const MS_TO_SEC: float = 1000.0

static var _instance: RefCounted = null

var _last_primary_recovery_ms: float = 0.0
var _last_first_interactive_ms: float = 0.0
var _total_auxiliary_bytes: int = 0
var _total_auxiliary_elapsed_ms: float = 0.0
var _main_thread_io_wait_ms: float = 0.0

var _total_requests: int = 0
var _cache_hits: int = 0
var _failed_requests: int = 0
var _peak_memory_bytes: int = 0

## 获取单例全局静态唯一实例
static func get_instance() -> RefCounted:
	if _instance == null:
		_instance = StorageObservability.new()
	return _instance

func _init() -> void:
	reset_state()

## 重置所有度量统计
func reset_state() -> void:
	super.reset_state()
	_last_primary_recovery_ms = 0.0
	_last_first_interactive_ms = 0.0
	_total_auxiliary_bytes = 0
	_total_auxiliary_elapsed_ms = 0.0
	_main_thread_io_wait_ms = 0.0
	_total_requests = 0
	_cache_hits = 0
	_failed_requests = 0
	_peak_memory_bytes = 0

## 记录主数据恢复耗时与 TTFI
func record_primary_recovery(duration_ms: float, time_to_first_interactive_ms: float = 0.0) -> void:
	_last_primary_recovery_ms = duration_ms
	if time_to_first_interactive_ms > 0.0:
		_last_first_interactive_ms = time_to_first_interactive_ms
	else:
		_last_first_interactive_ms = duration_ms

## 记录辅助资源加载度量
func record_auxiliary_load(byte_count: int, duration_ms: float, is_failure: bool = false, is_cache_hit: bool = false) -> void:
	_total_requests += 1
	if is_cache_hit:
		_cache_hits += 1
	if is_failure:
		_failed_requests += 1
	else:
		_total_auxiliary_bytes += byte_count
		_total_auxiliary_elapsed_ms += duration_ms

## 记录主线程阻塞 IO 等待耗时
func record_main_thread_wait(duration_ms: float) -> void:
	_main_thread_io_wait_ms += duration_ms

## 生成九维观测指标快照
func get_metrics_snapshot() -> StorageMetricsDTO:
	var metrics_snapshot := StorageMetricsDTO.new()
	metrics_snapshot.primary_recovery_time_ms = _last_primary_recovery_ms
	metrics_snapshot.time_to_first_interactive_ms = _last_first_interactive_ms

	# 吞吐量 MB/s = (bytes / BYTES_TO_MB) / (elapsed_ms / MS_TO_SEC)
	if _total_auxiliary_elapsed_ms > 0.0:
		var total_megabytes := float(_total_auxiliary_bytes) / BYTES_TO_MB
		var total_seconds := _total_auxiliary_elapsed_ms / MS_TO_SEC
		metrics_snapshot.auxiliary_throughput_mb_per_sec = total_megabytes / total_seconds
	else:
		metrics_snapshot.auxiliary_throughput_mb_per_sec = 0.0

	metrics_snapshot.main_thread_io_wait_ms = _main_thread_io_wait_ms
	metrics_snapshot.queue_length = AuxiliaryWorkerPool.get_instance().get_queue_size()

	if _total_requests > 0:
		metrics_snapshot.cache_hit_rate = float(_cache_hits) / float(_total_requests)
		metrics_snapshot.failure_retry_rate = float(_failed_requests) / float(_total_requests)
	else:
		metrics_snapshot.cache_hit_rate = 0.0
		metrics_snapshot.failure_retry_rate = 0.0

	var static_memory_bytes := OS.get_static_memory_usage()
	if static_memory_bytes > _peak_memory_bytes:
		_peak_memory_bytes = static_memory_bytes
	metrics_snapshot.peak_memory_mb = float(_peak_memory_bytes) / BYTES_TO_MB

	var configured_budget := GameConfig.get_float("infrastructure.storage", "auxiliary/frame_budget/max_ms_per_frame", 2.0)
	metrics_snapshot.frame_submission_budget_ms = configured_budget

	return metrics_snapshot

## 测试重置
static func reset_for_tests() -> void:
	if _instance != null:
		_instance.reset_state()
	_instance = null

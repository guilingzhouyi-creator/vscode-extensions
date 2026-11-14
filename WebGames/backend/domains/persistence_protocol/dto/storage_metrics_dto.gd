# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/persistence_protocol/dto/storage_metrics_dto.gd
# 架构定位: Value Object DTO / Dual-Domain Storage Telemetry Metrics Model
# 依赖与触发: 上游: PrimaryStorageEngine, AuxiliaryWorkerPool, FrameBudgetDispatcher | 下游: TelemetryEngine, AuditDashboard
# 职责说明: 双域储存观测指标传输对象：承载九维核心运行时监控度量，
#           用于量化分析启动耗时、IO 等待、流控吞吐与内存压力。
# 退出语义与设计依据: 双域储存架构观测指标看板规范
# ==============================================================================

## StorageMetricsDTO：Value Object DTO / Dual-Domain Storage Telemetry Metrics Model
class_name StorageMetricsDTO extends PoolableDtoBase

const PoolableDtoBase = preload("res://backend/domains/persistence_protocol/poolable_dto_base.gd")

const DEFAULT_FRAME_BUDGET_MS: float = 2.0

## 1. 主数据恢复耗时 (ms)
var primary_recovery_time_ms: float = 0.0
## 2. 首个可交互时间 TTFI (ms)
var time_to_first_interactive_ms: float = 0.0
## 3. 辅助资源加载吞吐 (MB/s)
var auxiliary_throughput_mb_per_sec: float = 0.0
## 4. 主线程 IO 等待时间 (ms)
var main_thread_io_wait_ms: float = 0.0
## 5. 待执行任务队列长度
var queue_length: int = 0
## 6. 辅助资源缓存命中率 (0.0 - 1.0)
var cache_hit_rate: float = 0.0
## 7. 储存系统峰值内存开销 (MB)
var peak_memory_mb: float = 0.0
## 8. 单帧资源提交预算 (ms)
var frame_submission_budget_ms: float = DEFAULT_FRAME_BUDGET_MS
## 9. 任务重试与加载失败率 (0.0 - 1.0)
var failure_retry_rate: float = 0.0

## 对象池复用重置
func reset_state() -> void:
	super.reset_state()
	primary_recovery_time_ms = 0.0
	time_to_first_interactive_ms = 0.0
	auxiliary_throughput_mb_per_sec = 0.0
	main_thread_io_wait_ms = 0.0
	queue_length = 0
	cache_hit_rate = 0.0
	peak_memory_mb = 0.0
	frame_submission_budget_ms = DEFAULT_FRAME_BUDGET_MS
	failure_retry_rate = 0.0

## 序列化为字典
func to_dict() -> Dictionary:
	return {
		"primary_recovery_time_ms": primary_recovery_time_ms,
		"time_to_first_interactive_ms": time_to_first_interactive_ms,
		"auxiliary_throughput_mb_per_sec": auxiliary_throughput_mb_per_sec,
		"main_thread_io_wait_ms": main_thread_io_wait_ms,
		"queue_length": queue_length,
		"cache_hit_rate": cache_hit_rate,
		"peak_memory_mb": peak_memory_mb,
		"frame_submission_budget_ms": frame_submission_budget_ms,
		"failure_retry_rate": failure_retry_rate
	}

## 反序列化为 DTO 实例
static func from_dict(serialized_payload: Dictionary) -> RefCounted:
	var metrics_instance: RefCounted = new()
	var typed_metrics := metrics_instance as StorageMetricsDTO
	if typed_metrics != null:
		typed_metrics.primary_recovery_time_ms = float(serialized_payload.get("primary_recovery_time_ms", 0.0))
		typed_metrics.time_to_first_interactive_ms = float(serialized_payload.get("time_to_first_interactive_ms", 0.0))
		typed_metrics.auxiliary_throughput_mb_per_sec = float(serialized_payload.get("auxiliary_throughput_mb_per_sec", 0.0))
		typed_metrics.main_thread_io_wait_ms = float(serialized_payload.get("main_thread_io_wait_ms", 0.0))
		typed_metrics.queue_length = int(serialized_payload.get("queue_length", 0))
		typed_metrics.cache_hit_rate = float(serialized_payload.get("cache_hit_rate", 0.0))
		typed_metrics.peak_memory_mb = float(serialized_payload.get("peak_memory_mb", 0.0))
		typed_metrics.frame_submission_budget_ms = float(serialized_payload.get("frame_submission_budget_ms", DEFAULT_FRAME_BUDGET_MS))
		typed_metrics.failure_retry_rate = float(serialized_payload.get("failure_retry_rate", 0.0))
	return metrics_instance

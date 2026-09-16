# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Profiling & Telemetry)
# 文件路径: res://backend/infrastructure/telemetry_aggregate.gd
# 架构定位: Telemetry Probe / Metric Collector
# 跨域依赖: 上游: GameBootstrap, CombatSessionManager | 下游: UnifiedLoggerService | 配置: config/infrastructure/profiling.json | 信号: 性能超限告警
# 职责说明: 单向只读消费结构化日志，按域与事件分类聚合计数与耗时分位 (p50/p95)， 滑动窗口重置，支撑热路径承压可观测性（Inv-LS-4 遥测单向不变量）。
# 设计依据: Phase 60 性能治理与基准审计架构
# ==============================================================================

class_name TelemetryAggregate extends RefCounted

# ==============================================================================
# 一、遥测槽位指标实体
# ==============================================================================

## 单槽位聚合指标：按 域|事件分类 维度统计计数/总耗时/分位耗时（滑动窗口内）
class SlotMetric extends RefCounted:
	var domain: String = ""
	var event_category: String = ""
	var count: int = 0
	var total_duration_ms: int = 0
	var p50_ms: int = 0
	var p95_ms: int = 0
	var last_timestamp_utc: int = 0
	var duration_samples: Array[int] = []

	## 序列化槽位指标（供外部查询快照；不导出原始样本序列，防内存放大）
	func to_dict() -> Dictionary:
		return {
			"domain": domain,
			"event_category": event_category,
			"count": count,
			"total_duration_ms": total_duration_ms,
			"p50_ms": p50_ms,
			"p95_ms": p95_ms,
			"last_timestamp_utc": last_timestamp_utc,
		}

# ==============================================================================
# 二、聚合状态与配置
# ==============================================================================

static var _slots: Dictionary = {}        # "domain|event_category" -> SlotMetric
static var _window_start_utc: int = 0
static var _sample_size: int = 256
static var _window_seconds: int = 60
static var _enabled: bool = true
static var _cached_version: int = -2

## 测试复位：清空全部槽位并恢复默认配置（避免跨用例状态残留）
static func reset_state() -> void:
	_slots.clear()
	_window_start_utc = 0
	_sample_size = 256
	_window_seconds = 60
	_enabled = true
	_cached_version = -2

## 配置新鲜度守卫：热重载版本变化时按 log.json telemetry 段重读启用/窗口/样本参数
static func _ensure_config() -> void:
	var current_version := GameConfig.config_reload_version()
	if _cached_version == current_version:
		return
	_cached_version = current_version
	
	var telemetry_cfg := GameConfig.get_dict("infrastructure.log", "telemetry", {})
	_enabled = bool(telemetry_cfg.get("enabled", true))
	_window_seconds = maxi(1, int(telemetry_cfg.get("window_seconds", 60)))
	_sample_size = maxi(16, int(telemetry_cfg.get("sample_size", 256)))

# ==============================================================================
# 三、单向消费与聚合
# ==============================================================================

## 单向只读消费结构化日志记录（Inv-LS-4）
static func consume(record: StructuredLogRecord) -> void:
	if record == null:
		return
	_ensure_config()
	if not _enabled:
		return
		
	var now := int(Time.get_unix_time_from_system())
	_maybe_roll_window(now)
	
	var domain_key := record.channel if not record.channel.is_empty() else "global"
	var cat_key := record.event_category if not record.event_category.is_empty() else "default"
	var slot_key := "%s|%s" % [domain_key, cat_key]
	
	var slot: SlotMetric = _slots.get(slot_key, null)
	if slot == null:
		slot = SlotMetric.new()
		slot.domain = domain_key
		slot.event_category = cat_key
		_slots[slot_key] = slot
		
	slot.count += 1
	slot.total_duration_ms += record.duration_ms
	slot.last_timestamp_utc = record.timestamp_utc if record.timestamp_utc > 0 else now
	
	if record.duration_ms > 0 or slot.duration_samples.size() == 0:
		_track_duration(slot, record.duration_ms)

## 追踪耗时样本：有界滑动窗口（超 sample_size 淘汰最旧），实时计算 p50/p95 分位
static func _track_duration(slot: SlotMetric, duration_ms: int) -> void:
	slot.duration_samples.append(duration_ms)
	if slot.duration_samples.size() > _sample_size:
		slot.duration_samples.remove_at(0)
		
	var sorted_samples: Array = slot.duration_samples.duplicate()
	sorted_samples.sort()
	var n := sorted_samples.size()
	if n > 0:
		var idx_p50 := int(n * 0.50)
		if idx_p50 >= n:
			idx_p50 = n - 1
		slot.p50_ms = int(sorted_samples[idx_p50])
		
		var idx_p95 := int(n * 0.95)
		if idx_p95 >= n:
			idx_p95 = n - 1
		slot.p95_ms = int(sorted_samples[idx_p95])

## 滑动窗口重置：超过 window_seconds 时清空全部槽位（新窗口从当前时刻起算）
static func _maybe_roll_window(now_utc: int) -> void:
	if _window_start_utc == 0:
		_window_start_utc = now_utc
		return
	if now_utc - _window_start_utc >= _window_seconds:
		_slots.clear()
		_window_start_utc = now_utc

## 快照导出当前窗口遥测指标（只读供外部查询）
static func snapshot() -> Dictionary:
	_ensure_config()
	var slots_dict: Dictionary = {}
	for k in _slots.keys():
		var slot: SlotMetric = _slots[k]
		slots_dict[k] = slot.to_dict()
	return {
		"window_start_utc": _window_start_utc,
		"window_seconds": _window_seconds,
		"slots": slots_dict,
	}

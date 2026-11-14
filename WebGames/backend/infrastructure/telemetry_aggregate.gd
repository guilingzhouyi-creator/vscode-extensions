# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Profiling & Telemetry)
# 文件路径: res://backend/infrastructure/telemetry_aggregate.gd
# 架构定位: Telemetry Probe / Metric Collector
# 依赖与触发: 上游: GameBootstrap, CombatSessionManager | 下游: UnifiedLoggerService | 配置: config/infrastructure/profiling.json | 信号: 性能超限告警
# 职责说明: 单向只读消费结构化日志，按域与事件分类聚合计数与耗时分位 (50%/95% 分位)， 滑动窗口重置，支撑热路径承压可观测性（Inv-LS-4 遥测单向不变量）。
# 退出语义与设计依据: 性能治理与基准审计架构
# ==============================================================================

## TelemetryAggregate：Telemetry Probe / Metric Collector
class_name TelemetryAggregate extends RefCounted

const LogConstants = preload("res://backend/infrastructure/logging/log_constants.gd")
const StatisticsMathLib = preload("res://backend/infrastructure/pure/statistics_math_lib.gd")

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
	var _sample_write_cursor: int = 0
	var _dirty: bool = false

	## 确保分位数完成懒计算（委托纯统计数学库，避免写入热路径排序与瞬态分配）
	func ensure_percentiles() -> void:
		if not _dirty:
			return
		_dirty = false
		var percentile_metrics := StatisticsMathLib.compute_p50_p95(duration_samples)
		p50_ms = int(percentile_metrics.get("p50_ms", 0))
		p95_ms = int(percentile_metrics.get("p95_ms", 0))

	## 序列化槽位指标（供外部查询快照；不导出原始样本序列，防内存放大）
	func to_dict() -> Dictionary:
		ensure_percentiles()
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
static var _sample_size: int = LogConstants.DEFAULT_TELEMETRY_SAMPLE_SIZE
static var _window_seconds: int = LogConstants.DEFAULT_TELEMETRY_WINDOW_SEC
static var _is_enabled: bool = true
static var _cached_version: int = -2

## 测试复位：清空全部槽位并恢复默认配置（避免跨用例状态残留）
static func reset_state() -> void:
	_slots.clear()
	_window_start_utc = 0
	_sample_size = LogConstants.DEFAULT_TELEMETRY_SAMPLE_SIZE
	_window_seconds = LogConstants.DEFAULT_TELEMETRY_WINDOW_SEC
	_is_enabled = true
	_cached_version = -2

## 配置新鲜度守卫：热重载版本变化时按 log.json telemetry 段重读启用/窗口/样本参数
static func _ensure_config() -> void:
	var current_version := GameConfig.config_reload_version()
	if _cached_version == current_version:
		return
	_cached_version = current_version

	var telemetry_config := GameConfig.get_dict(LogConstants.CFG_LOG_TABLE, LogConstants.CFG_PATH_TELEMETRY, {})
	_is_enabled = bool(telemetry_config.get("enabled", true))
	_window_seconds = maxi(1, int(telemetry_config.get("window_seconds", LogConstants.DEFAULT_TELEMETRY_WINDOW_SEC)))
	_sample_size = maxi(LogConstants.MIN_TELEMETRY_SAMPLE_SIZE, int(telemetry_config.get("sample_size", LogConstants.DEFAULT_TELEMETRY_SAMPLE_SIZE)))

# ==============================================================================
# 三、单向消费与聚合
# ==============================================================================

## 单向只读消费结构化日志记录（Inv-LS-4）
static func consume(record: StructuredLogRecord) -> void:
	if record == null:
		return
	_ensure_config()
	if not _is_enabled:
		return

	var now := int(Time.get_unix_time_from_system())
	_maybe_roll_window(now)

	var domain_key := record.channel if not record.channel.is_empty() else LogConstants.CHANNEL_GLOBAL
	var category_key := record.event_category if not record.event_category.is_empty() else LogConstants.CATEGORY_DEFAULT
	var slot_key := "%s|%s" % [domain_key, category_key]

	var slot: SlotMetric = _slots.get(slot_key, null)
	if slot == null:
		slot = SlotMetric.new()
		slot.domain = domain_key
		slot.event_category = category_key
		_slots[slot_key] = slot

	slot.count += 1
	slot.total_duration_ms += record.duration_ms
	slot.last_timestamp_utc = record.timestamp_utc if record.timestamp_utc > 0 else now

	if record.duration_ms > 0 or slot.duration_samples.size() == 0:
		_track_duration(slot, record.duration_ms)

## 追踪耗时样本：O(1) 定长环形覆写窗口（超 sample_size 原位覆盖），标记脏位延迟排序（Lazy Evaluation）
static func _track_duration(slot: SlotMetric, duration_ms: int) -> void:
	if slot.duration_samples.size() < _sample_size:
		slot.duration_samples.append(duration_ms)
	else:
		if slot.duration_samples.size() > _sample_size:
			slot.duration_samples.resize(_sample_size)
		slot._sample_write_cursor = slot._sample_write_cursor % _sample_size
		slot.duration_samples[slot._sample_write_cursor] = duration_ms
		slot._sample_write_cursor = StatisticsMathLib.ring_next_cursor(slot._sample_write_cursor, _sample_size)
	slot._dirty = true

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
	var slots_map: Dictionary = {}
	for slot_key in _slots.keys():
		var slot: SlotMetric = _slots[slot_key]
		slots_map[slot_key] = slot.to_dict()
	return {
		"window_start_utc": _window_start_utc,
		"window_seconds": _window_seconds,
		"slots": slots_map,
	}

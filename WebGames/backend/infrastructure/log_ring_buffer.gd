# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Logging & Telemetry)
# 文件路径: res://backend/infrastructure/log_ring_buffer.gd
# 架构定位: Log Collector & Stream Processor
# 依赖与触发: 上游: 全域业务模块与异常拦截器 | 下游: RingBuffer, FileAccess | 配置: config/infrastructure/log.json | 信号: FATAL/ERROR 级别告警信号
# 职责说明: 维持内存中最近 N 条结构化日志（有界收敛），支撑实时检索与运维查询， 容量由 log.json structured/ring_buffer_capacity 配置驱动（有界收敛惯例）。
# 退出语义与设计依据: 统一结构化日志规范 / 性能基准审计
# ==============================================================================

## LogRingBuffer：Log Collector & Stream Processor
class_name LogRingBuffer extends RefCounted

const LogConstants = preload("res://backend/infrastructure/logging/log_constants.gd")
const StatisticsMathLib = preload("res://backend/infrastructure/pure/statistics_math_lib.gd")

# ==============================================================================
# 一、环形缓冲状态
# ==============================================================================

static var _buffer: Array[StructuredLogRecord] = []
static var _capacity: int = LogConstants.DEFAULT_RING_BUFFER_CAPACITY
static var _capacity_override: int = -1
static var _head: int = 0
static var _cached_version: int = -2

## 测试复位：清空缓冲并复位容量覆盖（避免跨用例状态残留）
static func reset_state() -> void:
	clear()
	set_capacity_override_for_test(-1)

## 清空缓冲（容量配置保留），返回清空条目数
static func clear() -> int:
	var count := _buffer.size()
	_buffer.clear()
	_head = 0
	return count

## 测试专用容量覆盖（capacity_override<=0 恢复配置驱动；capacity_override>0 强制容量并重建）
static func set_capacity_override_for_test(capacity_override: int) -> void:
	if capacity_override <= 0:
		_capacity_override = -1
		_cached_version = -2
		_capacity = LogConstants.DEFAULT_RING_BUFFER_CAPACITY
		_ensure_capacity_fresh()
	else:
		_capacity_override = capacity_override
		_capacity = capacity_override
		_rebuild()

## 容量新鲜度守卫：配置热重载版本变化时按 log.json 重新读取容量
static func _ensure_capacity_fresh() -> void:
	if _capacity_override > 0:
		return
	var current_version := GameConfig.config_reload_version()
	if _cached_version == current_version:
		return
	_cached_version = current_version

	var configured_capacity := GameConfig.get_int(LogConstants.CFG_LOG_TABLE, LogConstants.CFG_PATH_RING_CAPACITY, LogConstants.DEFAULT_RING_BUFFER_CAPACITY)
	configured_capacity = maxi(1, configured_capacity)
	if configured_capacity != _capacity:
		_capacity = configured_capacity
		_rebuild()

## 重建缓冲：超容时按 sequence 重排仅保留最近 _capacity 条（容量收缩有界收敛）
static func _rebuild() -> void:
	if _buffer.size() > _capacity:
		# 环绕满环后数组尾部并非时间序最新：先按 sequence 重排取最新 _capacity 条
		# （Inv-LS-5 只读语义 + 有界收敛：容量收缩仅保留最近窗口）
		var ordered: Array = _buffer.duplicate()
		ordered.sort_custom(func(a: Variant, b: Variant) -> bool:
			return int((a as StructuredLogRecord).sequence) < int((b as StructuredLogRecord).sequence)
		)
		_buffer = ordered.slice(ordered.size() - _capacity)
		_head = 0

## 追加一条结构化日志记录（满则覆盖最旧）；入环深拷贝快照，隔离调用方后续改写
static func append(record: StructuredLogRecord) -> void:
	if record == null:
		return
	_ensure_capacity_fresh()

	# 深拷贝快照：调用方（LogCollector 返回的 record）入环后改写不污染缓冲（优先零中间字典 clone）
	var snapshot: StructuredLogRecord = record.clone() if record.has_method("clone") else StructuredLogRecord.from_dto(record.to_dto())
	if _buffer.size() < _capacity:
		_buffer.append(snapshot)
	else:
		_buffer[_head] = snapshot
		_head = StatisticsMathLib.ring_next_cursor(_head, _capacity)

## 查询当前环形缓冲中的记录（只读）
static func query(from_utc: int = 0, levels: Array = [], channels: Array = []) -> Array:
	var matched_records: Array = []
	var buffer_size: int = _buffer.size()
	if buffer_size == 0:
		return matched_records
	var start: int = _head if buffer_size >= _capacity else 0
	var last_sequence: int = -1
	var needs_sort: bool = false
	for offset in range(buffer_size):
		var record: StructuredLogRecord = _buffer[(start + offset) % buffer_size] as StructuredLogRecord
		if record == null:
			continue
		if from_utc > 0 and record.timestamp_utc < from_utc:
			continue
		if not levels.is_empty() and not _matches_level(record.level, levels):
			continue
		if not channels.is_empty() and not (record.channel in channels):
			continue
		if record.sequence < last_sequence:
			needs_sort = true
		last_sequence = record.sequence
		matched_records.append(record)
	if needs_sort:
		matched_records.sort_custom(func(left_record: Variant, right_record: Variant) -> bool:
			return int((left_record as StructuredLogRecord).sequence) < int((right_record as StructuredLogRecord).sequence)
		)
	return matched_records

static func _matches_level(record_level: String, levels: Array) -> bool:
	for level_item in levels:
		if record_level.nocasecmp_to(str(level_item)) == 0:
			return true
	return false

## 全量复制返回（只读语义，调用方改副本不影响缓冲）
static func get_all() -> Array:
	return _buffer.duplicate()

## 当前缓冲条目数
static func size() -> int:
	return maxi(0, _buffer.size())

## 当前容量（配置驱动，含热重载刷新）
static func get_capacity() -> int:
	_ensure_capacity_fresh()
	return _capacity

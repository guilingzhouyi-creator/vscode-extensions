# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Logging & Telemetry)
# 文件路径: res://backend/infrastructure/log_ring_buffer.gd
# 架构定位: Log Collector & Stream Processor
# 跨域依赖: 上游: 全域业务模块与异常拦截器 | 下游: RingBuffer, FileAccess | 配置: config/infrastructure/logging.json | 信号: FATAL/ERROR 级别告警信号
# 职责说明: 维持内存中最近 N 条结构化日志（有界收敛），支撑实时检索与运维查询， 容量由 log.json structured/ring_buffer_capacity 配置驱动（有界收敛惯例）。
# 设计依据: Phase 52 统一结构化日志规范 / Phase 60 性能基准审计
# ==============================================================================

class_name LogRingBuffer extends RefCounted

# ==============================================================================
# 一、环形缓冲状态
# ==============================================================================

static var _buffer: Array[StructuredLogRecord] = []
static var _capacity: int = 1000
static var _capacity_override: int = -1
static var _head: int = 0
static var _cached_version: int = -2

## 测试复位：清空缓冲并复位容量覆盖（避免跨用例状态残留）
static func reset_state() -> void:
	clear()
	set_capacity_override_for_test(-1)

## 清空缓冲（容量配置保留）
static func clear() -> void:
	_buffer.clear()
	_head = 0

## 测试专用容量覆盖（cap<=0 恢复配置驱动；cap>0 强制容量并重建）
static func set_capacity_override_for_test(cap: int) -> void:
	if cap <= 0:
		_capacity_override = -1
		_cached_version = -2
		_capacity = 1000
		_ensure_capacity_fresh()
	else:
		_capacity_override = cap
		_capacity = cap
		_rebuild()

## 容量新鲜度守卫：配置热重载版本变化时按 log.json 重新读取容量
static func _ensure_capacity_fresh() -> void:
	if _capacity_override > 0:
		return
	var current_version := GameConfig.config_reload_version()
	if _cached_version == current_version:
		return
	_cached_version = current_version
	
	var new_cap := GameConfig.get_int("infrastructure.log", "structured/ring_buffer_capacity", 1000)
	new_cap = maxi(1, new_cap)
	if new_cap != _capacity:
		_capacity = new_cap
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

	# 深拷贝快照：调用方（LogCollector 返回的 record）入环后改写不污染缓冲
	var snapshot := StructuredLogRecord.from_dto(record.to_dto())
	if _buffer.size() < _capacity:
		_buffer.append(snapshot)
	else:
		_buffer[_head] = snapshot
		_head = (_head + 1) % _capacity

## 查询当前环形缓冲中的记录（只读）
static func query(from_utc: int = 0, levels: Array = [], channels: Array = []) -> Array:
	var out: Array = []
	for rec in _buffer:
		if rec == null:
			continue
		if from_utc > 0 and rec.timestamp_utc < from_utc:
			continue
		if not levels.is_empty():
			var hit_lvl := false
			for lvl in levels:
				if rec.level.nocasecmp_to(str(lvl)) == 0:
					hit_lvl = true
					break
			if not hit_lvl:
				continue
		if not channels.is_empty():
			if not (rec.channel in channels):
				continue
		out.append(rec)
	# 环绕覆盖后存储序非时间序：按 sequence 重排，保证调用方拿到时间序
	out.sort_custom(func(a: Variant, b: Variant) -> bool:
		return int((a as StructuredLogRecord).sequence) < int((b as StructuredLogRecord).sequence)
	)
	return out

## 全量复制返回（只读语义，调用方改副本不影响缓冲）
static func get_all() -> Array:
	return _buffer.duplicate()

## 当前缓冲条目数
static func size() -> int:
	return _buffer.size()

## 当前容量（配置驱动，含热重载刷新）
static func get_capacity() -> int:
	_ensure_capacity_fresh()
	return _capacity

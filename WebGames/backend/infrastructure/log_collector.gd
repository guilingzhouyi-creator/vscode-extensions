# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Logging & Telemetry)
# 文件路径: res://backend/infrastructure/log_collector.gd
# 架构定位: Log Collector & Stream Processor
# 跨域依赖: 上游: 全域业务模块与异常拦截器 | 下游: RingBuffer, FileAccess | 配置: config/infrastructure/logging.json | 信号: FATAL/ERROR 级别告警信号
# 职责说明: 统一采集全域日志，业务入口签发并维护 trace_id，构造期脱敏 (RedactionRule)， 提取仅含 basename 的源文件与行号，下游多路分发至 EventBus、LogRingBuffer 与 TelemetryAggregate。
# 设计依据: Phase 52 统一结构化日志规范 / Phase 60 性能基准审计
# ==============================================================================

class_name LogCollector extends RefCounted

# ==============================================================================
# 一、链路追踪状态
# ==============================================================================

static var _active_trace_id: String = ""
static var _seq: int = 0

## 测试复位：清空活跃链路 ID 与序号（避免跨用例状态残留）
static func reset_state() -> void:
	_active_trace_id = ""
	_seq = 0

## 业务入口调用：签发新链路追踪 ID（战斗回合开始/交易开启/管线启动）
static func begin_trace(custom_id: String = "") -> String:
	if not custom_id.is_empty():
		_active_trace_id = custom_id
	else:
		_seq += 1
		_active_trace_id = "TRACE_%d_%d" % [int(Time.get_unix_time_from_system()), _seq]
	return _active_trace_id

## 当前活跃链路追踪 ID（空串表示无活跃链路）
static func get_active_trace_id() -> String:
	return _active_trace_id

## 清空活跃链路追踪 ID（链路结束调用）
static func clear_trace() -> void:
	_active_trace_id = ""

# ==============================================================================
# 二、统一采集入口
# ==============================================================================

## 统一采集入口：构造 StructuredLogRecord 并广播
static func log(
	level: String,
	channel: String,
	message: String,
	context: Dictionary = {},
	error_code: String = "",
	duration_ms: int = 0,
	event_category: String = ""
) -> StructuredLogRecord:
	_seq += 1
	var record := StructuredLogRecord.new()
	# 序号由 EventBus.emit_log_record 唯一签发，此处不预占（此前三计数器互写已收敛）；
	# _seq 仅用于链路追踪 ID 派生
	record.timestamp_utc = int(Time.get_unix_time_from_system())
	record.level = level.to_upper()
	record.channel = channel
	record.message = message
	record.error_code = error_code
	record.duration_ms = duration_ms
	record.event_category = event_category
	
	# 链路追踪 ID（Inv-LS-3）：优先使用活跃 trace_id，否则基于 channel 与时间派生
	if not _active_trace_id.is_empty():
		record.trace_id = _active_trace_id
	else:
		record.trace_id = _derived_trace_id(channel)
		
	# 提取调用方信息（仅文件名 basename，杜绝绝对路径）
	var caller_info := _extract_caller()
	record.source_file = str(caller_info.get("source_file", ""))
	record.source_line = int(caller_info.get("source_line", 0))
	
	# 构造期脱敏（Inv-LS-2 安全红线）：入流前脱敏
	var redacted := RedactionRule.apply(context)
	record.context = redacted["dict"]
	var rk = redacted.get("redacted_keys", [])
	if rk is Array:
		for k in rk:
			record.redacted_keys.append(str(k))
			
	# 分发至全局事件总线（向后兼容广播；EventBus 内部已接线 LogRingBuffer 与 TelemetryAggregate）
	var eb := EventBusCore.get_instance()
	if eb != null:
		eb.emit_log_record(record)
	else:
		LogRingBuffer.append(record)
		TelemetryAggregate.consume(record)
		
	return record

# ==============================================================================
# 三、内部实现（链路派生 / 调用方提取）
# ==============================================================================

## 无活跃链路时基于 channel 派生追踪 ID（保证每次 log 均有可对账的 trace_id）
static func _derived_trace_id(channel: String) -> String:
	var ch := channel if not channel.is_empty() else "SYS"
	return "TRACE_%s_%d" % [ch, _seq]

## 从调用栈提取来源文件（仅 basename）与行号（跳过本文件自身帧）
static func _extract_caller() -> Dictionary:
	var stack := get_stack()
	if stack.is_empty():
		return {"source_file": "", "source_line": 0}
	for frame in stack:
		var src := str(frame.get("source", ""))
		var fname := src.get_file()
		if fname != "log_collector.gd" and not fname.is_empty():
			return {
				"source_file": fname,
				"source_line": int(frame.get("line", 0))
			}
	return {"source_file": "", "source_line": 0}

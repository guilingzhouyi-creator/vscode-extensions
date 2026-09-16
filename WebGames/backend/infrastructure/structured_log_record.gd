# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Logging & Telemetry)
# 文件路径: res://backend/infrastructure/structured_log_record.gd
# 架构定位: Log Collector & Stream Processor
# 跨域依赖: 上游: 全域业务模块与异常拦截器 | 下游: RingBuffer, FileAccess | 配置: config/infrastructure/logging.json | 信号: FATAL/ERROR 级别告警信号
# 职责说明: 继承 LogRecordDTO 并扩展全域结构化字段，承载链路追踪 ID (trace_id)、 父跨度 (parent_span_id)、事件分类、耗时指标 (duration_ms)、调用源定位 以及脱敏审计键清单 (redacted_keys)（Inv-LS-1, Inv-LS-2, Inv-LS-3）。
# 设计依据: Phase 52 统一结构化日志规范 / Phase 60 性能基准审计
# ==============================================================================

class_name StructuredLogRecord extends LogRecordDTO

# ==============================================================================
# 一、结构化扩展字段
# ==============================================================================

## 链路追踪 ID（跨域调用链串联，Inv-LS-3）
var trace_id: String = ""

## 父跨度节点 ID（嵌套跨度场景）
var parent_span_id: String = ""

## 事件分类键（对齐 event_categories.json 与叙事通道）
var event_category: String = ""

## 事件执行耗时（毫秒；非耗时事件恒为 0）
var duration_ms: int = 0

## 产生源文件路径（仅文件名/basename，杜绝盘符绝对路径）
var source_file: String = ""

## 产生源行号
var source_line: int = 0

## 已被脱敏规则掩码的敏感键清单（安全审计留痕，Inv-LS-2）
var redacted_keys: Array[String] = []

# ==============================================================================
# 二、生命周期与转换
# ==============================================================================

## 池化复位：先复位基类字段，再清零结构化扩展字段
func reset_state() -> void:
	super.reset_state()
	trace_id = ""
	parent_span_id = ""
	event_category = ""
	duration_ms = 0
	source_file = ""
	source_line = 0
	redacted_keys = []

func to_dto() -> Dictionary:
	var ts := timestamp_utc
	if ts <= 0:
		ts = int(Time.get_unix_time_from_system())
	return {
		"sequence": sequence,
		"timestamp_utc": ts,
		"level": level,
		"channel": channel,
		"error_code": error_code,
		"message": message,
		"trace_id": trace_id,
		"parent_span_id": parent_span_id,
		"event_category": event_category,
		"duration_ms": duration_ms,
		"source_file": source_file,
		"source_line": source_line,
		"context": context.duplicate(true),
		"redacted_keys": redacted_keys.duplicate(),
	}

## 从字典反序列化还原（继承字段 + 结构化字段；context/redacted_keys 仅接受合法类型并深拷贝）
static func from_dto(data: Dictionary) -> StructuredLogRecord:
	var dto := StructuredLogRecord.new()
	if data.is_empty():
		return dto
	dto.sequence = int(data.get("sequence", 0))
	dto.timestamp_utc = int(data.get("timestamp_utc", 0))
	dto.level = str(data.get("level", "INFO"))
	dto.channel = str(data.get("channel", ""))
	dto.error_code = str(data.get("error_code", ""))
	dto.message = str(data.get("message", ""))
	dto.trace_id = str(data.get("trace_id", ""))
	dto.parent_span_id = str(data.get("parent_span_id", ""))
	dto.event_category = str(data.get("event_category", ""))
	dto.duration_ms = int(data.get("duration_ms", 0))
	dto.source_file = str(data.get("source_file", ""))
	dto.source_line = int(data.get("source_line", 0))
	
	var ctx = data.get("context", {})
	if ctx is Dictionary:
		dto.context = ctx.duplicate(true)
		
	var rk = data.get("redacted_keys", [])
	if rk is Array:
		for k in rk:
			dto.redacted_keys.append(str(k))
			
	return dto

# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Logging & Telemetry)
# 文件路径: res://backend/infrastructure/structured_log_record.gd
# 架构定位: Log Collector & Stream Processor
# 依赖与触发: 上游: 全域业务模块与异常拦截器 | 下游: RingBuffer, FileAccess | 配置: config/infrastructure/logging.json | 信号: FATAL/ERROR 级别告警信号
# 职责说明: 继承 LogRecordDTO 并扩展全域结构化字段，承载链路追踪 ID (trace_id)、 父跨度 (parent_span_id)、事件分类、耗时指标 (duration_ms)、调用源定位 以及脱敏审计键清单 (redacted_keys)（Inv-LS-1, Inv-LS-2, Inv-LS-3）。
# 退出语义与设计依据: 统一结构化日志规范 / 性能基准审计
# ==============================================================================

## StructuredLogRecord：Log Collector & Stream Processor
class_name StructuredLogRecord extends LogRecordDTO

const LogConstants = preload("res://backend/infrastructure/logging/log_constants.gd")

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
	redacted_keys.clear()

## 序列化当前对象为通用字典传输结构
func to_dto() -> Dictionary:
	var out: Dictionary = super.to_dto()
	out[LogConstants.KEY_TRACE_ID] = trace_id
	out[LogConstants.KEY_PARENT_SPAN_ID] = parent_span_id
	out[LogConstants.KEY_EVENT_CATEGORY] = event_category
	out[LogConstants.KEY_DURATION_MS] = duration_ms
	out[LogConstants.KEY_SOURCE_FILE] = source_file
	out[LogConstants.KEY_SOURCE_LINE] = source_line
	out[LogConstants.KEY_REDACTED_KEYS] = redacted_keys.duplicate()
	return out

## 深拷贝克隆当前结构化日志对象（避免中间字典反序列化堆分配损耗，ADV-PRF-002）
func clone() -> StructuredLogRecord:
	var c := StructuredLogRecord.new()
	c.sequence = sequence
	c.timestamp_utc = timestamp_utc
	c.level = level
	c.channel = channel
	c.error_code = error_code
	c.message = message
	c.context = context.duplicate(true)
	c.trace_id = trace_id
	c.parent_span_id = parent_span_id
	c.event_category = event_category
	c.duration_ms = duration_ms
	c.source_file = source_file
	c.source_line = source_line
	c.redacted_keys = redacted_keys.duplicate()
	return c

## 从字典反序列化还原（继承字段 + 结构化字段；context/redacted_keys 仅接受合法类型并深拷贝）
static func from_dto(data: Dictionary) -> StructuredLogRecord:
	var dto := StructuredLogRecord.new()
	if data.is_empty():
		return dto
	LogRecordDTO.populate_base_from_dict(dto, data)
	dto.trace_id = str(data.get(LogConstants.KEY_TRACE_ID, ""))
	dto.parent_span_id = str(data.get(LogConstants.KEY_PARENT_SPAN_ID, ""))
	dto.event_category = str(data.get(LogConstants.KEY_EVENT_CATEGORY, ""))
	dto.duration_ms = int(data.get(LogConstants.KEY_DURATION_MS, 0))
	dto.source_file = str(data.get(LogConstants.KEY_SOURCE_FILE, ""))
	dto.source_line = int(data.get(LogConstants.KEY_SOURCE_LINE, 0))
	var rk: Variant = data.get(LogConstants.KEY_REDACTED_KEYS, [])
	if rk is Array:
		for k in (rk as Array):
			dto.redacted_keys.append(str(k))
	return dto

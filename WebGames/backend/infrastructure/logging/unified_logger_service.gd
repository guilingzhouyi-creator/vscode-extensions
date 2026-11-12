# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Logging & Telemetry)
# 文件路径: res://backend/infrastructure/logging/unified_logger_service.gd
# 架构定位: Log Collector & Stream Processor
# 依赖与触发: 上游: 全域业务模块与异常拦截器 | 下游: RingBuffer, FileAccess | 配置: config/infrastructure/log.json | 信号: FATAL/ERROR 级别告警信号
# 职责说明: 全域统一结构化日志服务：支持按模块分级过滤（DEBUG/INFO/WARN/ERROR/FATAL）、上下文标签绑定、异步缓冲写入与防日志泛滥限流。
# 退出语义与设计依据: 统一结构化日志规范 / 性能基准审计
# ==============================================================================

## UnifiedLoggerService：Log Collector & Stream Processor
class_name UnifiedLoggerService extends RefCounted

const LogConstants = preload("res://backend/infrastructure/logging/log_constants.gd")
const SystemBaseMessages = preload("res://backend/infrastructure/logging/system_base_messages.gd")

# ==============================================================================
# 一、日志等级与记录实体
# ==============================================================================

## 日志严重等级标准枚举
enum Severity {
	TRACE = 0,
	DEBUG = 1,
	INFO = 2,
	WARNING = 3,
	ERROR = 4,
	CRITICAL = 5
}

## 结构化日志记录实体
class LogRecord extends RefCounted:
	var sequence: int = 0
	var event_code: String = ""
	var domain: String = ""
	var severity: Severity = Severity.INFO
	var timestamp: float = 0.0
	var correlation_id: String = ""
	var context: Dictionary = {}
	var message: String = ""
	
	## 序列化为字典（遥测/导出用）
	func to_dict() -> Dictionary:
		return {
			"sequence": sequence,
			"event_code": event_code,
			"domain": domain,
			"severity": severity,
			"timestamp": timestamp,
			"correlation_id": correlation_id,
			"context": context,
			"message": message
		}

# ==============================================================================
# 二、服务状态与配置
# ==============================================================================

## 英文消息模板目录: event_code -> format_template
var _message_catalog: Dictionary = {}
## 过滤等级阈值
var _min_severity: Severity = Severity.INFO
## 内存环形缓冲区引用
var _ring_buffer: Object = null
## 性能遥测汇集钩子
var _metric_sink: Object = null
## 静音控制台输出（测试期间可静音，避免控制台刷屏）
var _mute_console: bool = false
## 单机隔离保护状态标记
var _is_standalone_mode: bool = true

## 构造：注入消息模板目录与最低过滤等级
func _init(catalog: Dictionary = {}, min_level: Severity = Severity.INFO) -> void:
	_message_catalog = catalog.duplicate(true)
	_min_severity = min_level

## 设置控制台与日志链路的最低输出日志级别
func set_min_severity(severity_level: Severity) -> void:
	_min_severity = severity_level

## 设置是否静音屏蔽控制台的标准输出
func set_mute_console(mute_console: bool) -> void:
	_mute_console = mute_console

## 设置是否以独立单机模式运行日志管道
func set_standalone_mode(is_standalone: bool) -> void:
	_is_standalone_mode = is_standalone

## 挂载外部高吞吐环形缓冲区
func set_ring_buffer(ring_buffer: Object) -> void:
	_ring_buffer = ring_buffer

## 挂载遥测度量指标收集接收器
func set_metric_sink(metric_sink: Object) -> void:
	_metric_sink = metric_sink

## 获取日志服务已注册的事件目录字典
func get_catalog() -> Dictionary:
	return _message_catalog

## 加载配置表模板库
func load_catalog_from_dict(catalog_config: Dictionary) -> void:
	if catalog_config.has("events") and catalog_config["events"] is Dictionary:
		var evs: Dictionary = catalog_config["events"]
		for code in evs:
			_message_catalog[str(code)] = str(evs[code])

## 从 GameConfig.log 统一加载英文事件码模板（配置驱动，Inv-RM-11）
func load_from_game_config() -> void:
	var tbl: Dictionary = GameConfig.get_dict(LogConstants.CFG_LOG_TABLE, LogConstants.CFG_PATH_EVENTS, {})
	if tbl.is_empty():
		tbl = GameConfig.get_dict(LogConstants.CFG_LOG_TABLE, LogConstants.CFG_PATH_UNIFIED_EVENTS, {})
	for code in tbl:
		_message_catalog[str(code)] = str(tbl[code])

## 记录日志统一核心 API
func log_event(
	event_code: String,
	domain_name: String,
	severity_level: Severity,
	event_params: Dictionary = {},
	correlation_id: String = ""
) -> LogRecord:
	if severity_level < _min_severity:
		return null
	
	var template: String = str(_message_catalog.get(event_code, SystemBaseMessages.MSG_FALLBACK_EVENT))
	var formatted_msg: String = _format_message(template, event_params, event_code, domain_name)
	
	var rec := LogRecord.new()
	rec.event_code = event_code
	rec.domain = domain_name
	rec.severity = severity_level
	rec.timestamp = Time.get_unix_time_from_system()
	rec.correlation_id = correlation_id
	rec.context = event_params.duplicate(true)
	rec.message = formatted_msg
	
	_dispatch_record(rec)
	return rec

# ==============================================================================
# 三、网络隔离与模板格式化
# ==============================================================================

## 尝试广播至网络 RPC（受单机隔离保护拦截）
func try_dispatch_to_network_rpc(log_record: LogRecord) -> bool:
	if _is_standalone_mode:
		# 单机模式严格阻断向网络发送本地日志
		return false
	return log_record != null

## 模板占位符格式化（统一委托底层 TemplateFormatter 执行英文占位符动态注入）
func _format_message(template_str: String, event_params: Dictionary, event_code: String, domain_name: String) -> String:
	var params: Dictionary = event_params.duplicate(true)
	params[LogConstants.KEY_CODE] = event_code
	params[LogConstants.KEY_DOMAIN] = domain_name
	return TemplateFormatter.format(template_str, params)

## 多路分发输出 Sink（先统一构造期脱敏，再收敛至 RingBuffer / EventBusCore 管线，Inv-LS-2 & Inv-LG-3）
func _dispatch_record(log_record: LogRecord) -> void:
	var srec := _to_structured_record(log_record)
	# 同步写回已脱敏消息与上下文，防止调用方持有的 LogRecord 留存明文凭据
	log_record.message = srec.message
	log_record.context = srec.context.duplicate(true)

	# 1. 内存有界环形缓冲（注入式或回退至 EventBusCore 全局中枢）
	if _ring_buffer != null and _ring_buffer.has_method("push_record"):
		_ring_buffer.call("push_record", srec.to_dto())
	else:
		# 收敛：委托至 EventBusCore 统一广播中枢（签发单调 sequence 并扇出至 LogRingBuffer、LogFileExporter 与 TelemetryAggregate）
		if _mute_console:
			srec.context[LogConstants.KEY_MUTE_CONSOLE] = true
		var eb := EventBusCore.get_instance()
		if eb != null:
			eb.emit_log_record(srec)
		else:
			# 极端无总线环境优雅回退
			LogFileExporter.consume(srec)
			LogRingBuffer.append(srec)
			TelemetryAggregate.consume(srec)
		log_record.sequence = srec.sequence

		if _metric_sink != null and _metric_sink.has_method("record_metric"):
			_metric_sink.call("record_metric", LogConstants.METRIC_LOG_EVENT_COUNT, LogConstants.CATEGORY_LOG_VOLUME, 1.0, {
				LogConstants.KEY_DOMAIN: log_record.domain,
				LogConstants.KEY_SEVERITY: _get_severity_name(log_record.severity)
			})
	
	# 2. 控制台输出格式化（总线为空且未静音时本地穿透，避免漏打）
	if not _mute_console and EventBusCore.get_instance() == null:
		var formatted_line := SystemBaseMessages.format_unified_console_line(
			_get_severity_name(log_record.severity),
			log_record.domain,
			log_record.event_code,
			log_record.message
		)
		if log_record.severity >= Severity.ERROR:
			printerr(formatted_line)
		else:
			print_rich(formatted_line)

func _to_structured_record(log_record: LogRecord) -> StructuredLogRecord:
	var srec := StructuredLogRecord.new()
	srec.level = _map_severity_to_level(log_record.severity)
	srec.channel = log_record.domain
	srec.message = log_record.message
	srec.error_code = log_record.event_code
	srec.trace_id = log_record.correlation_id
	srec.timestamp_utc = int(log_record.timestamp)
	srec.event_category = log_record.domain
	RedactionRule.apply_to_record(srec, log_record.context)
	return srec

func _map_severity_to_level(severity_level: Severity) -> String:
	match severity_level:
		Severity.TRACE: return LogConstants.LEVEL_DEBUG
		Severity.DEBUG: return LogConstants.LEVEL_DEBUG
		Severity.INFO: return LogConstants.LEVEL_INFO
		Severity.WARNING: return LogConstants.LEVEL_WARN
		Severity.ERROR: return LogConstants.LEVEL_ERROR
		Severity.CRITICAL: return LogConstants.LEVEL_ERROR
		_: return LogConstants.LEVEL_INFO

func _get_severity_name(severity_level: Severity) -> String:
	match severity_level:
		Severity.TRACE: return LogConstants.LEVEL_TRACE
		Severity.DEBUG: return LogConstants.LEVEL_DEBUG
		Severity.INFO: return LogConstants.LEVEL_INFO
		Severity.WARNING: return LogConstants.LEVEL_WARN
		Severity.ERROR: return LogConstants.LEVEL_ERROR
		Severity.CRITICAL: return LogConstants.LEVEL_CRIT
		_: return LogConstants.LEVEL_UNKNOWN

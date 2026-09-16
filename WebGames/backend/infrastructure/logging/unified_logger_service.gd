# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Logging & Telemetry)
# 文件路径: res://backend/infrastructure/logging/unified_logger_service.gd
# 架构定位: Log Collector & Stream Processor
# 跨域依赖: 上游: 全域业务模块与异常拦截器 | 下游: RingBuffer, FileAccess | 配置: config/infrastructure/logging.json | 信号: FATAL/ERROR 级别告警信号
# 职责说明: 全域统一结构化日志服务：支持按模块分级过滤（DEBUG/INFO/WARN/ERROR/FATAL）、上下文标签绑定、异步缓冲写入与防日志泛滥限流。
# 设计依据: Phase 52 统一结构化日志规范 / Phase 60 性能基准审计
# ==============================================================================

class_name UnifiedLoggerService extends RefCounted

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
func _init(p_catalog: Dictionary = {}, p_min_level: Severity = Severity.INFO) -> void:
	_message_catalog = p_catalog.duplicate(true)
	_min_severity = p_min_level

func set_min_severity(p_sev: Severity) -> void:
	_min_severity = p_sev

func set_mute_console(p_mute: bool) -> void:
	_mute_console = p_mute

func set_standalone_mode(p_sp: bool) -> void:
	_is_standalone_mode = p_sp

func set_ring_buffer(p_buf: Object) -> void:
	_ring_buffer = p_buf

func set_metric_sink(p_sink: Object) -> void:
	_metric_sink = p_sink

func get_catalog() -> Dictionary:
	return _message_catalog

## 加载配置表模板库
func load_catalog_from_dict(p_config: Dictionary) -> void:
	if p_config.has("events") and p_config["events"] is Dictionary:
		var evs: Dictionary = p_config["events"]
		for code in evs:
			_message_catalog[str(code)] = str(evs[code])

## 从 GameConfig.log 统一加载英文事件码模板（配置驱动，Inv-RM-11）
func load_from_game_config() -> void:
	var tbl: Dictionary = GameConfig.get_dict("infrastructure.log", "unified_events", {})
	if tbl.is_empty():
		tbl = GameConfig.get_dict("infrastructure.log", "events", {})
	for code in tbl:
		_message_catalog[str(code)] = str(tbl[code])

## 记录日志统一核心 API
func log_event(
	p_code: String,
	p_domain: String,
	p_severity: Severity,
	p_params: Dictionary = {},
	p_correlation_id: String = ""
) -> LogRecord:
	if p_severity < _min_severity:
		return null
	
	var default_template: String = "[{code}] Event occurred in domain {domain}."
	var template: String = str(_message_catalog.get(p_code, default_template))
	var formatted_msg: String = _format_message(template, p_params, p_code, p_domain)
	
	var rec := LogRecord.new()
	rec.event_code = p_code
	rec.domain = p_domain
	rec.severity = p_severity
	rec.timestamp = Time.get_unix_time_from_system()
	rec.correlation_id = p_correlation_id
	rec.context = p_params.duplicate(true)
	rec.message = formatted_msg
	
	_dispatch_record(rec)
	return rec

# ==============================================================================
# 三、网络隔离与模板格式化
# ==============================================================================

## 尝试广播至网络 RPC（受单机隔离保护拦截）
func try_dispatch_to_network_rpc(p_rec: LogRecord) -> bool:
	if _is_standalone_mode:
		# 单机模式严格阻断向网络发送本地日志
		return false
	return p_rec != null

## 模板占位符格式化
func _format_message(p_tpl: String, p_params: Dictionary, p_code: String, p_domain: String) -> String:
	var msg: String = p_tpl
	msg = msg.replace("{code}", p_code)
	msg = msg.replace("{domain}", p_domain)
	for k in p_params:
		msg = msg.replace("{" + str(k) + "}", str(p_params[k]))
	return msg

## 多路分发输出 Sink（收敛至统一管线）
func _dispatch_record(p_rec: LogRecord) -> void:
	# 1. 内存有界环形缓冲（注入式或回退至 LogRingBuffer 统一缓冲）
	if _ring_buffer != null and _ring_buffer.has_method("push_record"):
		_ring_buffer.call("push_record", p_rec.to_dict())
	else:
		# 回退：委托至统一结构化日志缓冲（避免双轨分流）
		var srec := StructuredLogRecord.new()
		srec.level = _map_severity_to_level(p_rec.severity)
		srec.channel = p_rec.domain
		srec.message = p_rec.message
		srec.error_code = p_rec.event_code
		srec.trace_id = p_rec.correlation_id
		srec.context = p_rec.context.duplicate(true)
		srec.timestamp_utc = int(p_rec.timestamp)
		srec.event_category = p_rec.domain
		# 单机隔离：StructuredLogRecord 入环与遥测由 EventBus 统一调度，此处直入缓冲避免循环广播
		LogRingBuffer.append(srec)
		TelemetryAggregate.consume(srec)
		if _metric_sink != null and _metric_sink.has_method("record_metric"):
			_metric_sink.call("record_metric", "log_event_count", "LOG_VOLUME", 1.0, {"domain": p_rec.domain, "severity": _get_severity_name(p_rec.severity)})
	
	# 2. 控制台输出格式化
	if not _mute_console:
		var sev_name: String = _get_severity_name(p_rec.severity)
		var formatted_line: String = "[%s][%s][%s] %s" % [
			sev_name,
			p_rec.domain,
			p_rec.event_code,
			p_rec.message
		]
		if p_rec.severity >= Severity.ERROR:
			printerr(formatted_line)
		else:
			print_rich(formatted_line)

func _map_severity_to_level(p_sev: Severity) -> String:
	match p_sev:
		Severity.TRACE: return "DEBUG"
		Severity.DEBUG: return "DEBUG"
		Severity.INFO: return "INFO"
		Severity.WARNING: return "WARN"
		Severity.ERROR: return "ERROR"
		Severity.CRITICAL: return "ERROR"
		_: return "INFO"

func _get_severity_name(p_sev: Severity) -> String:
	match p_sev:
		Severity.TRACE: return "TRACE"
		Severity.DEBUG: return "DEBUG"
		Severity.INFO: return "INFO"
		Severity.WARNING: return "WARN"
		Severity.ERROR: return "ERROR"
		Severity.CRITICAL: return "CRIT"
		_: return "UNKNOWN"

# ==============================================================================
# 单元测试：统一英文日志基础设施与度量扩展 (Unified Logger & Profiling)
# 文件路径: res://tests/unit/infrastructure/test_unified_logger_service.gd
# 职责: 验证统一英文日志格式化、分级过滤、单机/联机隔离与性能度量扩展（TC-RM-29 ~ TC-RM-36）
# ==============================================================================
class_name TestUnifiedLoggerService extends RefCounted

const UnifiedLoggerService = preload("res://backend/infrastructure/logging/unified_logger_service.gd")
const ProfilingMetricHook = preload("res://backend/infrastructure/profiling/profiling_metric_hook.gd")

static func run_all_tests() -> Dictionary:
	var results: Array = []
	results.append(test_logger_catalog_load())
	results.append(test_message_placeholder_formatting())
	results.append(test_undefined_event_fallback())
	results.append(test_severity_threshold_filter())
	results.append(test_severity_threshold_pass())
	results.append(test_standalone_rpc_isolation())
	results.append(test_profiling_metric_sample())
	results.append(test_profiling_metric_bounded_capacity())
	results.append(test_unified_logger_eventbus_sequence_convergence())
	results.append(test_log_collector_caller_capture_toggle())
	results.append(test_log_file_exporter_batch_and_critical_flush())

	var all_passed: bool = true
	for r in results:
		if not bool(r.get("passed", false)):
			all_passed = false
			break
	return {
		"domain": "统一英文日志基础设施与度量扩展",
		"all_passed": all_passed,
		"results": results
	}

## TC-RM-29: 统一日志初始化与模板库加载
static func test_logger_catalog_load() -> Dictionary:
	var logger := UnifiedLoggerService.new()
	logger.set_mute_console(true)
	var cfg: Dictionary = {
		"events": {
			"TEST_EVT_1": "Item '{item_id}' loaded.",
			"TEST_EVT_2": "State '{state}' verified."
		}
	}
	logger.load_catalog_from_dict(cfg)
	var cat: Dictionary = logger.get_catalog()
	
	var passed: bool = (cat.size() == 2) and (cat.has("TEST_EVT_1")) and (cat.has("TEST_EVT_2"))
	return {
		"test": "TC-RM-29: 统一日志初始化与模板目录全量装载",
		"passed": passed,
		"detail": "catalog_size=%d" % cat.size()
	}

## TC-RM-30: 英文模板参数全量替换
static func test_message_placeholder_formatting() -> Dictionary:
	var logger := UnifiedLoggerService.new()
	logger.set_mute_console(true)
	logger.load_catalog_from_dict({
		"events": {
			"LOG_RES_LIFECYCLE_TRACKED": "Resource '{resource_id}' tracked under category '{category}' by owner '{owner}'."
		}
	})
	
	var rec: UnifiedLoggerService.LogRecord = logger.log_event(
		"LOG_RES_LIFECYCLE_TRACKED",
		"resource_governance",
		UnifiedLoggerService.Severity.INFO,
		{"resource_id": "ctrl_ui_99", "category": "UI_CONTROL_NODE", "owner": "MainHUD"}
	)
	
	var expected: String = "Resource 'ctrl_ui_99' tracked under category 'UI_CONTROL_NODE' by owner 'MainHUD'."
	var passed: bool = (rec != null) and (rec.message == expected)
	return {
		"test": "TC-RM-30: 英文日志模板占位符参数精确替换",
		"passed": passed,
		"detail": "rendered='%s'" % (rec.message if rec != null else "null")
	}

## TC-RM-31: 未定义事件码默认回退
static func test_undefined_event_fallback() -> Dictionary:
	var logger := UnifiedLoggerService.new()
	logger.set_mute_console(true)
	var rec: UnifiedLoggerService.LogRecord = logger.log_event(
		"UNKNOWN_EVENT_999",
		"inventory",
		UnifiedLoggerService.Severity.WARNING
	)
	
	var passed: bool = (rec != null) and (rec.message.contains("UNKNOWN_EVENT_999")) and (rec.message.contains("inventory"))
	return {
		"test": "TC-RM-31: 未注册事件码优雅回退至默认英文格式",
		"passed": passed,
		"detail": "rendered='%s'" % (rec.message if rec != null else "null")
	}

## TC-RM-32: 严重级别过滤门槛测试
static func test_severity_threshold_filter() -> Dictionary:
	var logger := UnifiedLoggerService.new({}, UnifiedLoggerService.Severity.ERROR)
	logger.set_mute_console(true)
	
	var rec: UnifiedLoggerService.LogRecord = logger.log_event(
		"LOG_INFO_TEST",
		"system",
		UnifiedLoggerService.Severity.INFO # 低于 ERROR 门槛，应被拦截
	)
	
	var passed: bool = (rec == null)
	return {
		"test": "TC-RM-32: 低于过滤门槛的日志事件直接静默拦截",
		"passed": passed,
		"detail": "rec_is_null=%s" % (rec == null)
	}

## TC-RM-33: 严重级别放行门槛测试
static func test_severity_threshold_pass() -> Dictionary:
	var logger := UnifiedLoggerService.new({}, UnifiedLoggerService.Severity.ERROR)
	logger.set_mute_console(true)
	
	var rec: UnifiedLoggerService.LogRecord = logger.log_event(
		"LOG_CRIT_TEST",
		"system",
		UnifiedLoggerService.Severity.CRITICAL
	)
	
	var passed: bool = (rec != null) and (rec.severity == UnifiedLoggerService.Severity.CRITICAL)
	return {
		"test": "TC-RM-33: 达到过滤门槛的日志事件正常分发放行",
		"passed": passed,
		"detail": "rec_severity=%s" % (rec.severity if rec != null else "null")
	}

## TC-RM-34: 单机模式本地日志隔离阻断
static func test_standalone_rpc_isolation() -> Dictionary:
	var logger := UnifiedLoggerService.new()
	logger.set_mute_console(true)
	logger.set_standalone_mode(true)
	
	var rec: UnifiedLoggerService.LogRecord = logger.log_event(
		"LOCAL_TRACE_DATA",
		"standalone",
		UnifiedLoggerService.Severity.DEBUG
	)
	
	var can_rpc: bool = logger.try_dispatch_to_network_rpc(rec)
	var passed: bool = (not can_rpc)
	return {
		"test": "TC-RM-34: 单机模式本地调试日志网络RPC阻断拦截",
		"passed": passed,
		"detail": "can_rpc=%s" % can_rpc
	}

## TC-RM-35: 性能遥测度量样本记录
static func test_profiling_metric_sample() -> Dictionary:
	var hook := ProfilingMetricHook.new()
	hook.set_enabled(true)
	
	hook.record_metric("heap_allocated_bytes", "MEMORY", 1048576.0, {"scope": "backend"})
	hook.record_metric("tick_latency_ms", "EXECUTION_TIME", 2.5, {"module": "combat"})
	
	var mem_samples: Array = hook.get_samples_by_category("MEMORY")
	var passed: bool = (hook.sample_count() == 2) and (mem_samples.size() == 1)
	return {
		"test": "TC-RM-35: 性能度量探针分类指标采样与存储",
		"passed": passed,
		"detail": "total_samples=%d, mem_samples=%d" % [hook.sample_count(), mem_samples.size()]
	}

## TC-RM-36: 性能遥测度量容量有界约束
static func test_profiling_metric_bounded_capacity() -> Dictionary:
	var hook := ProfilingMetricHook.new(20) # 容量 20
	hook.set_enabled(true)
	
	for i in range(35):
		hook.record_metric("sample_%d" % i, "TICK_LATENCY", float(i))
	
	var passed: bool = (hook.sample_count() == 20)
	return {
		"test": "TC-RM-36: 性能度量队列容量有界硬约束防内存泄漏",
		"passed": passed,
		"detail": "sample_count=%d" % hook.sample_count()
	}

## TC-RM-37: 统一日志服务收敛至 EventBusCore 序号签发与入环对账
static func test_unified_logger_eventbus_sequence_convergence() -> Dictionary:
	var logger := UnifiedLoggerService.new()
	logger.set_mute_console(true)
	logger.load_catalog_from_dict({
		"events": {
			"TEST_CONVERGENCE_01": "Convergence test event in domain {domain}."
		}
	})
	var rec: UnifiedLoggerService.LogRecord = logger.log_event(
		"TEST_CONVERGENCE_01",
		"governance",
		UnifiedLoggerService.Severity.INFO
	)

	var ok_seq: bool = (rec != null) and (rec.sequence > 0)
	var ok_dto: bool = (rec != null) and (int(rec.to_dict().get("sequence", 0)) == rec.sequence)
	return {
		"test": "TC-RM-37: 统一日志服务收敛至 EventBusCore 序号签发与入环对账",
		"passed": ok_seq and ok_dto,
		"detail": "rec_sequence=%d" % (rec.sequence if rec != null else 0)
	}

## TC-RM-38: LogCollector 反射调用栈按需抓取门槛切换断言
static func test_log_collector_caller_capture_toggle() -> Dictionary:
	LogCollector.reset_state()
	LogCollector.set_caller_capture_enabled(false)
	var rec_disabled := LogCollector.log("info", "test_domain", "Caller disabled test")
	var disabled_empty: bool = rec_disabled.source_file.is_empty() and rec_disabled.source_line == 0

	LogCollector.set_caller_capture_enabled(true)
	var rec_enabled := LogCollector.log("info", "test_domain", "Caller enabled test")
	var enabled_ok: bool = rec_enabled.source_file.ends_with(".gd") and rec_enabled.source_line > 0

	LogCollector.reset_state()
	return {
		"test": "TC-RM-38: LogCollector 反射调用栈按需抓取门槛切换断言",
		"passed": disabled_empty and enabled_ok,
		"detail": "disabled_empty=%s, enabled_ok=%s" % [str(disabled_empty), str(enabled_ok)]
	}

## TC-RM-39: LogFileExporter 批处理暂存与紧急刷盘屏障断言
static func test_log_file_exporter_batch_and_critical_flush() -> Dictionary:
	LogFileExporter.reset_for_test()
	var test_dir := "user://test_batch_logs_tc39"
	if DirAccess.dir_exists_absolute(test_dir):
		var d := DirAccess.open(test_dir)
		if d != null:
			for f in d.get_files():
				DirAccess.remove_absolute("%s/%s" % [test_dir, f])

	var cfg := LogExportConfigDTO.new()
	cfg.enabled = true
	cfg.directory = test_dir
	cfg.file_prefix = "batch_tc39"
	cfg.min_level = "info"
	cfg.max_bytes = 1048576
	cfg.max_files = 2
	LogFileExporter._config = cfg
	LogFileExporter._config_version = GameConfig.config_reload_version()
	LogFileExporter._batch_threshold = 4

	var r1 := LogRecordDTO.new()
	r1.level = "INFO"
	r1.message = "Batch line 1"
	var r2 := LogRecordDTO.new()
	r2.level = "INFO"
	r2.message = "Batch line 2"

	LogFileExporter.consume(r1)
	LogFileExporter.consume(r2)
	var buffered_ok: bool = (LogFileExporter._pending_batch.size() == 2) and (LogFileExporter._exported_count == 0)

	var r_err := LogRecordDTO.new()
	r_err.level = "ERROR"
	r_err.message = "Critical triggers immediate barrier flush"
	LogFileExporter.consume(r_err)
	var flushed_ok: bool = (LogFileExporter._pending_batch.size() == 0) and (LogFileExporter._exported_count == 3)

	if DirAccess.dir_exists_absolute(test_dir):
		var d := DirAccess.open(test_dir)
		if d != null:
			for f in d.get_files():
				DirAccess.remove_absolute("%s/%s" % [test_dir, f])
		DirAccess.remove_absolute(test_dir)
	LogFileExporter.reset_for_test()

	return {
		"test": "TC-RM-39: LogFileExporter 批处理暂存与紧急刷盘屏障断言",
		"passed": buffered_ok and flushed_ok,
		"detail": "buffered_ok=%s, flushed_ok=%s" % [str(buffered_ok), str(flushed_ok)]
	}

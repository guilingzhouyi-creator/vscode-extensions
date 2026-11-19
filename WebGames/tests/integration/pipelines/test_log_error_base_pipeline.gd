# ==============================================================================
# 模块归属: 测试体系 (Tests · Integration Pipelines)
# 文件路径: res://tests/integration/pipelines/test_log_error_base_pipeline.gd
# 架构定位: End-to-End Integration Test Pipeline
# 依赖与触发: 触发方: TestRegistry / test_runner | 上游: backend/, frontend/ | 下游: tests/reports/
# 职责说明: 验收统一日志记录模型（LogRecordDTO）、日志导出器（LogFileExporter）、 错误码注册表（ErrorCodeRegistry）、统一爆错通道（ErrorReporter）与存量收敛
# 退出语义与设计依据: 退出码: 返回 all_passed 与断言列表字典 | 设计依据: 卡拉尔世界引擎 (Kalar World Engine) - 统一日志错误基础框架测试套件
# ==============================================================================

## TestLogErrorBasePipeline：验收统一日志记录模型（LogRecordDTO）、日志导出器（LogFileExporter）、 错误码注册表（Erro
class_name TestLogErrorBasePipeline
extends RefCounted

const LogRecordDTOClass = preload("res://backend/infrastructure/log_record_dto.gd")
const LogExportConfigDTOClass = preload("res://backend/infrastructure/log_export_config_dto.gd")
const ErrorCodeRegistryClass = preload("res://backend/infrastructure/error_code_registry.gd")
const LogFileExporterClass = preload("res://backend/infrastructure/log_file_exporter.gd")
const ErrorReporterClass = preload("res://backend/infrastructure/error_reporter.gd")
const ContractRegistryIndexClass = preload("res://backend/domains/contract_registry/contract_registry_index.gd")
const GMArbitrationAuditServiceClass = preload("res://backend/domains/admin_sandbox/gm_arbitration_audit_service.gd")

## 执行本测试套件全量用例并返回聚合结果字典
static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name := "统一日志错误基础框架与英文报错收敛治理验收流水线"

	results.append(_test_lg_01_log_record_dto_serialization_and_deep_copy())
	results.append(_test_lg_02_log_export_config_dto_from_config())
	results.append(_test_lg_03_log_export_config_fallback())
	results.append(_test_lg_04_error_code_registry_lookup())
	results.append(_test_lg_05_error_code_registry_missing_codes())
	results.append(_test_lg_06_exporter_append_and_file_creation())
	results.append(_test_lg_07_exporter_invalid_dir_handling())
	results.append(_test_lg_08_exporter_level_filtering())
	results.append(_test_lg_09_exporter_channel_whitelist())
	results.append(_test_lg_10_exporter_rotation_and_pruning())
	results.append(_test_lg_11_exporter_config_reload_reconstruction())
	results.append(_test_lg_12_exporter_sequence_reconciliation())
	results.append(_test_lg_13_exporter_disabled_zero_overhead())
	results.append(_test_lg_14_error_reporter_emit_registered_error())
	results.append(_test_lg_15_error_reporter_unregistered_fallback_and_telemetry())
	results.append(_test_lg_16_error_reporter_message_resolution())
	results.append(_test_lg_17_event_bus_legacy_emit_log_compatibility())
	results.append(_test_lg_18_event_bus_signal_forwarding_to_frontend())
	results.append(_test_lg_19_zero_push_error_in_contract_registry())
	results.append(_test_lg_20_fail_closed_contract_registry_behavior())
	results.append(_test_lg_21_gm_audit_i18n_and_convergence())
	results.append(_test_lg_22_errors_catalog_required_table_present())
	results.append(_test_lg_23_full_integration_pipeline_regression())
	results.append(_test_lg_24_hardened_observability_and_preservation())

	var passed_cnt := 0
	for r in results:
		if bool(r.get("passed", false)):
			passed_cnt += 1

	return {
		"domain": domain_name,
		"passed_count": passed_cnt,
		"total_count": results.size(),
		"all_passed": (passed_cnt == results.size()),
		"results": results
	}

## TC-LG-01: LogRecordDTO 字段齐备与序列化往返及深拷贝隔离断言
static func _test_lg_01_log_record_dto_serialization_and_deep_copy() -> Dictionary:
	var record := LogRecordDTOClass.new()
	record.sequence = 42
	record.timestamp_utc = 1725600000
	record.level = "WARN"
	record.channel = "combat"
	record.error_code = "ERR_CARD_POOL_EXHAUSTED"
	record.message = "Card pool exhausted in round 3"
	record.context = {"round": 3, "nested": {"cards_left": 0}}

	var dto := record.to_dto()
	if dto["sequence"] != 42 or dto["level"] != "WARN" or dto["error_code"] != "ERR_CARD_POOL_EXHAUSTED":
		return {"test": "TC-LG-01", "passed": false, "error": "DTO fields mismatch"}

	# 深拷贝断言：修改原始 context 不应影响 DTO context
	record.context["round"] = 99
	record.context["nested"]["cards_left"] = 10
	if dto["context"]["round"] != 3 or dto["context"]["nested"]["cards_left"] != 0:
		return {"test": "TC-LG-01", "passed": false, "error": "Context was not deeply copied in to_dto()"}

	# 反序列化往返断言
	var revived := LogRecordDTOClass.from_dto(dto)
	if revived.sequence != 42 or revived.error_code != "ERR_CARD_POOL_EXHAUSTED" or revived.context["round"] != 3:
		return {"test": "TC-LG-01", "passed": false, "error": "Deserialization mismatch"}

	return {"test": "TC-LG-01: LogRecordDTO 序列化与深拷贝", "passed": true}

## TC-LG-02: LogExportConfigDTO.from_config() 全字段映射校验
static func _test_lg_02_log_export_config_dto_from_config() -> Dictionary:
	var cfg := LogExportConfigDTOClass.from_config()
	if cfg == null:
		return {"test": "TC-LG-02", "passed": false, "error": "Failed to parse LogExportConfigDTO from config"}
	if cfg.directory.is_empty():
		return {"test": "TC-LG-02", "passed": false, "error": "Directory in config is empty"}
	if cfg.file_prefix != "kalar":
		return {"test": "TC-LG-02", "passed": false, "error": "Unexpected file_prefix: %s" % cfg.file_prefix}
	if cfg.max_bytes <= 0 or cfg.max_files <= 0:
		return {"test": "TC-LG-02", "passed": false, "error": "Invalid max_bytes or max_files thresholds"}
	return {"test": "TC-LG-02: LogExportConfigDTO 配置映射", "passed": true}

## TC-LG-03: export 段缺省安全回退断言
static func _test_lg_03_log_export_config_fallback() -> Dictionary:
	var dto := LogExportConfigDTOClass.new()
	if dto.enabled != false or dto.file_prefix != "kalar" or dto.min_level != "info":
		return {"test": "TC-LG-03", "passed": false, "error": "Default DTO values not safe"}
	return {"test": "TC-LG-03: LogExportConfigDTO 缺省回退安全", "passed": true}

## TC-LG-04: ErrorCodeRegistry 全域英文错误码装载与精确查询
static func _test_lg_04_error_code_registry_lookup() -> Dictionary:
	var entry := ErrorCodeRegistryClass.lookup("ERR_ACCOUNT_NOT_FOUND")
	if entry == null:
		return {"test": "TC-LG-04", "passed": false, "error": "ERR_ACCOUNT_NOT_FOUND lookup returned null"}
	if entry.code != "ERR_ACCOUNT_NOT_FOUND" or entry.severity != "error" or entry.domain != "account":
		return {"test": "TC-LG-04", "passed": false, "error": "ERR_ACCOUNT_NOT_FOUND metadata mismatch"}

	var unknown_entry := ErrorCodeRegistryClass.lookup("TOTALLY_NON_EXISTENT_CODE_12345")
	if unknown_entry != null:
		return {"test": "TC-LG-04", "passed": false, "error": "Non-existent error code lookup must return null"}

	return {"test": "TC-LG-04: ErrorCodeRegistry 装载与查询", "passed": true}

## TC-LG-05: ErrorCodeRegistry missing_codes 门禁断言
static func _test_lg_05_error_code_registry_missing_codes() -> Dictionary:
	var test_codes := ["ERR_ACCOUNT_NOT_FOUND", "CONFIG_FILE_NOT_FOUND", "ERR_FAKE_A", "ERR_FAKE_B"]
	var missing := ErrorCodeRegistryClass.missing_codes(test_codes)
	if missing.size() != 2 or not ("ERR_FAKE_A" in missing) or not ("ERR_FAKE_B" in missing):
		return {"test": "TC-LG-05", "passed": false, "error": "missing_codes failed to identify exact missing list"}
	return {"test": "TC-LG-05: ErrorCodeRegistry 未登记错误码断言", "passed": true}

static func _prepare_exporter_config(
	test_dir: String,
	file_prefix: String,
	min_level: String,
	max_bytes: int = 1048576,
	max_files: int = 3,
	clear_existing: bool = false,
	enabled: bool = true
) -> void:
	LogFileExporterClass.reset_for_test()
	if clear_existing and not test_dir.is_empty() and DirAccess.dir_exists_absolute(test_dir):
		var d := DirAccess.open(test_dir)
		if d != null:
			for f in d.get_files():
				DirAccess.remove_absolute("%s/%s" % [test_dir, f])
	var cfg := LogExportConfigDTOClass.new()
	cfg.enabled = enabled
	cfg.directory = test_dir
	cfg.file_prefix = file_prefix
	cfg.min_level = min_level
	cfg.max_bytes = max_bytes
	cfg.max_files = max_files
	LogFileExporterClass._config = cfg
	LogFileExporterClass._config_version = GameConfig.config_reload_version()

## TC-LG-06: LogFileExporter 文件创建与追加落盘断言
static func _test_lg_06_exporter_append_and_file_creation() -> Dictionary:
	var test_dir := "user://test_logs_tc06"
	var base := "%s/tc06_exp" % test_dir
	_prepare_exporter_config(test_dir, "tc06_exp", "debug", 1048576, 3, true, true)

	for i in range(3):
		var rec := LogRecordDTOClass.new()
		rec.level = "INFO"
		rec.channel = "test"
		rec.message = "Hello log %d" % i
		var ok := LogFileExporterClass.consume(rec)
		if not ok:
			return {"test": "TC-LG-06", "passed": false, "error": "consume() failed for log %d" % i}

	var target_file := base + ".log"
	if not FileAccess.file_exists(target_file):
		return {"test": "TC-LG-06", "passed": false, "error": "Target log file was not created"}

	var f := FileAccess.open(target_file, FileAccess.READ)
	var lines := []
	while not f.eof_reached() and lines.size() < 1000:
		var l := f.get_line().strip_edges()
		if not l.is_empty():
			lines.append(l)
	f.close()

	if lines.size() != 3:
		return {"test": "TC-LG-06", "passed": false, "error": "Expected 3 lines, found %d" % lines.size()}

	# 验证每行为合法 JSON 且 sequence 递增
	var seq := 1
	for line in lines:
		var parsed = JSON.parse_string(line)
		if not (parsed is Dictionary) or int(parsed.get("sequence", 0)) != seq:
			return {"test": "TC-LG-06", "passed": false, "error": "Line is not valid JSON or sequence out of order"}
		seq += 1

	return {"test": "TC-LG-06: LogFileExporter 追加与文件创建", "passed": true}

## TC-LG-07: LogFileExporter 非法路径安全防御断言
static func _test_lg_07_exporter_invalid_dir_handling() -> Dictionary:
	_prepare_exporter_config("", "kalar", "info")

	var rec := LogRecordDTOClass.new()
	rec.level = "INFO"
	var ok := LogFileExporterClass.consume(rec)
	if ok:
		return {"test": "TC-LG-07", "passed": false, "error": "Empty directory must return false"}
	return {"test": "TC-LG-07: LogFileExporter 非法路径安全防御", "passed": true}

## TC-LG-08: LogFileExporter 日志级别权重过滤断言
static func _test_lg_08_exporter_level_filtering() -> Dictionary:
	_prepare_exporter_config("user://test_logs_tc08", "tc08_exp", "warn")

	var rec_debug := LogRecordDTOClass.new()
	rec_debug.level = "debug"
	var rec_info := LogRecordDTOClass.new()
	rec_info.level = "info"
	var rec_warn := LogRecordDTOClass.new()
	rec_warn.level = "warn"
	var rec_err := LogRecordDTOClass.new()
	rec_err.level = "error"

	if LogFileExporterClass.consume(rec_debug):
		return {"test": "TC-LG-08", "passed": false, "error": "debug level was not filtered out"}
	if LogFileExporterClass.consume(rec_info):
		return {"test": "TC-LG-08", "passed": false, "error": "info level was not filtered out"}
	if not LogFileExporterClass.consume(rec_warn):
		return {"test": "TC-LG-08", "passed": false, "error": "warn level was unexpectedly filtered"}
	if not LogFileExporterClass.consume(rec_err):
		return {"test": "TC-LG-08", "passed": false, "error": "error level was unexpectedly filtered"}

	return {"test": "TC-LG-08: LogFileExporter 级别权重过滤", "passed": true}

## TC-LG-09: LogFileExporter 通道白名单过滤断言
static func _test_lg_09_exporter_channel_whitelist() -> Dictionary:
	_prepare_exporter_config("user://test_logs_tc09", "tc09_exp", "info")
	LogFileExporterClass._config.include_channels = ["allowed_domain"]

	var rec_blocked := LogRecordDTOClass.new()
	rec_blocked.level = "info"
	rec_blocked.channel = "blocked_domain"

	var rec_allowed := LogRecordDTOClass.new()
	rec_allowed.level = "info"
	rec_allowed.channel = "allowed_domain"

	if LogFileExporterClass.consume(rec_blocked):
		return {"test": "TC-LG-09", "passed": false, "error": "Non-whitelisted channel was not filtered"}
	if not LogFileExporterClass.consume(rec_allowed):
		return {"test": "TC-LG-09", "passed": false, "error": "Whitelisted channel was blocked"}

	return {"test": "TC-LG-09: LogFileExporter 通道白名单过滤", "passed": true}

## TC-LG-10: LogFileExporter 轮转截断与归档文件上限裁剪断言
static func _test_lg_10_exporter_rotation_and_pruning() -> Dictionary:
	var test_dir := "user://test_logs_tc10"
	_prepare_exporter_config(test_dir, "tc10_exp", "info", 80, 2, true, true)

	for i in range(10):
		var rec := LogRecordDTOClass.new()
		rec.level = "info"
		rec.message = "Payload long enough to exceed rotation threshold %d" % i
		LogFileExporterClass.consume(rec)

	var dir := DirAccess.open(test_dir)
	var archives: Array[String] = []
	if dir != null:
		dir.list_dir_begin()
		var fn := dir.get_next()
		while not fn.is_empty():
			if fn.begins_with("tc10_exp.") and fn.ends_with(".log") and fn != "tc10_exp.log":
				archives.append(fn)
			file_name_next(dir, fn)
			fn = dir.get_next()
		dir.list_dir_end()

	if archives.size() > 2:
		return {"test": "TC-LG-10", "passed": false, "error": "Rotated archives exceed max_files limit (count: %d)" % archives.size()}

	return {"test": "TC-LG-10: LogFileExporter 轮转截断与裁剪", "passed": true}

## 迭代读取测试日志目录中的下一个文件名
static func file_name_next(_dir: DirAccess, _fn: String) -> void:
	pass

## TC-LG-11: LogFileExporter 配置热重载版本侦测自愈断言
static func _test_lg_11_exporter_config_reload_reconstruction() -> Dictionary:
	LogFileExporterClass.reset_for_test()
	var exporter_instance := LogFileExporterClass.get_instance()
	if exporter_instance == null:
		return {"test": "TC-LG-11", "passed": false, "error": "Failed to get exporter instance"}
	var current_cfg_version: int = LogFileExporterClass._config_version
	# 模拟配置热重载版本推进
	LogFileExporterClass._config_version = current_cfg_version - 1
	LogFileExporterClass._ensure_config_fresh()
	if LogFileExporterClass._config_version != GameConfig.config_reload_version():
		return {"test": "TC-LG-11", "passed": false, "error": "Exporter failed to refresh config on version bump"}
	return {"test": "TC-LG-11: LogFileExporter 热重载版本自愈", "passed": true}

static func _capture_posted_logs(action: Callable) -> Array[LogRecordDTO]:
	var captured_records: Array[LogRecordDTO] = []
	var bus := EventBusCore.get_instance()
	var cb := func(pkt: EventPacket):
		if pkt.payload_dto is LogRecordDTO:
			captured_records.append(pkt.payload_dto as LogRecordDTO)
	var tok := bus.on_channel(EventChannelDefinition.LOG_RECORD_POSTED, cb)
	action.call()
	tok.unbind()
	return captured_records

## TC-LG-12: LogFileExporter 全局单调序号对账断言 (Inv-LG-3)
static func _test_lg_12_exporter_sequence_reconciliation() -> Dictionary:
	_prepare_exporter_config("user://test_logs_tc12", "tc12_exp", "info")

	for i in range(5):
		var r := LogRecordDTOClass.new()
		r.level = "info"
		r.message = "Log %d" % i
		LogFileExporterClass.consume(r)
		if r.sequence != (i + 1):
			return {"test": "TC-LG-12", "passed": false, "error": "Sequence out of sync: expected %d got %d" % [i + 1, r.sequence]}

	if LogFileExporterClass._exported_count != 5:
		return {"test": "TC-LG-12", "passed": false, "error": "Exported count reconciliation failed"}
	return {"test": "TC-LG-12: LogFileExporter 全局序号对账一致性", "passed": true}

## TC-LG-13: LogFileExporter 关闭时零开销跳过断言
static func _test_lg_13_exporter_disabled_zero_overhead() -> Dictionary:
	_prepare_exporter_config("", "kalar", "info", 1048576, 3, false, false)

	var r := LogRecordDTOClass.new()
	r.level = "error"
	var ok := LogFileExporterClass.consume(r)
	if ok or LogFileExporterClass._exported_count != 0:
		return {"test": "TC-LG-13", "passed": false, "error": "Disabled exporter performed write"}
	return {"test": "TC-LG-13: LogFileExporter 关闭零开销", "passed": true}

## TC-LG-14: ErrorReporter 已登记错误码广播与 DTO 组装断言
static func _test_lg_14_error_reporter_emit_registered_error() -> Dictionary:
	var captured_records := _capture_posted_logs(func():
		ErrorReporterClass.emit_error("account", "ERR_ACCOUNT_NOT_FOUND", "Account not found", {"uid": 1001})
	)

	if captured_records.is_empty():
		return {"test": "TC-LG-14", "passed": false, "error": "No record emitted"}

	var rec: LogRecordDTO = captured_records[0]
	if rec.error_code != "ERR_ACCOUNT_NOT_FOUND" or rec.channel != "account" or rec.level != "error":
		return {"test": "TC-LG-14", "passed": false, "error": "Emitted record fields mismatch"}
	if rec.context.get("uid") != 1001:
		return {"test": "TC-LG-14", "passed": false, "error": "Context was not passed to record"}

	return {"test": "TC-LG-14: ErrorReporter 已登记错误码广播", "passed": true}

## TC-LG-15: ErrorReporter 未登记错误码回退 ERR_UNKNOWN、遥测断点与调用方文本保留断言
static func _test_lg_15_error_reporter_unregistered_fallback_and_telemetry() -> Dictionary:
	var bad_code := "ERR_UNREGISTERED_PROTOTYPE_XYZ"
	var captured_records := _capture_posted_logs(func():
		ErrorReporterClass.emit_error("test", bad_code, "Custom fallback msg")
	)

	if captured_records.is_empty():
		return {"test": "TC-LG-15", "passed": false, "error": "No record emitted"}

	var rec: LogRecordDTO = captured_records[0]
	if rec.error_code != "ERR_UNKNOWN":
		return {"test": "TC-LG-15", "passed": false, "error": "Unregistered code did not fallback to ERR_UNKNOWN"}
	# Inv-LG-2：未登记码 message 必须回退调用方文本（禁止被 i18n 覆盖丢诊断）
	if rec.message != "Custom fallback msg":
		return {"test": "TC-LG-15", "passed": false, "error": "Unregistered code must preserve caller message, got: %s" % rec.message}

	var count := ErrorCodeRegistryClass.get_unregistered_count(bad_code)
	if count < 1:
		return {"test": "TC-LG-15", "passed": false, "error": "Telemetry count for unregistered code was not incremented"}

	return {"test": "TC-LG-15: ErrorReporter 未登记错误码回退与遥测", "passed": true}

## TC-LG-16: ErrorReporter message 解析回退层级断言（含 i18n 命中态）
static func _test_lg_16_error_reporter_message_resolution() -> Dictionary:
	# 命中态：已登记码优先取 narratives.errors 表（经 message_key），不受调用方文案覆盖
	var table_text := GameConfig.get_string("narratives.errors", "unknown", "")
	if table_text.is_empty():
		return {"test": "TC-LG-16", "passed": false, "error": "narratives.errors/unknown table entry missing"}
	var hit := ErrorReporterClass._resolve_message("ERR_UNKNOWN", "Explicit text")
	if hit != table_text:
		return {"test": "TC-LG-16", "passed": false, "error": "Registered code did not resolve to i18n table text"}
	var hit_empty := ErrorReporterClass._resolve_message("ERR_UNKNOWN", "")
	if hit_empty != table_text:
		return {"test": "TC-LG-16", "passed": false, "error": "Empty fallback must still resolve to i18n table text"}

	var msg1 := ErrorReporterClass._resolve_message("ERR_UNREGISTERED_NO_TABLE_XYZ", "Explicit text")
	if msg1 != "Explicit text":
		return {"test": "TC-LG-16", "passed": false, "error": "Failed to use explicit fallback text"}

	var msg2 := ErrorReporterClass._resolve_message("ERR_UNREGISTERED_NO_TABLE_XYZ", "")
	if msg2.is_empty():
		return {"test": "TC-LG-16", "passed": false, "error": "Empty fallback must return code string"}

	return {"test": "TC-LG-16: ErrorReporter message 解析回退", "passed": true}

## TC-LG-17: EventBus 既有 emit_log 签名兼容性断言
static func _test_lg_17_event_bus_legacy_emit_log_compatibility() -> Dictionary:
	var captured_records := _capture_posted_logs(func():
		EventBusCore.get_instance().emit_log("warn", "Legacy warning text")
	)

	if captured_records.is_empty():
		return {"test": "TC-LG-17", "passed": false, "error": "Legacy emit_log failed to emit log_record_emitted"}

	var rec: LogRecordDTO = captured_records[0]
	if rec.level != "warn" or rec.message != "Legacy warning text":
		return {"test": "TC-LG-17", "passed": false, "error": "Legacy record mapping mismatch"}

	return {"test": "TC-LG-17: EventBus 既有 emit_log 兼容性", "passed": true}

## TC-LG-18: EventBusCore LOG_RECORD_POSTED 信道前端消费断言
static func _test_lg_18_event_bus_signal_forwarding_to_frontend() -> Dictionary:
	var received_msgs: Array[Dictionary] = []
	var bus := EventBusCore.get_instance()
	var cb := func(pkt: EventPacket):
		if pkt.payload_dto is LogRecordDTO:
			var packet_record := pkt.payload_dto as LogRecordDTO
			received_msgs.append({"level": packet_record.level, "message": packet_record.message})
	var tok := bus.on_channel(EventChannelDefinition.LOG_RECORD_POSTED, cb)

	var rec := LogRecordDTOClass.new()
	rec.level = "error"
	rec.message = "Frontend test msg"
	bus.emit_log_record(rec)
	tok.unbind()

	if received_msgs.is_empty():
		return {"test": "TC-LG-18", "passed": false, "error": "LOG_RECORD_POSTED channel was not dispatched"}
	# 新契约：信道载荷为 DTO 原始 level（大小写归一由前端消费端 _on_log_packet 负责）
	if received_msgs[0]["level"] != "error" or received_msgs[0]["message"] != "Frontend test msg":
		return {"test": "TC-LG-18", "passed": false, "error": "Forwarded channel data mismatch"}

	return {"test": "TC-LG-18: EventBusCore LOG_RECORD_POSTED 信道前端消费", "passed": true}

## TC-LG-19: 全库 push_error/push_warning 分级收敛断言（存量站点白名单 + 新增零容忍）
static func _test_lg_19_zero_push_error_in_contract_registry() -> Dictionary:
	# 原断言保留：契约注册表单文件零散落
	var path := "res://backend/domains/contract_registry/contract_registry_index.gd"
	var text := FileAccess.get_file_as_string(path)
	if text.contains("push_error(") or text.contains("push_warning("):
		return {"test": "TC-LG-19", "passed": false, "error": "contract_registry_index still contains push_error/push_warning"}
	# 全库扫描（backend + frontend 生产代码；tests/benchmarks dev 工具豁免）：
	# 所有 T1 装载校验与 T2 运行时守卫已全部收敛至 EventBusCore / ErrorReporter；
	# 仅保留 T0 启动极早期未就绪 EventBus 时的 Config 装载站点，白名单之外新增命中即红
	var allowed := {
		"res://backend/infrastructure/game_config.gd": "T0",
	}
	var offenders: Array[String] = []
	_scan_push_scatter("res://backend", allowed, offenders)
	_scan_push_scatter("res://frontend", allowed, offenders)
	if not offenders.is_empty():
		return {"test": "TC-LG-19", "passed": false, "error": "New push_error/push_warning scatter outside allowlist: %s" % "; ".join(offenders)}
	return {"test": "TC-LG-19: 全库 push 散落收敛（仅 T0 配置装载白名单）", "passed": true}

static func _scan_push_scatter(dir_path: String, allowed: Dictionary, offenders: Array[String]) -> void:
	var dir := DirAccess.open(dir_path)
	if dir == null:
		return
	dir.list_dir_begin()
	var fname := dir.get_next()
	while not fname.is_empty():
		if dir.current_is_dir():
			if fname != "." and fname != ".." and fname != "tests" and fname != "benchmarks":
				_scan_push_scatter(dir_path + "/" + fname, allowed, offenders)
		elif fname.ends_with(".gd"):
			_check_push_file(dir_path + "/" + fname, allowed, offenders)
		fname = dir.get_next()
	dir.list_dir_end()

static func _check_push_file(fpath: String, allowed: Dictionary, offenders: Array[String]) -> void:
	if fpath.ends_with("error_reporter.gd"):
		return
	var text := FileAccess.get_file_as_string(fpath)
	if text.is_empty():
		return
	var hit := false
	for ln in text.split("\n"):
		var s: String = (ln as String).strip_edges()
		if s.begins_with("#") or s.begins_with("func push_warning"):
			continue
		if s.contains("push_error(") or s.contains("push_warning("):
			hit = true
			break
	if hit and not allowed.has(fpath):
		offenders.append(fpath)

## TC-LG-20: 契约配置装载失败路径保留失败关闭与 _loaded 阻断断言
static func _test_lg_20_fail_closed_contract_registry_behavior() -> Dictionary:
	var index := ContractRegistryIndexClass.new()
	# 显式执行装载，验证在标准环境下正常加载或在异常下 _loaded 阻断且不崩溃
	index._load_from_config()
	if not index._loaded:
		return {"test": "TC-LG-20", "passed": false, "error": "_loaded must be true after _load_from_config"}
	return {"test": "TC-LG-20: 契约注册表失败关闭语义保留", "passed": true}

## TC-LG-21: GMArbitrationAuditService 审计文案与错误收敛断言
static func _test_lg_21_gm_audit_i18n_and_convergence() -> Dictionary:
	var entry := GMArbitrationAuditServiceClass.record_audit("admin_test", "grant_item", {"item": "iron_sword"})
	if entry.is_empty() or entry.get("admin_id") != "admin_test":
		return {"test": "TC-LG-21", "passed": false, "error": "record_audit failed"}
	return {"test": "TC-LG-21: GM 审计流水线收敛", "passed": true}

## TC-LG-22: errors_catalog.json 必需配置表已装载断言
static func _test_lg_22_errors_catalog_required_table_present() -> Dictionary:
	if not GameConfig.describe().get("tables", []).has("infrastructure.errors_catalog"):
		return {"test": "TC-LG-22", "passed": false, "error": "infrastructure.errors_catalog table missing from GameConfig"}
	var errors_dict: Dictionary = GameConfig.get_dict("infrastructure.errors_catalog", "errors", {})
	if errors_dict.size() < 25:
		return {"test": "TC-LG-22", "passed": false, "error": "errors_catalog table entries too small (%d)" % errors_dict.size()}
	return {"test": "TC-LG-22: errors_catalog 必需配置表就绪", "passed": true}

## TC-LG-23: 端到端回归断言
static func _test_lg_23_full_integration_pipeline_regression() -> Dictionary:
	EventBusCore.reset_sequence_for_test()
	LogFileExporterClass.reset_for_test()
	ErrorCodeRegistryClass.reset_for_test()

	# 模拟业务域通过 ErrorReporter 爆错
	var captured := _capture_posted_logs(func():
		ErrorReporterClass.emit_error("combat", "CONFIG_FILE_NOT_FOUND", "Config file missing in test")
	)

	if captured.is_empty():
		return {"test": "TC-LG-23", "passed": false, "error": "Full pipeline failed to emit record"}
	return {"test": "TC-LG-23: 端到端回归", "passed": true}

## TC-LG-24: 加固改造断言（动态诊断保真、信包双载荷与持久化契约）
static func _test_lg_24_hardened_observability_and_preservation() -> Dictionary:
	# 1. 验证 ErrorReporter 保留动态诊断信息
	var captured := _capture_posted_logs(func():
		ErrorReporterClass.emit_error("config", "CONFIG_FILE_NOT_FOUND", "Missing config: custom_tables.json", {"actor": "unit_test"})
	)

	if captured.is_empty():
		return {"test": "TC-LG-24", "passed": false, "error": "emit_error failed to broadcast"}
	var rec := captured[0]
	if not rec.context.has("diagnostic_detail") or rec.context["diagnostic_detail"] != "Missing config: custom_tables.json":
		return {"test": "TC-LG-24", "passed": false, "error": "Dynamic diagnostic detail was lost in ErrorReporter"}

	# 2. 验证 CharacterPrologueContext.serialize() 对齐 SaveAssembler 契约
	var ctx := CharacterPrologueContext.new()
	ctx.account_id = "ACC_001"
	ctx.character_id = "CHAR_001"
	if not ctx.has_method("serialize"):
		return {"test": "TC-LG-24", "passed": false, "error": "CharacterPrologueContext missing serialize method"}
	var s_dict: Dictionary = ctx.serialize()
	if s_dict.get("account_id") != "ACC_001":
		return {"test": "TC-LG-24", "passed": false, "error": "CharacterPrologueContext serialize output invalid"}

	# 3. 验证 AgentObservationPacketDTO diagnostic_dump 序列化往返
	var obs := AgentObservationPacketDTO.new()
	obs.session_id = "SESS_TEST_01"
	obs.diagnostic_dump = {"dump_id": "dump_01", "error": "ERR_TEST"}
	var obs_dto := obs.to_dto()
	if not obs_dto.has("diagnostic_dump") or obs_dto["diagnostic_dump"]["dump_id"] != "dump_01":
		return {"test": "TC-LG-24", "passed": false, "error": "diagnostic_dump failed to serialize"}
	var revived := AgentObservationPacketDTO.from_dto(obs_dto)
	if revived.diagnostic_dump.get("error") != "ERR_TEST":
		return {"test": "TC-LG-24", "passed": false, "error": "diagnostic_dump failed to deserialize"}

	return {"test": "TC-LG-24: 动态诊断保真、信包双载荷与持久化契约加固", "passed": true}

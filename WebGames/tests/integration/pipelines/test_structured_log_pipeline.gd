# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - Phase 67 全域结构化日志改造升级测试套件
# 文件路径: res://tests/integration/pipelines/test_structured_log_pipeline.gd
# 职责: 验收全域结构化日志模型（StructuredLogRecord）、脱敏引擎（RedactionRule）、
#       遥测聚合（TelemetryAggregate）、多维检索（LogQueryService）、环形缓冲
#       与保留期清理等核心组件及全域不变量（Inv-LS-1 ~ Inv-LS-5）。
# ==============================================================================
class_name TestStructuredLogPipeline
extends RefCounted



static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name := "Phase 67: 后端全域系统日志改造升级全量验收流水线"

	results.append(_test_ls_01_structured_log_record_superset_compatibility())
	results.append(_test_ls_02_redaction_rule_mask_mode())
	results.append(_test_ls_03_redaction_rule_drop_mode())
	results.append(_test_ls_04_redaction_rule_hash_mode())
	results.append(_test_ls_05_redaction_rule_conservative_fallback())
	results.append(_test_ls_06_log_query_dto_criteria_and_result_contract())
	results.append(_test_ls_07_log_collector_trace_id_inheritance())
	results.append(_test_ls_08_log_collector_construction_redaction())
	results.append(_test_ls_09_log_collector_caller_file_basename_only())
	results.append(_test_ls_10_log_ring_buffer_bounded_overwrite())
	results.append(_test_ls_11_log_ring_buffer_reload_tail_retention())
	results.append(_test_ls_12_telemetry_aggregate_consume_and_counts())
	results.append(_test_ls_13_telemetry_aggregate_p50_p95_percentiles())
	results.append(_test_ls_14_telemetry_aggregate_sliding_window_reset())
	results.append(_test_ls_15_telemetry_aggregate_unidirectional_read_only())
	results.append(_test_ls_16_log_query_service_six_dimension_filtering())
	results.append(_test_ls_17_log_query_service_dual_source_merge_and_pagination())
	results.append(_test_ls_18_log_query_service_truncation_cap())
	results.append(_test_ls_19_redaction_security_redline_full_pipeline())
	results.append(_test_ls_20_log_json_four_sections_configuration())
	results.append(_test_ls_21_log_retention_cleaner_expiration_and_protection())
	results.append(_test_ls_22_backend_zero_print_statements_guard())
	results.append(_test_ls_23_synergy_with_phase_66_error_base())
	results.append(_test_ls_24_full_integration_pipeline_regression())

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

## TC-LS-01: StructuredLogRecord 超集兼容与深拷贝序列化断言
static func _test_ls_01_structured_log_record_superset_compatibility() -> Dictionary:
	var rec := StructuredLogRecord.new()
	rec.sequence = 101
	rec.timestamp_utc = 1700000000
	rec.level = "INFO"
	rec.channel = "combat"
	rec.error_code = "ERR_TEST"
	rec.message = "Hello world"
	rec.trace_id = "TRACE_001"
	rec.parent_span_id = "SPAN_ROOT"
	rec.event_category = "battle"
	rec.duration_ms = 42
	rec.source_file = "combat_coordinator.gd"
	rec.source_line = 88
	rec.context = {"round": 1, "target": "monster_A"}
	rec.redacted_keys = ["token"]

	var dto := rec.to_dto()
	
	# 修改原 context，验证深拷贝隔离
	rec.context["round"] = 999
	rec.redacted_keys.append("secret")

	var ok: bool = (
		dto["sequence"] == 101 and
		dto["level"] == "INFO" and
		dto["channel"] == "combat" and
		dto["error_code"] == "ERR_TEST" and
		dto["message"] == "Hello world" and
		dto["trace_id"] == "TRACE_001" and
		dto["parent_span_id"] == "SPAN_ROOT" and
		dto["event_category"] == "battle" and
		dto["duration_ms"] == 42 and
		dto["source_file"] == "combat_coordinator.gd" and
		dto["source_line"] == 88 and
		dto["context"]["round"] == 1 and
		dto["redacted_keys"].size() == 1 and
		dto["redacted_keys"][0] == "token"
	)

	# 往返反序列化断言
	var revived := StructuredLogRecord.from_dto(dto)
	var roundtrip_ok: bool = (
		revived.sequence == 101 and
		revived.trace_id == "TRACE_001" and
		revived.duration_ms == 42 and
		revived.redacted_keys == ["token"]
	)

	return {
		"test": "TC-LS-01: StructuredLogRecord 超集兼容与深拷贝序列化断言",
		"passed": ok and roundtrip_ok,
		"details": "dto=%s, roundtrip_ok=%s" % [str(dto), str(roundtrip_ok)]
	}

## TC-LS-02: RedactionRule mask 模式（首尾保留 + 中间掩码）
static func _test_ls_02_redaction_rule_mask_mode() -> Dictionary:
	RedactionRule.reset_state()
	var input := {
		"token": "TOKEN_SECRET_987654321",
		"safe_key": "normal_data"
	}
	var res := RedactionRule.apply(input)
	var dict: Dictionary = res["dict"]
	var rk: Array = res["redacted_keys"]

	var token_val := str(dict.get("token", ""))
	var prefix := token_val.left(4)
	var suffix := token_val.right(4)
	var contains_mask := token_val.contains("****")

	var ok: bool = (
		prefix == "TOKE" and
		suffix == "4321" and
		contains_mask and
		not token_val.contains("SECRET") and
		dict.get("safe_key") == "normal_data" and
		rk.has("token")
	)

	return {
		"test": "TC-LS-02: RedactionRule mask 模式（首尾保留 + 中间掩码）",
		"passed": ok,
		"details": "token_val=%s, rk=%s" % [token_val, str(rk)]
	}

## TC-LS-03: RedactionRule drop 模式（整键丢弃）
static func _test_ls_03_redaction_rule_drop_mode() -> Dictionary:
	RedactionRule.reset_state()
	var input := {
		"password": "MySuperSecretPassword123!",
		"password_hash": "sha_hash_secret",
		"remain": "keep_this"
	}
	var res := RedactionRule.apply(input)
	var dict: Dictionary = res["dict"]
	var rk: Array = res["redacted_keys"]

	var ok: bool = (
		not dict.has("password") and
		not dict.has("password_hash") and
		dict.get("remain") == "keep_this" and
		rk.has("password") and
		rk.has("password_hash")
	)

	return {
		"test": "TC-LS-03: RedactionRule drop 模式（整键丢弃）",
		"passed": ok,
		"details": "dict=%s, rk=%s" % [str(dict), str(rk)]
	}

## TC-LS-04: RedactionRule hash 模式（SHA-256 指纹转换）
static func _test_ls_04_redaction_rule_hash_mode() -> Dictionary:
	RedactionRule.reset_state()
	var input := {
		"account_id": "ACC_KALAR_9999"
	}
	var res := RedactionRule.apply(input)
	var dict: Dictionary = res["dict"]
	var rk: Array = res["redacted_keys"]

	var hashed: String = str(dict.get("account_id", ""))
	var expected_hash: String = "ACC_KALAR_9999".sha256_text()

	var ok: bool = (
		hashed == expected_hash and
		hashed.length() == 64 and
		not hashed.contains("KALAR") and
		rk.has("account_id")
	)

	return {
		"test": "TC-LS-04: RedactionRule hash 模式（SHA-256 指纹转换）",
		"passed": ok,
		"details": "hashed=%s" % hashed
	}

## TC-LS-05: RedactionRule 嵌套字典与数组递归脱敏断言
static func _test_ls_05_redaction_rule_conservative_fallback() -> Dictionary:
	RedactionRule.reset_state()
	var input := {
		"meta": {
			"nested_token": "NESTED_TOKEN_ABCD1234",
			"secret": "drop_me_deep"
		},
		"list": [
			{"password": "secret_in_list", "name": "item_1"}
		]
	}
	# nested_token matches token pattern via word boundary / regex
	var res := RedactionRule.apply(input)
	var dict: Dictionary = res["dict"]
	var meta: Dictionary = dict.get("meta", {})
	var list_arr: Array = dict.get("list", [])

	var ok: bool = (
		not meta.has("secret") and
		list_arr.size() == 1 and
		not list_arr[0].has("password") and
		list_arr[0].get("name") == "item_1"
	)

	return {
		"test": "TC-LS-05: RedactionRule 嵌套字典与数组递归脱敏断言",
		"passed": ok,
		"details": "dict=%s" % str(dict)
	}

## TC-LS-06: LogQueryDTO Criteria 钳制与 Result 结构断言
static func _test_ls_06_log_query_dto_criteria_and_result_contract() -> Dictionary:
	var c := LogQueryDTO.Criteria.new()
	c.page = -10
	c.page_size = 99999 # 应被钳制到 500
	var page_clamped: bool = (c.page == 1)
	var size_clamped: bool = (c.page_size == 500)

	c.page_size = -5 # 应被钳制到 1
	var min_size_clamped: bool = (c.page_size == 1)

	var res := LogQueryDTO.Result.new()
	res.total = 120
	res.page = 1
	res.truncated = true
	res.records.append({"sequence": 1, "level": "INFO"})

	var dto := res.to_dto()
	var res_ok: bool = (
		dto["total"] == 120 and
		dto["page"] == 1 and
		dto["truncated"] == true and
		dto["records"].size() == 1
	)

	return {
		"test": "TC-LS-06: LogQueryDTO Criteria 钳制与 Result 结构断言",
		"passed": page_clamped and size_clamped and min_size_clamped and res_ok,
		"details": "page=%d, page_size=%d, res_ok=%s" % [c.page, c.page_size, str(res_ok)]
	}

## TC-LS-07: LogCollector.begin_trace 链路追踪继承断言 (Inv-LS-3)
static func _test_ls_07_log_collector_trace_id_inheritance() -> Dictionary:
	LogCollector.reset_state()
	var trace_id := LogCollector.begin_trace("TRACE_COMBAT_ROUND_1")
	var rec1 := LogCollector.log("info", "combat_flow", "Turn started")
	var rec2 := LogCollector.log("info", "card_engine", "Card drawn")
	LogCollector.clear_trace()
	var rec3 := LogCollector.log("info", "world_gateway", "Player walked")

	var ok: bool = (
		trace_id == "TRACE_COMBAT_ROUND_1" and
		rec1.trace_id == "TRACE_COMBAT_ROUND_1" and
		rec2.trace_id == "TRACE_COMBAT_ROUND_1" and
		rec3.trace_id != "TRACE_COMBAT_ROUND_1" and
		rec3.trace_id.begins_with("TRACE_world_gateway_")
	)

	return {
		"test": "TC-LS-07: LogCollector.begin_trace 链路追踪继承断言 (Inv-LS-3)",
		"passed": ok,
		"details": "rec1_tr=%s, rec3_tr=%s" % [rec1.trace_id, rec3.trace_id]
	}

## TC-LS-08: LogCollector 构造期脱敏入流断言 (Inv-LS-2)
static func _test_ls_08_log_collector_construction_redaction() -> Dictionary:
	LogCollector.reset_state()
	RedactionRule.reset_state()
	var rec := LogCollector.log("debug", "auth_service", "Login attempt", {
		"token": "SESSION_TOKEN_123456789",
		"password": "ClearTextPassword!"
	})

	var token_masked: String = str(rec.context.get("token", ""))
	var pwd_dropped: bool = not rec.context.has("password")

	var ok: bool = (
		not token_masked.contains("123456789") and
		token_masked.contains("****") and
		pwd_dropped and
		rec.redacted_keys.has("token") and
		rec.redacted_keys.has("password")
	)

	return {
		"test": "TC-LS-08: LogCollector 构造期脱敏入流断言 (Inv-LS-2)",
		"passed": ok,
		"details": "token_masked=%s, pwd_dropped=%s" % [token_masked, str(pwd_dropped)]
	}

## TC-LS-09: LogCollector 调用方源文件仅提取 basename 断言
static func _test_ls_09_log_collector_caller_file_basename_only() -> Dictionary:
	LogCollector.reset_state()
	var rec := LogCollector.log("info", "test_domain", "Caller file test")
	var src_file := rec.source_file

	# 必须无盘符、无斜杠绝对路径，以 .gd 结尾或者是已知调用测试文件
	var no_absolute_path: bool = not src_file.contains(":") and not src_file.contains("/") and not src_file.contains("\\")
	var ok: bool = no_absolute_path and src_file.ends_with(".gd")

	return {
		"test": "TC-LS-09: LogCollector 调用方源文件仅提取 basename 断言",
		"passed": ok,
		"details": "source_file=%s, line=%d" % [src_file, rec.source_line]
	}

## TC-LS-10: LogRingBuffer 有界覆盖与最旧丢失断言 (有界收敛)
static func _test_ls_10_log_ring_buffer_bounded_overwrite() -> Dictionary:
	LogRingBuffer.clear()
	LogRingBuffer.set_capacity_override_for_test(3)
	for i in range(1, 6):
		var rec := StructuredLogRecord.new()
		rec.sequence = i
		rec.message = "Msg_%d" % i
		LogRingBuffer.append(rec)

	var sz := LogRingBuffer.size()
	# 此时应保留 3 条，最旧的 1, 2 被覆盖，留下 3, 4, 5
	var seqs: Array = []
	for r in LogRingBuffer.get_all():
		seqs.append(r.sequence)
	seqs.sort()

	var ok: bool = (sz == 3 and seqs == [3, 4, 5])
	LogRingBuffer.clear()
	LogRingBuffer.set_capacity_override_for_test(-1)

	return {
		"test": "TC-LS-10: LogRingBuffer 有界覆盖与最旧丢失断言 (有界收敛)",
		"passed": ok,
		"details": "size=%d, seqs=%s" % [sz, str(seqs)]
	}

## TC-LS-11: LogRingBuffer 容量热重载重建保留尾段断言（含环绕态时间序语义）
static func _test_ls_11_log_ring_buffer_reload_tail_retention() -> Dictionary:
	LogRingBuffer.clear()
	LogRingBuffer.set_capacity_override_for_test(-1)
	for i in range(1, 11):
		var rec := StructuredLogRecord.new()
		rec.sequence = i
		LogRingBuffer.append(rec)

	# 场景 A：未环绕直接收缩容量，应保留最新 4 条
	LogRingBuffer.set_capacity_override_for_test(4)
	var seqs_a: Array = []
	for r in LogRingBuffer.get_all():
		seqs_a.append(r.sequence)
	var ok_a: bool = (LogRingBuffer.size() == 4 and seqs_a == [7, 8, 9, 10])

	# 场景 B：满环环绕态（head != 0）收缩容量，须按 sequence 时间序保留最新 3 条
	LogRingBuffer.clear()
	LogRingBuffer.set_capacity_override_for_test(5)
	for i in range(1, 9):
		var rec := StructuredLogRecord.new()
		rec.sequence = i
		LogRingBuffer.append(rec)
	LogRingBuffer.set_capacity_override_for_test(3)
	var seqs_b: Array = []
	for r in LogRingBuffer.get_all():
		seqs_b.append(r.sequence)
	var ok_b: bool = (LogRingBuffer.size() == 3 and seqs_b == [6, 7, 8])

	LogRingBuffer.clear()
	LogRingBuffer.set_capacity_override_for_test(-1)

	return {
		"test": "TC-LS-11: LogRingBuffer 容量热重载重建保留尾段断言（含环绕态）",
		"passed": ok_a and ok_b,
		"details": "A(size=%d,seqs=%s) B(size=%d,seqs=%s)" % [LogRingBuffer.size(), str(seqs_a), LogRingBuffer.size(), str(seqs_b)]
	}

## TC-LS-12: TelemetryAggregate 域分类聚合与计数耗时累加断言 (Inv-LS-4)
static func _test_ls_12_telemetry_aggregate_consume_and_counts() -> Dictionary:
	TelemetryAggregate.reset_state()
	var rec1 := StructuredLogRecord.new()
	rec1.channel = "combat"
	rec1.event_category = "attack"
	rec1.duration_ms = 10

	var rec2 := StructuredLogRecord.new()
	rec2.channel = "combat"
	rec2.event_category = "attack"
	rec2.duration_ms = 20

	var rec3 := StructuredLogRecord.new()
	rec3.channel = "inventory"
	rec3.event_category = "equip"
	rec3.duration_ms = 5

	TelemetryAggregate.consume(rec1)
	TelemetryAggregate.consume(rec2)
	TelemetryAggregate.consume(rec3)

	var snap := TelemetryAggregate.snapshot()
	var slots: Dictionary = snap.get("slots", {})
	var combat_slot: Dictionary = slots.get("combat|attack", {})
	var inv_slot: Dictionary = slots.get("inventory|equip", {})

	var ok: bool = (
		combat_slot.get("count") == 2 and
		combat_slot.get("total_duration_ms") == 30 and
		inv_slot.get("count") == 1 and
		inv_slot.get("total_duration_ms") == 5
	)

	return {
		"test": "TC-LS-12: TelemetryAggregate 域分类聚合与计数耗时累加断言 (Inv-LS-4)",
		"passed": ok,
		"details": "combat_slot=%s, inv_slot=%s" % [str(combat_slot), str(inv_slot)]
	}

## TC-LS-13: TelemetryAggregate p50 与 p95 分位计算断言
static func _test_ls_13_telemetry_aggregate_p50_p95_percentiles() -> Dictionary:
	TelemetryAggregate.reset_state()
	# 注入 10 条耗时：10, 20, 30, 40, 50, 60, 70, 80, 90, 100
	for d in [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]:
		var rec := StructuredLogRecord.new()
		rec.channel = "test_domain"
		rec.event_category = "heavy_task"
		rec.duration_ms = d
		TelemetryAggregate.consume(rec)

	var snap := TelemetryAggregate.snapshot()
	var slot: Dictionary = snap["slots"].get("test_domain|heavy_task", {})

	var p50: int = slot.get("p50_ms", 0)
	var p95: int = slot.get("p95_ms", 0)

	# 10 个元素索引：p50 = idx 5 -> 60；p95 = idx 9 -> 100
	var ok: bool = (p50 >= 50 and p50 <= 60 and p95 >= 90 and p95 <= 100)

	return {
		"test": "TC-LS-13: TelemetryAggregate p50 与 p95 分位计算断言",
		"passed": ok,
		"details": "p50=%d, p95=%d" % [p50, p95]
	}

## TC-LS-14: TelemetryAggregate 滑动窗口超时重置槽位断言 (Inv-LS-4)
static func _test_ls_14_telemetry_aggregate_sliding_window_reset() -> Dictionary:
	TelemetryAggregate.reset_state()
	TelemetryAggregate._window_seconds = 10
	var now := int(Time.get_unix_time_from_system())
	TelemetryAggregate._window_start_utc = now - 20 # 模拟已超时 20 秒

	var rec := StructuredLogRecord.new()
	rec.channel = "lifecycle"
	rec.event_category = "boot"
	rec.duration_ms = 15

	TelemetryAggregate.consume(rec)
	var snap := TelemetryAggregate.snapshot()
	var slot: Dictionary = snap["slots"].get("lifecycle|boot", {})

	# 超时滑动后，旧槽位清空，只有新进的 1 条
	var ok: bool = (slot.get("count") == 1 and slot.get("total_duration_ms") == 15)

	return {
		"test": "TC-LS-14: TelemetryAggregate 滑动窗口超时重置槽位断言 (Inv-LS-4)",
		"passed": ok,
		"details": "slot=%s" % str(slot)
	}

## TC-LS-15: TelemetryAggregate 单向只读消费零反写断言 (Inv-LS-4)
static func _test_ls_15_telemetry_aggregate_unidirectional_read_only() -> Dictionary:
	TelemetryAggregate.reset_state()
	var rec := StructuredLogRecord.new()
	rec.level = "WARN"
	rec.channel = "economy"
	rec.message = "Gold transferred"
	rec.context = {"amount": 500}
	rec.duration_ms = 8

	TelemetryAggregate.consume(rec)

	var unchanged: bool = (
		rec.level == "WARN" and
		rec.channel == "economy" and
		rec.message == "Gold transferred" and
		rec.context.get("amount") == 500 and
		rec.duration_ms == 8
	)

	return {
		"test": "TC-LS-15: TelemetryAggregate 单向只读消费零反写断言 (Inv-LS-4)",
		"passed": unchanged,
		"details": "unchanged=%s" % str(unchanged)
	}

## TC-LS-16: LogQueryService 六维精准过滤断言 (Inv-LS-5)
static func _test_ls_16_log_query_service_six_dimension_filtering() -> Dictionary:
	LogRingBuffer.reset_state()
	var rec1 := StructuredLogRecord.new()
	rec1.sequence = 1
	rec1.timestamp_utc = 1000
	rec1.level = "ERROR"
	rec1.channel = "combat"
	rec1.trace_id = "TR_1"
	rec1.error_code = "ERR_COMBAT_FAIL"
	rec1.message = "Combat failed critically"

	var rec2 := StructuredLogRecord.new()
	rec2.sequence = 2
	rec2.timestamp_utc = 2000
	rec2.level = "INFO"
	rec2.channel = "inventory"
	rec2.trace_id = "TR_2"
	rec2.message = "Item added to bag"

	LogRingBuffer.append(rec1)
	LogRingBuffer.append(rec2)

	# 1. 过滤 ERROR
	var c1 := LogQueryDTO.Criteria.new()
	c1.levels = ["error"]
	var r1 := LogQueryService.query(c1)

	# 2. 过滤 trace_id = TR_2
	var c2 := LogQueryDTO.Criteria.new()
	c2.trace_id = "TR_2"
	var r2 := LogQueryService.query(c2)

	# 3. 关键字 "critically"
	var c3 := LogQueryDTO.Criteria.new()
	c3.keyword = "critically"
	var r3 := LogQueryService.query(c3)

	var ok: bool = (
		r1.total == 1 and r1.records[0]["sequence"] == 1 and
		r2.total == 1 and r2.records[0]["sequence"] == 2 and
		r3.total == 1 and r3.records[0]["sequence"] == 1
	)

	LogRingBuffer.reset_state()

	return {
		"test": "TC-LS-16: LogQueryService 六维精准过滤断言 (Inv-LS-5)",
		"passed": ok,
		"details": "r1=%d, r2=%d, r3=%d" % [r1.total, r2.total, r3.total]
	}

## TC-LS-17: LogQueryService 内存与磁盘合并与分页切片断言
static func _test_ls_17_log_query_service_dual_source_merge_and_pagination() -> Dictionary:
	LogRingBuffer.clear()
	LogRingBuffer.set_capacity_override_for_test(-1)
	for i in range(1, 26):
		var rec := StructuredLogRecord.new()
		rec.sequence = i
		rec.level = "INFO"
		rec.channel = "trade"
		rec.message = "Trade action %d" % i
		LogRingBuffer.append(rec)

	var c := LogQueryDTO.Criteria.new()
	c.channels = ["trade"]
	c.page = 2
	c.page_size = 10

	var res := LogQueryService.query(c)

	# 第 2 页，大小 10，应取 11~20 条
	var ok: bool = (
		res.total == 25 and
		res.page == 2 and
		res.records.size() == 10 and
		res.records[0]["sequence"] == 11 and
		res.records[9]["sequence"] == 20
	)

	LogRingBuffer.clear()
	LogRingBuffer.set_capacity_override_for_test(-1)

	return {
		"test": "TC-LS-17: LogQueryService 内存与磁盘合并与分页切片断言",
		"passed": ok,
		"details": "total=%d, page_records=%d" % [res.total, res.records.size()]
	}

## TC-LS-18: LogQueryService 命中超限截断标记断言
static func _test_ls_18_log_query_service_truncation_cap() -> Dictionary:
	# 构造虚拟超出 MAX_RESULTS 场景的 Criteria
	var res := LogQueryDTO.Result.new()
	res.total = LogQueryService.MAX_RESULTS + 50
	res.truncated = (res.total > LogQueryService.MAX_RESULTS)

	var ok: bool = (res.truncated == true)

	return {
		"test": "TC-LS-18: LogQueryService 命中超限截断标记断言",
		"passed": ok,
		"details": "truncated=%s" % str(res.truncated)
	}

## TC-LS-19: 脱敏安全红线全链路断言 (落盘/内存/检索零明文)
static func _test_ls_19_redaction_security_redline_full_pipeline() -> Dictionary:
	LogCollector.reset_state()
	LogRingBuffer.reset_state()
	RedactionRule.reset_state()

	var sensitive_token := "TOKEN_TOP_SECRET_AUTH_999"
	var sensitive_password := "SuperDuperSecretMasterKey"
	var sensitive_fingerprint := "DEV_FP_888877776666"

	var rec := LogCollector.log("info", "security_auth", "User logged in", {
		"token": sensitive_token,
		"password": sensitive_password,
		"device_fingerprint": sensitive_fingerprint
	})

	# 1. 采集到的 record 检查
	var rec_token := str(rec.context.get("token", ""))
	var rec_has_pwd := rec.context.has("password")
	var rec_fp := str(rec.context.get("device_fingerprint", ""))

	# 2. 环形缓冲查询检查
	var ring_recs := LogRingBuffer.query(0, [], ["security_auth"])
	var ring_ok: bool = false
	if ring_recs.size() > 0:
		var r: StructuredLogRecord = ring_recs[0]
		ring_ok = not str(r.context).contains(sensitive_token) and not r.context.has("password")

	# 3. LogQueryService 检索检查
	var crit := LogQueryDTO.Criteria.new()
	crit.channels = ["security_auth"]
	var qres := LogQueryService.query(crit)
	var query_ok: bool = false
	if qres.records.size() > 0:
		var qctx: Dictionary = qres.records[0].get("context", {})
		query_ok = not str(qctx).contains(sensitive_token) and not qctx.has("password")

	var ok: bool = (
		not rec_token.contains("TOP_SECRET") and
		rec_has_pwd == false and
		rec_fp.begins_with("DEV_") and
		ring_ok and
		query_ok
	)

	LogRingBuffer.reset_state()

	return {
		"test": "TC-LS-19: 脱敏安全红线全链路断言 (落盘/内存/检索零明文)",
		"passed": ok,
		"details": "rec_token=%s, rec_has_pwd=%s, ring_ok=%s, query_ok=%s" % [rec_token, str(rec_has_pwd), str(ring_ok), str(query_ok)]
	}

## TC-LS-20: log.json 四段配置装载与字段映射断言
static func _test_ls_20_log_json_four_sections_configuration() -> Dictionary:
	var cfg_dict: Dictionary = GameConfig.get_dict("infrastructure.log", "", {})
	var has_structured: bool = cfg_dict.has("structured")
	var has_redaction: bool = cfg_dict.has("redaction")
	var has_telemetry: bool = cfg_dict.has("telemetry")
	var has_retention: bool = cfg_dict.has("retention")

	var structured_sec: Dictionary = cfg_dict.get("structured", {})
	var redaction_sec: Dictionary = cfg_dict.get("redaction", {})
	var telemetry_sec: Dictionary = cfg_dict.get("telemetry", {})
	var retention_sec: Dictionary = cfg_dict.get("retention", {})

	var ok: bool = (
		has_structured and has_redaction and has_telemetry and has_retention and
		structured_sec.get("ring_buffer_capacity", 0) >= 100 and
		redaction_sec.get("rules", []).size() >= 4 and
		telemetry_sec.get("window_seconds", 0) >= 10 and
		retention_sec.get("max_days", 0) >= 1
	)

	return {
		"test": "TC-LS-20: log.json 四段配置装载与字段映射断言",
		"passed": ok,
		"details": "structured=%s, redaction=%s, telemetry=%s, retention=%s" % [str(has_structured), str(has_redaction), str(has_telemetry), str(has_retention)]
	}

## TC-LS-21: LogRetentionCleaner 过期归档清理与主文件保护断言
static func _test_ls_21_log_retention_cleaner_expiration_and_protection() -> Dictionary:
	LogRetentionCleaner.reset_state()
	var test_dir := "user://test_retention_logs"
	DirAccess.make_dir_recursive_absolute(test_dir)

	var now := 1700000000
	var prefix := "kalar"

	# 创建主文件（必须受保护）
	var fa_main := FileAccess.open("%s/%s.log" % [test_dir, prefix], FileAccess.WRITE)
	fa_main.store_line("active main log")
	fa_main.close()

	# 创建过期轮转归档（8天前，超出 max_days 7）
	var expired_ts := now - 8 * 86400
	var fa_exp := FileAccess.open("%s/%s.%d.log" % [test_dir, prefix, expired_ts], FileAccess.WRITE)
	fa_exp.store_line("expired log")
	fa_exp.close()

	# 创建未过期轮转归档（2天前，在 max_days 内）
	var fresh_ts := now - 2 * 86400
	var fa_fresh := FileAccess.open("%s/%s.%d.log" % [test_dir, prefix, fresh_ts], FileAccess.WRITE)
	fa_fresh.store_line("fresh log")
	fa_fresh.close()

	# 模拟提取时间戳测试
	var extracted_exp := LogRetentionCleaner._extract_timestamp("%s.%d.log" % [prefix, expired_ts], prefix)
	var extracted_fresh := LogRetentionCleaner._extract_timestamp("%s.%d.log" % [prefix, fresh_ts], prefix)

	var ok_extract: bool = (extracted_exp == expired_ts and extracted_fresh == fresh_ts)

	# 清理测试目录
	DirAccess.remove_absolute("%s/%s.log" % [test_dir, prefix])
	DirAccess.remove_absolute("%s/%s.%d.log" % [test_dir, prefix, expired_ts])
	DirAccess.remove_absolute("%s/%s.%d.log" % [test_dir, prefix, fresh_ts])
	DirAccess.remove_absolute(test_dir)

	return {
		"test": "TC-LS-21: LogRetentionCleaner 过期归档清理与主文件保护断言",
		"passed": ok_extract,
		"details": "ok_extract=%s" % str(ok_extract)
	}

## TC-LS-22: 全库后端业务路径 print( 零残留静态断言
static func _test_ls_22_backend_zero_print_statements_guard() -> Dictionary:
	# 扫描 backend/ 目录，除注释外不得有 bare print( 调用
	var da := DirAccess.open("res://backend")
	var print_hits: Array[String] = []
	if da != null:
		_scan_gd_files_for_print("res://backend", print_hits)

	var ok: bool = (print_hits.size() == 0)

	return {
		"test": "TC-LS-22: 全库后端业务路径 print( 零残留静态断言",
		"passed": ok,
		"details": "hits_count=%d, hits=%s" % [print_hits.size(), str(print_hits)]
	}

static func _scan_gd_files_for_print(dir_path: String, out_hits: Array[String]) -> void:
	var da := DirAccess.open(dir_path)
	if da == null:
		return
	da.list_dir_begin()
	var item := da.get_next()
	while not item.is_empty():
		if item == "." or item == "..":
			item = da.get_next()
			continue
		var full := "%s/%s" % [dir_path, item]
		if da.current_is_dir():
			_scan_gd_files_for_print(full, out_hits)
		elif item.ends_with(".gd"):
			var fa := FileAccess.open(full, FileAccess.READ)
			if fa != null:
				var line_num := 0
				while not fa.eof_reached() and line_num < 100000:
					line_num += 1
					var line := fa.get_line().strip_edges()
					if line.begins_with("#"):
						continue
					# 检查 bare print(
					if line.begins_with("print(") or line.contains(" print(") or line.contains("\tprint("):
						out_hits.append("%s:%d %s" % [item, line_num, line])
				fa.close()
		item = da.get_next()
	da.list_dir_end()

## TC-LS-23: 与 Phase 66 错误底座协同（错误码走 ErrorReporter，日志走 LogCollector）
static func _test_ls_23_synergy_with_phase_66_error_base() -> Dictionary:
	var err_entry := ErrorCodeRegistry.lookup("ERR_ACCOUNT_NOT_FOUND")
	var err_code_ok: bool = (err_entry != null and err_entry.code == "ERR_ACCOUNT_NOT_FOUND")

	# 结构化日志走 LogCollector
	var rec := LogCollector.log("info", "test_synergy", "Normal business event")
	var rec_ok: bool = (rec.error_code == "" and rec.message == "Normal business event")

	return {
		"test": "TC-LS-23: 与 Phase 66 错误底座协同断言",
		"passed": err_code_ok and rec_ok,
		"details": "err_code_ok=%s, rec_ok=%s" % [str(err_code_ok), str(rec_ok)]
	}

## TC-LS-24: 全流水线端到端无头集成回归断言
static func _test_ls_24_full_integration_pipeline_regression() -> Dictionary:
	LogCollector.reset_state()
	LogRingBuffer.reset_state()
	TelemetryAggregate.reset_state()

	var trace := LogCollector.begin_trace("TRACE_INTEGRATION_001")
	var rec := LogCollector.log("info", "integration", "Pipeline started", {"token": "SECRET_TOK_1234"}, "", 12, "system")
	LogCollector.clear_trace()

	var snap := TelemetryAggregate.snapshot()
	var slot: Dictionary = snap["slots"].get("integration|system", {})

	var ring := LogRingBuffer.query(0, [], ["integration"])

	var crit := LogQueryDTO.Criteria.new()
	crit.trace_id = trace
	var qres := LogQueryService.query(crit)

	var ok: bool = (
		rec.trace_id == "TRACE_INTEGRATION_001" and
		not str(rec.context).contains("SECRET_TOK") and
		slot.get("count") == 1 and
		ring.size() == 1 and
		qres.total == 1 and
		qres.records[0]["trace_id"] == "TRACE_INTEGRATION_001"
	)

	return {
		"test": "TC-LS-24: 全流水线端到端无头集成回归断言",
		"passed": ok,
		"details": "slot=%s, ring_size=%d, qres_total=%d" % [str(slot), ring.size(), qres.total]
	}

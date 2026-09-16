# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - Vol 42 旁路遥测与账户生命周期单元测试
# 文件路径: res://tests/unit/domains/test_telemetry_account_lifecycle.gd
# ==============================================================================
class_name TestTelemetryAccountLifecycleDomain
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "Domain 42: 旁路遥测数据总线与账户留存统计系统"

	results.append(_test_ring_buffer_ingestion_and_overflow())
	results.append(_test_batch_flush_operations())
	results.append(_test_account_lifecycle_funnel_transitions())

	var passed_cnt := 0
	for r in results:
		if r.get("passed", false):
			passed_cnt += 1

	return {
		"domain": domain_name,
		"passed_count": passed_cnt,
		"total_count": results.size(),
		"all_passed": (passed_cnt == results.size()),
		"results": results
	}

static func _test_ring_buffer_ingestion_and_overflow() -> Dictionary:
	var engine := TelemetrySidecarEngine.new()
	engine.max_buffer_capacity = 5 # 设置较小缓冲区以便测试溢出

	# 写入 7 条事件
	for i in range(7):
		engine.record_event("HEARTBEAT", "ACC_001", { "seq": i }, 1000 + i)

	# 缓冲区应保持在容量上限 5，最旧的前 2 条被剔除
	var count_ok = (engine.get_buffer_count() == 5)
	var batch = engine.flush_events_batch()
	var first_seq = batch[0].payload_attributes.get("seq", -1) # 应当是 2

	var passed = count_ok and (first_seq == 2) and (batch.size() == 5)
	return {
		"test": "TC-TELEMETRY-01: 旁路环形缓冲区异步写入与溢出淘汰保护",
		"passed": passed
	}

static func _test_batch_flush_operations() -> Dictionary:
	var engine := TelemetrySidecarEngine.new()
	engine.record_event("CLICK_BUTTON", "ACC_002", {}, 1000)
	engine.record_event("OPEN_BAG", "ACC_002", {}, 1001)

	var batch = engine.flush_events_batch()
	var count_after = engine.get_buffer_count()

	var passed = (batch.size() == 2) and (count_after == 0)
	return {
		"test": "TC-TELEMETRY-02: 遥测数据批次提取与缓冲区安全重置",
		"passed": passed
	}

static func _test_account_lifecycle_funnel_transitions() -> Dictionary:
	var engine := TelemetrySidecarEngine.new()

	var e1 = AccountLifecyclePipeline.track_stage_transition(engine, "ACC_HERO", AccountLifecyclePipeline.LifecycleStage.REGISTER_SUCCESS, 1000)
	var e2 = AccountLifecyclePipeline.track_stage_transition(engine, "ACC_HERO", AccountLifecyclePipeline.LifecycleStage.ENTER_WORLD, 1005)
	var e3 = AccountLifecyclePipeline.track_stage_transition(engine, "ACC_HERO", AccountLifecyclePipeline.LifecycleStage.LOGOUT_NORMAL, 1060, 55.0)

	var passed = (e1.event_name == "ACCOUNT_REGISTER_SUCCESS") and \
				 (e2.event_name == "ENTER_WORLD") and \
				 (e3.event_name == "LOGOUT_NORMAL") and \
				 (e3.session_duration_seconds == 55.0)

	return {
		"test": "TC-TELEMETRY-03: 账户全生命周期阶段漏斗状态流转追踪",
		"passed": passed
	}

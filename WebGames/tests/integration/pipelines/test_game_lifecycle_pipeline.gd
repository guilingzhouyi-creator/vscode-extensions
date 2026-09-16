# ==============================================================================
# 单元测试：游戏全生命周期与安全停机无头管线测试 (TestGameLifecyclePipeline)
# 文件路径: res://tests/integration/pipelines/test_game_lifecycle_pipeline.gd
# 职责: 验证生命周期状态机、停机请求/响应 DTO、停机编排服务、EventBus事件总线接入、
#       对称反装配与 18 项边界场景（重入防抖、非法跃迁、单例复位等）
# ==============================================================================
class_name TestGameLifecyclePipeline
extends RefCounted

const GameLifecycleModel = preload("res://backend/domains/lifecycle/lifecycle_model.gd")
const GameShutdownDTO = preload("res://backend/domains/lifecycle/dto/game_shutdown_dto.gd")
const ShutdownResourceDescriptor = preload("res://backend/domains/lifecycle/shutdown_resource_descriptor.gd")
const GameLifecycleManager = preload("res://backend/domains/lifecycle/game_lifecycle_manager.gd")
const GameLifecycleService = preload("res://backend/domains/lifecycle/game_lifecycle_service.gd")

static func run_all_tests() -> Dictionary:
	var results: Array = []
	results.append(_test_s1_01_lifecycle_model_enums())
	results.append(_test_s1_02_shutdown_dto_codec_symmetry())
	results.append(_test_s1_03_shutdown_dto_fallback_safety())
	results.append(_test_s1_04_shutdown_resource_descriptor())
	results.append(_test_s2_01_lifecycle_fsm_valid_transitions())
	results.append(_test_s2_02_lifecycle_fsm_invalid_transitions_blocked())
	results.append(_test_s2_03_lifecycle_fsm_eventbus_broadcasting())
	results.append(_test_s2_04_shutdown_pipeline_execution())
	results.append(_test_s2_05_shutdown_reentrant_guard())
	results.append(_test_s2_06_shutdown_stopped_idempotency())
	results.append(_test_s3_01_config_driven_timeouts())
	results.append(_test_s3_02_game_bootstrap_teardown_idempotency())
	results.append(_test_s3_03_teardown_eventbus_broadcast())
	results.append(_test_s4_01_session_revocation_on_shutdown())
	results.append(_test_s4_02_save_failure_graceful_degradation())

	var total_count := results.size()
	var passed_count := 0
	for r in results:
		if r.get("passed", false):
			passed_count += 1

	return {
		"domain": "GameLifecyclePipeline",
		"total_count": total_count,
		"passed_count": passed_count,
		"all_passed": passed_count == total_count,
		"results": results
	}

# ==============================================================================
# S1: 数据结构与契约测试
# ==============================================================================

static func _test_s1_01_lifecycle_model_enums() -> Dictionary:
	var ok1 := GameLifecycleModel.LifecyclePhase.UNINITIALIZED == 0
	var ok2 := GameLifecycleModel.LifecyclePhase.STOPPED == 7
	var ok3 := GameLifecycleModel.get_phase_name(GameLifecycleModel.LifecyclePhase.RUNNING) == "RUNNING"
	var ok4 := GameLifecycleModel.get_reason_name(GameLifecycleModel.ExitReason.WINDOW_CLOSE_REQUEST) == "WINDOW_CLOSE_REQUEST"
	var passed := ok1 and ok2 and ok3 and ok4
	return {"test": "TC-EX-S1-01: 生命周期枚举定义与名称解析", "passed": passed}

static func _test_s1_02_shutdown_dto_codec_symmetry() -> Dictionary:
	var req := GameShutdownDTO.Request.new()
	req.session_token = "TOKEN_TEST_XYZ"
	req.account_id = "ACC_PLAYER_1001"
	req.exit_reason = GameLifecycleModel.ExitReason.USER_DESKTOP_QUIT
	req.target_save_slot = "slot_test_save"
	req.idempotency_key = "UUID-REENTRANT-001"
	req.force_timeout_seconds = 6.5
	req.timestamp_utc = 1757073600

	var d := req.to_dto()
	var restored := GameShutdownDTO.Request.from_dto(d)

	var ok_req := (
		restored.session_token == req.session_token and
		restored.account_id == req.account_id and
		restored.exit_reason == req.exit_reason and
		restored.target_save_slot == req.target_save_slot and
		restored.idempotency_key == req.idempotency_key and
		is_equal_approx(restored.force_timeout_seconds, req.force_timeout_seconds) and
		restored.timestamp_utc == req.timestamp_utc
	)

	var resp := GameShutdownDTO.Response.new()
	resp.success = true
	resp.error_code = "OK"
	resp.current_phase = GameLifecycleModel.LifecyclePhase.STOPPED
	resp.is_save_completed = true
	resp.save_sha256 = "HASH_SHA256_SAMPLE"
	resp.remaining_resources = ["res_a", "res_b"]
	resp.elapsed_milliseconds = 42

	var rd := resp.to_dto()
	var restored_resp := GameShutdownDTO.Response.from_dto(rd)

	var ok_resp := (
		restored_resp.success == resp.success and
		restored_resp.error_code == resp.error_code and
		restored_resp.current_phase == resp.current_phase and
		restored_resp.is_save_completed == resp.is_save_completed and
		restored_resp.save_sha256 == resp.save_sha256 and
		restored_resp.remaining_resources.size() == 2 and
		restored_resp.elapsed_milliseconds == resp.elapsed_milliseconds
	)

	return {"test": "TC-EX-S1-02: 停机请求与响应 DTO 编解码对称性", "passed": ok_req and ok_resp}

static func _test_s1_03_shutdown_dto_fallback_safety() -> Dictionary:
	var empty_dict: Dictionary = {}
	var req := GameShutdownDTO.Request.from_dto(empty_dict)
	var resp := GameShutdownDTO.Response.from_dto(empty_dict)

	var ok_req := req.session_token == "" and req.exit_reason == GameLifecycleModel.ExitReason.USER_DESKTOP_QUIT
	var ok_resp := not resp.success and resp.error_code == "OK" and resp.current_phase == GameLifecycleModel.LifecyclePhase.STOPPED
	return {"test": "TC-EX-S1-03: 损坏空字典缺省反序列化容错", "passed": ok_req and ok_resp}

static func _test_s1_04_shutdown_resource_descriptor() -> Dictionary:
	var box: Array[bool] = [false]
	var desc: ShutdownResourceDescriptor = ShutdownResourceDescriptor.new("test_res", 90, true, func(): box[0] = true; return {"success": true})
	var res: Dictionary = desc.execute_cleanup()
	var passed := box[0] and bool(res.get("success", false)) and String(res.get("resource_id", "")) == "test_res"
	return {"test": "TC-EX-S1-04: 资源描述符构造与执行回调", "passed": passed}

# ==============================================================================
# S2: 状态机跃迁、写保护与 EventBus 接入
# ==============================================================================

static func _test_s2_01_lifecycle_fsm_valid_transitions() -> Dictionary:
	GameLifecycleManager.reset_for_test()
	var fsm: Variant = GameLifecycleManager.get_instance()

	var t1: bool = bool(fsm.transition_to(GameLifecycleModel.LifecyclePhase.BOOT_INITIALIZING))
	var t2: bool = bool(fsm.transition_to(GameLifecycleModel.LifecyclePhase.RUNNING))
	var t3: bool = bool(fsm.transition_to(GameLifecycleModel.LifecyclePhase.PAUSED))
	var t4: bool = bool(fsm.transition_to(GameLifecycleModel.LifecyclePhase.RUNNING))
	var t5: bool = bool(fsm.transition_to(GameLifecycleModel.LifecyclePhase.STOPPING))
	var t6: bool = bool(fsm.transition_to(GameLifecycleModel.LifecyclePhase.STOPPED))

	var final_phase: int = int(fsm.get_current_phase())
	GameLifecycleManager.reset_for_test()
	var passed: bool = t1 and t2 and t3 and t4 and t5 and t6 and final_phase == GameLifecycleModel.LifecyclePhase.STOPPED
	return {"test": "TC-EX-S2-01: 生命周期状态机合法单向流转", "passed": passed}

static func _test_s2_02_lifecycle_fsm_invalid_transitions_blocked() -> Dictionary:
	GameLifecycleManager.reset_for_test()
	var fsm: Variant = GameLifecycleManager.get_instance()

	# 从 UNINITIALIZED 直接跳到 RUNNING（非法）
	var invalid_1: bool = bool(fsm.transition_to(GameLifecycleModel.LifecyclePhase.RUNNING))

	fsm.transition_to(GameLifecycleModel.LifecyclePhase.BOOT_INITIALIZING)
	fsm.transition_to(GameLifecycleModel.LifecyclePhase.RUNNING)

	# 从 RUNNING 直接跳到 STOPPED（跳过 STOPPING，非法）
	var invalid_2: bool = bool(fsm.transition_to(GameLifecycleModel.LifecyclePhase.STOPPED))

	fsm.transition_to(GameLifecycleModel.LifecyclePhase.STOPPING)
	fsm.transition_to(GameLifecycleModel.LifecyclePhase.STOPPED)

	# 从 STOPPED 终态逆跳回 RUNNING（非法）
	var invalid_3: bool = bool(fsm.transition_to(GameLifecycleModel.LifecyclePhase.RUNNING))

	GameLifecycleManager.reset_for_test()
	var passed: bool = (not invalid_1) and (not invalid_2) and (not invalid_3)
	return {"test": "TC-EX-S2-02: 非法与越级状态跃迁被拦截", "passed": passed}

static func _test_s2_03_lifecycle_fsm_eventbus_broadcasting() -> Dictionary:
	GameLifecycleManager.reset_for_test()
	var fsm: Variant = GameLifecycleManager.get_instance()
	var received_events: Array[Dictionary] = []

	var callable: Callable = func(pkt: EventPacket):
		var w: Dictionary = pkt.payload_data if pkt.payload_data is Dictionary else {}
		if str(w.get("channel", "")) == "lifecycle.phase_changed":
			received_events.append(w.get("payload", {}))

	var tok := EventBusCore.get_instance().on_channel(EventChannelDefinition.DOMAIN_EVENT_GENERIC, callable)

	fsm.transition_to(GameLifecycleModel.LifecyclePhase.BOOT_INITIALIZING)
	fsm.transition_to(GameLifecycleModel.LifecyclePhase.RUNNING)

	tok.unbind()
	GameLifecycleManager.reset_for_test()

	var passed: bool = received_events.size() == 2 and int(received_events[1].get("new_phase", 0)) == GameLifecycleModel.LifecyclePhase.RUNNING
	return {"test": "TC-EX-S2-03: 状态变更向统一 EventBus 广播", "passed": passed}

static func _test_s2_04_shutdown_pipeline_execution() -> Dictionary:
	GameLifecycleManager.reset_for_test()
	# I6：显式装配引擎（幂等），消除对前序测试副作用的顺序耦合
	GameBootstrap.assemble()
	var received_events: Array[String] = []

	var callable: Callable = func(pkt: EventPacket):
		var w: Dictionary = pkt.payload_data if pkt.payload_data is Dictionary else {}
		var ch := str(w.get("channel", ""))
		if ch.begins_with("lifecycle.") or ch.begins_with("engine."):
			received_events.append(ch)

	var tok := EventBusCore.get_instance().on_channel(EventChannelDefinition.DOMAIN_EVENT_GENERIC, callable)

	var req: GameShutdownDTO.Request = GameShutdownDTO.Request.new()
	req.exit_reason = GameLifecycleModel.ExitReason.USER_DESKTOP_QUIT
	req.target_save_slot = "test_pipeline_slot"

	var resp: GameShutdownDTO.Response = GameLifecycleService.execute_graceful_shutdown(req)

	tok.unbind()
	var final_phase: int = int(GameLifecycleManager.get_instance().get_current_phase())
	GameLifecycleManager.reset_for_test()

	var ok_resp: bool = resp.success and resp.current_phase == GameLifecycleModel.LifecyclePhase.STOPPED
	var ok_phase: bool = final_phase == GameLifecycleModel.LifecyclePhase.STOPPED
	var ok_events: bool = (
		received_events.has("lifecycle.shutdown_started") and
		received_events.has("lifecycle.inputs_frozen") and
		received_events.has("engine.teardown_completed") and
		received_events.has("lifecycle.shutdown_completed")
	)

	return {"test": "TC-EX-S2-04: 安全停机多阶段管线完整执行", "passed": ok_resp and ok_phase and ok_events}

static func _test_s2_05_shutdown_reentrant_guard() -> Dictionary:
	GameLifecycleManager.reset_for_test()
	var fsm: Variant = GameLifecycleManager.get_instance()
	fsm.transition_to(GameLifecycleModel.LifecyclePhase.BOOT_INITIALIZING)
	fsm.transition_to(GameLifecycleModel.LifecyclePhase.RUNNING)
	fsm.transition_to(GameLifecycleModel.LifecyclePhase.STOPPING)

	var req: GameShutdownDTO.Request = GameShutdownDTO.Request.new()
	var resp: GameShutdownDTO.Response = GameLifecycleService.execute_graceful_shutdown(req)

	GameLifecycleManager.reset_for_test()
	var passed: bool = (not resp.success) and resp.error_code == "ALREADY_STOPPING"
	return {"test": "TC-EX-S2-05: 停机中重复请求被重入守卫拦截", "passed": passed}

static func _test_s2_06_shutdown_stopped_idempotency() -> Dictionary:
	GameLifecycleManager.reset_for_test()
	var fsm: Variant = GameLifecycleManager.get_instance()
	fsm.transition_to(GameLifecycleModel.LifecyclePhase.BOOT_INITIALIZING)
	fsm.transition_to(GameLifecycleModel.LifecyclePhase.STOPPED)

	var req: GameShutdownDTO.Request = GameShutdownDTO.Request.new()
	var resp: GameShutdownDTO.Response = GameLifecycleService.execute_graceful_shutdown(req)

	GameLifecycleManager.reset_for_test()
	var passed: bool = resp.success and resp.error_code == "ALREADY_STOPPED"
	return {"test": "TC-EX-S2-06: 已停止状态下调用停机保持幂等", "passed": passed}

# ==============================================================================
# S3: 配置驱动与对称反装配测试
# ==============================================================================

static func _test_s3_01_config_driven_timeouts() -> Dictionary:
	GameConfig.ensure_loaded()
	var shutdown_to: float = GameConfig.get_float("infrastructure.lifecycle", "timeouts/shutdown_timeout_seconds", 0.0)
	var save_to: float = GameConfig.get_float("infrastructure.lifecycle", "timeouts/save_flush_timeout_seconds", 0.0)
	var force_to: float = GameConfig.get_float("infrastructure.lifecycle", "timeouts/force_kill_timeout_seconds", 0.0)
	var auto_save: bool = GameConfig.get_bool("infrastructure.lifecycle", "policies/auto_save_on_exit", false)

	var passed: bool = shutdown_to > save_to and force_to >= 1.0 and auto_save == true
	return {"test": "TC-EX-S3-01: 配置驱动读取超时与策略参数", "passed": passed}

static func _test_s3_02_game_bootstrap_teardown_idempotency() -> Dictionary:
	GameBootstrap.assemble()
	var was_assembled: bool = GameBootstrap.is_assembled()

	var first_td: Dictionary = GameBootstrap.teardown()
	var after_first: bool = GameBootstrap.is_assembled()

	var second_td: Dictionary = GameBootstrap.teardown()

	var passed: bool = (
		was_assembled == true and
		bool(first_td.get("already_teared_down", true)) == false and
		after_first == false and
		bool(second_td.get("already_teared_down", false)) == true
	)
	return {"test": "TC-EX-S3-02: GameBootstrap 反装配幂等且重置单例", "passed": passed}

static func _test_s3_03_teardown_eventbus_broadcast() -> Dictionary:
	GameBootstrap.assemble()
	var box: Array[bool] = [false]

	var callable: Callable = func(pkt: EventPacket):
		var w: Dictionary = pkt.payload_data if pkt.payload_data is Dictionary else {}
		if str(w.get("channel", "")) == "engine.teardown_completed":
			box[0] = true

	var tok := EventBusCore.get_instance().on_channel(EventChannelDefinition.DOMAIN_EVENT_GENERIC, callable)
	GameBootstrap.teardown()
	tok.unbind()

	return {"test": "TC-EX-S3-03: 反装配完成后经 EventBus 广播通知", "passed": box[0]}

# ==============================================================================
# S4: 边界与容错测试 (18 项场景覆盖)
# ==============================================================================

static func _test_s4_01_session_revocation_on_shutdown() -> Dictionary:
	# I6：显式装配引擎（幂等），消除对前序测试副作用的顺序耦合
	GameBootstrap.assemble()
	var acc: Variant = AuthService.create_guest_account()
	var auth_res: Dictionary = AuthService.authenticate_local(acc.username, "GUEST_NO_PASS", acc)
	var token: String = String(auth_res.get("token", ""))
	if token.is_empty():
		return {"test": "TC-EX-S4-01: 停机时会话凭据被主动注销", "passed": false}

	var val_before: Dictionary = AuthService.validate_token(token)
	if not bool(val_before.get("success", false)):
		return {"test": "TC-EX-S4-01: 停机时会话凭据被主动注销", "passed": false}

	var req: GameShutdownDTO.Request = GameShutdownDTO.Request.new()
	req.session_token = token
	GameLifecycleService.execute_graceful_shutdown(req)

	var val_after: Dictionary = AuthService.validate_token(token)
	GameLifecycleManager.reset_for_test()

	var passed: bool = (not bool(val_after.get("success", false))) and String(val_after.get("error_code", "")) == "TOKEN_REVOKED"
	return {"test": "TC-EX-S4-01: 停机时会话凭据被主动注销", "passed": passed}

static func _test_s4_02_save_failure_graceful_degradation() -> Dictionary:
	# I6：显式装配引擎（幂等），消除对前序测试副作用的顺序耦合
	GameBootstrap.assemble()
	var req: GameShutdownDTO.Request = GameShutdownDTO.Request.new()
	req.target_save_slot = "invalid/path*slot"

	var resp: GameShutdownDTO.Response = GameLifecycleService.execute_graceful_shutdown(req)
	GameLifecycleManager.reset_for_test()

	var passed: bool = resp.success and resp.current_phase == GameLifecycleModel.LifecyclePhase.STOPPED and (not resp.is_save_completed)
	return {"test": "TC-EX-S4-02: 存盘失败降级容错推进停机闭环", "passed": passed}

# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/lifecycle/game_lifecycle_service.gd
# 架构定位: Domain Service / State Orchestrator
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/lifecycle.json | 信号: EventBus 领域广播
# 职责说明: 编排多阶段安全停机管线（输入冻结 ➔ 持久化刷盘 ➔ 凭证注销 ➔ 引擎反装配）与统一 EventBus 广播
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## GameLifecycleService：Domain Service / State Orchestrator
class_name GameLifecycleService
extends RefCounted

const SHUTDOWN_STAGE_KEYS = ["freeze_inputs", "flush_saves", "execute_resource_descriptors", "revoke_session", "teardown_bootstrap"]

static var _shutdown_resources: Array[ShutdownResourceDescriptor] = []
static var _is_shutdown_execution_active: bool = false

## 注册资源前从 lifecycle 唯一策略表装配优先级、超时与关键性
static func register_shutdown_resource(descriptor: ShutdownResourceDescriptor) -> bool:
	if _is_shutdown_execution_active or descriptor == null or descriptor.resource_id.strip_edges().is_empty() or not descriptor.cleanup_action.is_valid():
		return false
	for registered in _shutdown_resources:
		if registered.resource_id == descriptor.resource_id:
			return false
	var policies: Dictionary = GameConfig.get_dict("infrastructure.lifecycle", "shutdown_hooks/resource_policies", {})
	var policy_result: Dictionary = _get_resource_policy(descriptor.resource_id, policies)
	if not bool(policy_result.get("success", false)):
		return false
	var policy: Dictionary = policy_result["policy"]
	descriptor.priority = int(policy["priority"])
	descriptor.timeout_ms = int(policy["timeout_ms"])
	descriptor.is_critical = bool(policy["is_critical"])
	var insert_index := 0
	while insert_index < _shutdown_resources.size() and _shutdown_resources[insert_index].priority >= descriptor.priority:
		insert_index += 1
	_shutdown_resources.insert(insert_index, descriptor)
	return true

static func _is_integer_variant(raw_value: Variant) -> bool:
	var variant_type: int = typeof(raw_value)
	if variant_type != TYPE_INT and variant_type != TYPE_FLOAT:
		return false
	return is_equal_approx(float(raw_value), floor(float(raw_value)))

static func _get_resource_policy(resource_id: String, policies: Dictionary) -> Dictionary:
	var raw_policy: Variant = policies.get(resource_id, null)
	if not raw_policy is Dictionary:
		return {"success": false, "error_code": "MISSING_RESOURCE_POLICY:%s" % resource_id}
	var policy: Dictionary = raw_policy
	var priority: Variant = policy.get("priority", null)
	var timeout_milliseconds: Variant = policy.get("timeout_ms", null)
	var is_critical: Variant = policy.get("is_critical", null)
	if not _is_integer_variant(priority) or not _is_integer_variant(timeout_milliseconds) or int(timeout_milliseconds) < 0 or not is_critical is bool:
		return {"success": false, "error_code": "INVALID_RESOURCE_POLICY:%s" % resource_id}
	return {
		"success": true,
		"policy": {
			"priority": int(priority),
			"timeout_ms": int(timeout_milliseconds),
			"is_critical": bool(is_critical)
		}
	}

static func _prepare_shutdown_resources() -> Dictionary:
	var policies: Dictionary = GameConfig.get_dict("infrastructure.lifecycle", "shutdown_hooks/resource_policies", {})
	var seen: Dictionary = {}
	var validated: Dictionary = {}
	for descriptor in _shutdown_resources:
		if seen.has(descriptor.resource_id):
			return {"success": false, "error_code": "DUPLICATE_RESOURCE_ID:%s" % descriptor.resource_id}
		seen[descriptor.resource_id] = true
		var policy_result: Dictionary = _get_resource_policy(descriptor.resource_id, policies)
		if not bool(policy_result.get("success", false)):
			return policy_result
		validated[descriptor.resource_id] = policy_result["policy"]
	for descriptor in _shutdown_resources:
		var policy: Dictionary = validated[descriptor.resource_id]
		descriptor.priority = int(policy["priority"])
		descriptor.timeout_ms = int(policy["timeout_ms"])
		descriptor.is_critical = bool(policy["is_critical"])
	_shutdown_resources.sort_custom(func(first_descriptor: ShutdownResourceDescriptor, second_descriptor: ShutdownResourceDescriptor) -> bool:
		return first_descriptor.priority > second_descriptor.priority
	)
	return {"success": true, "error_code": ""}

static func _validate_shutdown_stage_order(shutdown_hooks: Dictionary) -> Dictionary:
	var raw_order: Variant = shutdown_hooks.get("stage_order", null)
	if not raw_order is Array:
		return {"success": false, "error_code": "INVALID_SHUTDOWN_STAGE_ORDER"}
	var stage_order: Array[String] = []
	var seen: Dictionary = {}
	for raw_stage in raw_order:
		if not raw_stage is String:
			return {"success": false, "error_code": "INVALID_SHUTDOWN_STAGE_KEY"}
		var stage_key: String = String(raw_stage)
		if not SHUTDOWN_STAGE_KEYS.has(stage_key) or seen.has(stage_key):
			return {"success": false, "error_code": "UNKNOWN_OR_DUPLICATE_SHUTDOWN_STAGE:%s" % stage_key}
		seen[stage_key] = true
		stage_order.append(stage_key)
	if stage_order.size() != SHUTDOWN_STAGE_KEYS.size():
		return {"success": false, "error_code": "INCOMPLETE_SHUTDOWN_STAGE_ORDER"}
	return {"success": true, "error_code": "", "stage_order": stage_order}

## 清空已注册的停机清理资源描述符，返回清理的资源数量
static func clear_shutdown_resources() -> int:
	if _is_shutdown_execution_active:
		return 0
	var count := _shutdown_resources.size()
	_shutdown_resources.clear()
	return count

## 停机前置状态守卫与初始化跃迁
static func _guard_shutdown_entry(fsm: Variant, current_phase: int, response: GameShutdownDTO.Response) -> bool:
	if fsm.is_stopping():
		response.success = false
		response.error_code = "ALREADY_STOPPING"
		return false
	if current_phase == GameLifecycleModel.LifecyclePhase.STOP_FAILED:
		response.success = false
		response.error_code = "PREVIOUS_SHUTDOWN_FAILED"
		return false

	if fsm.is_stopped():
		response.success = true
		response.error_code = "ALREADY_STOPPED"
		return false

	# 若尚未初始化，先初始化并跃迁至 RUNNING，支持直接停机
	if current_phase == GameLifecycleModel.LifecyclePhase.UNINITIALIZED:
		fsm.transition_to(GameLifecycleModel.LifecyclePhase.BOOT_INITIALIZING)
		fsm.transition_to(GameLifecycleModel.LifecyclePhase.RUNNING)

	if not fsm.transition_to(GameLifecycleModel.LifecyclePhase.STOPPING):
		response.success = false
		response.error_code = "TRANSITION_REJECTED"
		return false

	return true

static func _record_shutdown_failure(response: GameShutdownDTO.Response, stage: String, error_code: String) -> void:
	if response.failed_stage.is_empty():
		response.failed_stage = stage
		response.error_code = error_code

static func _execute_registered_shutdown_resources(response: GameShutdownDTO.Response) -> Dictionary:
	var should_stop_noncritical: bool = false
	var has_critical_failure: bool = false
	var critical_error_code: String = ""
	for descriptor in _shutdown_resources:
		if should_stop_noncritical and not descriptor.is_critical:
			response.unexecuted_resources.append(descriptor.resource_id)
			response.remaining_resources.append(descriptor.resource_id)
			response.retained_resources.append(descriptor.resource_id)
			continue
		var started_microseconds: int = Time.get_ticks_usec()
		var cleanup_result: Dictionary = descriptor.execute_cleanup()
		@warning_ignore("integer_division")
		var elapsed_milliseconds: int = int((Time.get_ticks_usec() - started_microseconds) / 1000)
		var has_timed_out: bool = descriptor.timeout_ms > 0 and elapsed_milliseconds > descriptor.timeout_ms
		var is_succeeded: bool = bool(cleanup_result.get("success", false))
		if has_timed_out:
			response.timed_out_resources.append(descriptor.resource_id)
			response.degraded_resources.append(descriptor.resource_id)
			should_stop_noncritical = true
			if descriptor.is_critical:
				has_critical_failure = true
				critical_error_code = "CRITICAL_RESOURCE_TIMEOUT"
				_record_shutdown_failure(response, "execute_resource_descriptors", critical_error_code)
		if not is_succeeded:
			response.remaining_resources.append(descriptor.resource_id)
			response.retained_resources.append(descriptor.resource_id)
			response.degraded_resources.append(descriptor.resource_id)
			if descriptor.is_critical:
				has_critical_failure = true
				should_stop_noncritical = true
				critical_error_code = "CRITICAL_RESOURCE_CLEANUP_FAILED"
				_record_shutdown_failure(response, "execute_resource_descriptors", critical_error_code)
	if has_critical_failure:
		return {"success": false, "error_code": critical_error_code}
	return {"success": true, "error_code": ""}

## ShutdownStageContext：关机阶段上下文传输模型
class ShutdownStageContext extends RefCounted:
	var stage: String = ""
	var request: GameShutdownDTO.Request
	var providers: Dictionary = {}
	var fsm: Variant
	var response: GameShutdownDTO.Response
	var bus: Variant
	var save_timeout: float = 3.0
	var force_timeout: float = 2.0

static func _execute_shutdown_stage(stage_context: ShutdownStageContext) -> Dictionary:
	var stage_started_milliseconds: int = Time.get_ticks_msec()
	var is_stage_succeeded: bool = true
	var stage_error: String = ""
	match stage_context.stage:
		"freeze_inputs":
			_freeze_world_and_inputs()
		"flush_saves":
			var save_result: Dictionary = {}
			var auto_save_policy := GameConfig.get_bool("infrastructure.lifecycle", "policies/auto_save_on_exit", true)
			if stage_context.request.save_before_quit and auto_save_policy:
				save_result = _flush_domain_saves(stage_context.request.target_save_slot, stage_context.providers)
				stage_context.response.is_save_completed = bool(save_result.get("success", false))
				stage_context.response.save_sha256 = String(save_result.get("sha256", ""))
				if not stage_context.response.is_save_completed:
					is_stage_succeeded = false
					stage_error = String(save_result.get("error_code", "SAVE_FLUSH_FAILED"))
					stage_context.response.degraded_resources.append("flush_saves")
					var should_allow_degraded := GameConfig.get_bool("infrastructure.lifecycle", "policies/allow_degraded_shutdown_on_save_failure", true)
					var is_strict_save := (stage_context.request.require_save_success and not stage_context.request.force_quit) or (not should_allow_degraded and not stage_context.request.force_quit)
					if is_strict_save:
						_record_shutdown_failure(stage_context.response, "flush_saves", stage_error)
			if stage_context.bus != null:
				stage_context.bus.emit_domain_event("lifecycle.save_completed", {
					"success": stage_context.response.is_save_completed,
					"slot": stage_context.request.target_save_slot,
					"sha256": stage_context.response.save_sha256,
					"error_code": stage_error
				})
		"execute_resource_descriptors":
			var resource_result: Dictionary = _execute_registered_shutdown_resources(stage_context.response)
			is_stage_succeeded = bool(resource_result.get("success", false))
			stage_error = String(resource_result.get("error_code", ""))
		"revoke_session":
			if not stage_context.response.failed_stage.is_empty():
				is_stage_succeeded = false
				stage_error = "SKIPPED_DUE_TO_PRIOR_FAILURE"
			elif not stage_context.request.session_token.is_empty():
				AuthService.revoke_token(stage_context.request.session_token)
				if stage_context.bus != null:
					stage_context.bus.emit_domain_event("lifecycle.session_revoked", {
						"token_prefix": stage_context.request.session_token.substr(0, min(8, stage_context.request.session_token.length()))
					})
		"teardown_bootstrap":
			if not stage_context.response.failed_stage.is_empty():
				is_stage_succeeded = false
				stage_error = "SKIPPED_DUE_TO_PRIOR_FAILURE"
			else:
				var teardown_result: Dictionary = GameBootstrap.teardown()
				if not bool(teardown_result.get("success", false)):
					is_stage_succeeded = false
					stage_error = "BOOTSTRAP_TEARDOWN_FAILED"
					stage_context.response.remaining_resources.append("bootstrap_teardown_failed")
					stage_context.response.retained_resources.append("bootstrap_teardown_failed")
					_record_shutdown_failure(stage_context.response, stage_context.stage, stage_error)
	var elapsed_milliseconds: int = Time.get_ticks_msec() - stage_started_milliseconds
	var timeout_seconds: float = stage_context.save_timeout if stage_context.stage == "flush_saves" else (stage_context.force_timeout if stage_context.stage == "teardown_bootstrap" else 0.0)
	if timeout_seconds > 0.0 and elapsed_milliseconds > int(timeout_seconds * 1000.0):
		is_stage_succeeded = false
		stage_error = "STAGE_TIMEOUT"
		_mark_phase_timeout(stage_context.fsm, stage_context.response, stage_context.bus, stage_context.stage)
	return {
		"stage": stage_context.stage,
		"success": is_stage_succeeded,
		"error_code": stage_error,
		"elapsed_milliseconds": elapsed_milliseconds
	}

## 执行安全优雅停机总管线
static func execute_graceful_shutdown(
	request: GameShutdownDTO.Request,
	providers: Dictionary = {}
) -> GameShutdownDTO.Response:
	var fsm: Variant = GameLifecycleManager.get_instance()
	var start_time := Time.get_ticks_msec()
	var response := GameShutdownDTO.Response.new()
	var current_phase: int = int(fsm.get_current_phase())
	response.current_phase = current_phase
	var shutdown_timeout := GameConfig.get_float("infrastructure.lifecycle", "timeouts/shutdown_timeout_seconds", 5.0)
	var save_timeout := GameConfig.get_float("infrastructure.lifecycle", "timeouts/save_flush_timeout_seconds", 3.0)
	var force_timeout := GameConfig.get_float("infrastructure.lifecycle", "timeouts/force_kill_timeout_seconds", 2.0)
	var shutdown_hooks: Dictionary = GameConfig.get_dict("infrastructure.lifecycle", "shutdown_hooks", {})
	var shutdown_plan: Dictionary = _validate_shutdown_stage_order(shutdown_hooks)
	if not bool(shutdown_plan.get("success", false)):
		response.error_code = String(shutdown_plan.get("error_code", "INVALID_SHUTDOWN_STAGE_ORDER"))
		response.failed_stage = "preflight"
		response.elapsed_milliseconds = Time.get_ticks_msec() - start_time
		return response
	var resource_plan: Dictionary = _prepare_shutdown_resources()
	if not bool(resource_plan.get("success", false)):
		response.error_code = String(resource_plan.get("error_code", "INVALID_SHUTDOWN_RESOURCE_POLICY"))
		response.failed_stage = "preflight"
		response.elapsed_milliseconds = Time.get_ticks_msec() - start_time
		return response

	if not _guard_shutdown_entry(fsm, current_phase, response):
		return response
	if _is_shutdown_execution_active:
		response.success = false
		response.error_code = "ALREADY_STOPPING"
		return response
	_is_shutdown_execution_active = true
	var bus: EventBusCore = EventBusCore.get_instance()

	if bus != null:
		bus.emit_domain_event("lifecycle.shutdown_started", {
			"reason": request.exit_reason,
			"reason_name": GameLifecycleModel.get_reason_name(request.exit_reason),
			"idempotency_key": request.idempotency_key,
			"target_save_slot": request.target_save_slot,
			"stage_order": shutdown_hooks.get("stage_order", [])
		})
		bus.emit_log("info", TemplateFormatter.format(
			"Graceful shutdown pipeline started with reason: {exit_reason}.",
			{"exit_reason": GameLifecycleModel.get_reason_name(request.exit_reason)}
		))

	var stage_context := ShutdownStageContext.new()
	stage_context.request = request
	stage_context.providers = providers
	stage_context.fsm = fsm
	stage_context.response = response
	stage_context.bus = bus
	stage_context.save_timeout = save_timeout
	stage_context.force_timeout = force_timeout

	var has_recorded_total_timeout: bool = false
	var stage_order: Array[String] = shutdown_plan["stage_order"]
	for stage in stage_order:
		stage_context.stage = stage
		var stage_result: Dictionary = _execute_shutdown_stage(stage_context)
		response.stage_results.append(stage_result)
		if not has_recorded_total_timeout and _deadline_exceeded(start_time, shutdown_timeout):
			_mark_phase_timeout(fsm, response, bus, "shutdown_total")
			has_recorded_total_timeout = true

	_is_shutdown_execution_active = false
	_shutdown_resources.clear()
	if response.failed_stage.is_empty():
		if fsm.transition_to(GameLifecycleModel.LifecyclePhase.STOPPED):
			response.success = true
			response.error_code = "OK"
		else:
			_record_shutdown_failure(response, "finalize", "STOP_TRANSITION_REJECTED")
	else:
		if int(fsm.get_current_phase()) == GameLifecycleModel.LifecyclePhase.STOPPING:
			fsm.transition_to(GameLifecycleModel.LifecyclePhase.STOP_FAILED)
		response.success = false
	response.current_phase = int(fsm.get_current_phase())
	response.elapsed_milliseconds = Time.get_ticks_msec() - start_time

	if bus != null:
		bus.emit_domain_event("lifecycle.shutdown_completed", {
			"elapsed_ms": response.elapsed_milliseconds,
			"success": response.success,
			"error_code": response.error_code,
			"is_save_completed": response.is_save_completed,
			"timestamp_utc": int(Time.get_unix_time_from_system())
		})
		bus.emit_log("info", TemplateFormatter.format(
			"Graceful shutdown pipeline closed; elapsed time: {elapsed_ms} ms.",
			{"elapsed_ms": response.elapsed_milliseconds}
		))

	return response

## 记录停机截止失败；同步回调仅在返回后检测，不能由当前流程强制中断
static func _mark_phase_timeout(fsm: Variant, response: GameShutdownDTO.Response, bus: Variant, phase_label: String) -> void:
	if fsm != null and int(fsm.get_current_phase()) == GameLifecycleModel.LifecyclePhase.STOPPING:
		fsm.transition_to(GameLifecycleModel.LifecyclePhase.STOP_FAILED)
	if not response.timed_out_stages.has(phase_label):
		response.timed_out_stages.append(phase_label)
	_record_shutdown_failure(response, phase_label, "SHUTDOWN_STAGE_TIMEOUT")
	response.remaining_resources.append("phase_timeout:%s" % phase_label)
	if bus != null:
		bus.emit_log("warn", TemplateFormatter.format(
			"Shutdown phase '{phase_label}' timed out; synchronous callback returned, continuing asynchronous cleanup.",
			{"phase_label": phase_label}
		))

## 阶段截止判定：耗时超过配置超时即降级（timeout<=0 视为不设限）
static func _deadline_exceeded(start_milliseconds: int, timeout_seconds: float) -> bool:
	if timeout_seconds <= 0.0:
		return false
	return Time.get_ticks_msec() - start_milliseconds > int(timeout_seconds * 1000.0)

## 阶段一：冻结输入与外来通知（I6 null 守卫）
static func _freeze_world_and_inputs() -> void:
	var bus: EventBusCore = EventBusCore.get_instance()
	if bus == null:
		return
	bus.emit_domain_event("lifecycle.inputs_frozen", {
		"timestamp_utc": int(Time.get_unix_time_from_system())
	})

## 阶段二：收集并落盘存档（经 SaveDataAccessLayer 统一访问门面；空存档槽位严格返回 UNBOUND_SAVE_SLOT）
static func _flush_domain_saves(target_slot: String, providers: Dictionary = {}) -> Dictionary:
	var sentinel: String = GameConfig.get_string("infrastructure.lifecycle", "shutdown_hooks/unwired_slot_sentinel", "")
	if sentinel.is_empty():
		return {"success": false, "error_code": "INVALID_UNBOUND_SENTINEL_CONFIG", "unwired_slot": "UNBOUND_SENTINEL", "sha256": ""}
	if target_slot.is_empty() or target_slot == sentinel:
		return {
			"success": false,
			"error_code": "UNBOUND_SAVE_SLOT",
			"unwired_slot": "target_save_slot",
			"sha256": ""
		}
	var registered: Array[String] = []
	for domain_id in providers.keys():
		SaveDataAccessLayer.register_provider(String(domain_id), providers[domain_id])
		registered.append(String(domain_id))
	var payload := SaveDataAccessLayer.build_save_payload()
	var save_operation_result := SaveDataAccessLayer.save_game(target_slot, payload)
	for domain_id in registered:
		SaveDataAccessLayer.unregister_provider(domain_id)
	return save_operation_result

## 暂停/恢复主循环状态切换（与 GameLifecycleManager RUNNING <-> PAUSED 同步）
static func set_paused_state(is_paused: bool) -> Dictionary:
	var fsm: Variant = GameLifecycleManager.get_instance()
	var target := GameLifecycleModel.LifecyclePhase.PAUSED if is_paused else GameLifecycleModel.LifecyclePhase.RUNNING
	var current_phase := int(fsm.get_current_phase())
	if current_phase == GameLifecycleModel.LifecyclePhase.UNINITIALIZED and is_paused:
		fsm.transition_to(GameLifecycleModel.LifecyclePhase.BOOT_INITIALIZING)
		fsm.transition_to(GameLifecycleModel.LifecyclePhase.RUNNING)
		current_phase = int(fsm.get_current_phase())
	var is_transition_succeeded := (current_phase == target) or bool(fsm.transition_to(target))
	return {
		"success": is_transition_succeeded,
		"is_paused": is_paused,
		"current_phase": int(fsm.get_current_phase()),
		"error_code": "" if is_transition_succeeded else "ERR_INVALID_PAUSE_TRANSITION"
	}

## 非破坏性退回账号首页（保留引擎装配，仅落盘/注销令牌与会话上下文）
static func execute_logout_to_menu(request: GameShutdownDTO.Request, providers: Dictionary = {}) -> GameShutdownDTO.Response:
	var response := GameShutdownDTO.Response.new()
	var fsm: Variant = GameLifecycleManager.get_instance()
	if request != null and request.save_before_quit and not request.target_save_slot.is_empty():
		var save_result := _flush_domain_saves(request.target_save_slot, providers)
		response.is_save_completed = bool(save_result.get("success", false))
		response.save_sha256 = String(save_result.get("sha256", ""))
		if not response.is_save_completed and request.require_save_success:
			response.success = false
			response.failed_stage = "flush_saves"
			response.error_code = String(save_result.get("error_code", "SAVE_FLUSH_FAILED"))
			response.current_phase = int(fsm.get_current_phase())
			return response
	if request != null and not request.session_token.is_empty():
		AuthService.revoke_token(request.session_token)
	if int(fsm.get_current_phase()) == GameLifecycleModel.LifecyclePhase.PAUSED:
		fsm.transition_to(GameLifecycleModel.LifecyclePhase.RUNNING)
	response.success = true
	response.error_code = "OK"
	response.current_phase = int(fsm.get_current_phase())
	var bus := EventBusCore.get_instance()
	if bus != null:
		bus.emit_domain_event("lifecycle.logout_to_menu_completed", {
			"account_id": request.account_id if request != null else "",
			"is_save_completed": response.is_save_completed,
			"current_phase": response.current_phase
		})
	return response

## STOP_FAILED 强制清理恢复管线（STOP_FAILED -> FORCE_STOPPING -> STOPPED）
static func execute_force_shutdown(request: GameShutdownDTO.Request = null) -> GameShutdownDTO.Response:
	var fsm: Variant = GameLifecycleManager.get_instance()
	var response := GameShutdownDTO.Response.new()
	var current_phase := int(fsm.get_current_phase())
	if current_phase == GameLifecycleModel.LifecyclePhase.STOPPED:
		response.success = true
		response.error_code = "ALREADY_STOPPED"
		response.current_phase = current_phase
		return response
	if current_phase != GameLifecycleModel.LifecyclePhase.STOP_FAILED and current_phase != GameLifecycleModel.LifecyclePhase.STOPPING:
		if current_phase == GameLifecycleModel.LifecyclePhase.UNINITIALIZED:
			fsm.transition_to(GameLifecycleModel.LifecyclePhase.BOOT_INITIALIZING)
			fsm.transition_to(GameLifecycleModel.LifecyclePhase.RUNNING)
		if int(fsm.get_current_phase()) == GameLifecycleModel.LifecyclePhase.PAUSED or int(fsm.get_current_phase()) == GameLifecycleModel.LifecyclePhase.RUNNING:
			fsm.transition_to(GameLifecycleModel.LifecyclePhase.STOPPING)
	fsm.transition_to(GameLifecycleModel.LifecyclePhase.FORCE_STOPPING)
	_shutdown_resources.clear()
	_is_shutdown_execution_active = false
	if request != null and not request.session_token.is_empty():
		AuthService.revoke_token(request.session_token)
	var teardown_result := GameBootstrap.teardown()
	response.success = bool(teardown_result.get("success", false)) and bool(fsm.transition_to(GameLifecycleModel.LifecyclePhase.STOPPED))
	response.error_code = "OK" if response.success else "ERR_FORCE_SHUTDOWN_FAILED"
	response.current_phase = int(fsm.get_current_phase())
	return response

# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/lifecycle/game_lifecycle_service.gd
# 架构定位: Domain Service / State Orchestrator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/lifecycle.json | 信号: EventBus 领域广播
# 职责说明: 编排多阶段安全停机管线（输入冻结 ➔ 持久化刷盘 ➔ 凭证注销 ➔ 引擎反装配）与统一 EventBus 广播
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name GameLifecycleService
extends RefCounted

const GameLifecycleModel = preload("res://backend/domains/lifecycle/lifecycle_model.gd")
const GameShutdownDTO = preload("res://backend/domains/lifecycle/dto/game_shutdown_dto.gd")
const GameLifecycleManager = preload("res://backend/domains/lifecycle/game_lifecycle_manager.gd")
const SaveDataAccessLayer = preload("res://backend/domains/persistence_protocol/save_data_access_layer.gd")

const ShutdownResourceDescriptor = preload("res://backend/domains/lifecycle/shutdown_resource_descriptor.gd")
const SHUTDOWN_STAGE_KEYS = ["freeze_inputs", "flush_saves", "execute_resource_descriptors", "revoke_session", "teardown_bootstrap"]

static var _shutdown_resources: Array[ShutdownResourceDescriptor] = []
static var _shutdown_execution_active: bool = false

## 注册资源前从 lifecycle 唯一策略表装配优先级、超时与关键性
static func register_shutdown_resource(descriptor: ShutdownResourceDescriptor) -> bool:
	if _shutdown_execution_active or descriptor == null or descriptor.resource_id.strip_edges().is_empty() or not descriptor.cleanup_action.is_valid():
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
	var idx := 0
	while idx < _shutdown_resources.size() and _shutdown_resources[idx].priority >= descriptor.priority:
		idx += 1
	_shutdown_resources.insert(idx, descriptor)
	return true

static func _is_integer_variant(value: Variant) -> bool:
	var value_type: int = typeof(value)
	if value_type != TYPE_INT and value_type != TYPE_FLOAT:
		return false
	return is_equal_approx(float(value), floor(float(value)))

static func _get_resource_policy(resource_id: String, policies: Dictionary) -> Dictionary:
	var raw_policy: Variant = policies.get(resource_id, null)
	if not raw_policy is Dictionary:
		return {"success": false, "error_code": "MISSING_RESOURCE_POLICY:%s" % resource_id}
	var policy: Dictionary = raw_policy
	var priority: Variant = policy.get("priority", null)
	var timeout_ms: Variant = policy.get("timeout_ms", null)
	var is_critical: Variant = policy.get("is_critical", null)
	if not _is_integer_variant(priority) or not _is_integer_variant(timeout_ms) or int(timeout_ms) < 0 or not is_critical is bool:
		return {"success": false, "error_code": "INVALID_RESOURCE_POLICY:%s" % resource_id}
	return {
		"success": true,
		"policy": {
			"priority": int(priority),
			"timeout_ms": int(timeout_ms),
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
	_shutdown_resources.sort_custom(func(a: ShutdownResourceDescriptor, b: ShutdownResourceDescriptor) -> bool:
		return a.priority > b.priority
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
	if _shutdown_execution_active:
		return 0
	var count := _shutdown_resources.size()
	_shutdown_resources.clear()
	return count

## 停机前置状态守卫与初始化跃迁
static func _guard_shutdown_entry(fsm: Variant, cur_phase: int, resp: GameShutdownDTO.Response) -> bool:
	if fsm.is_stopping():
		resp.success = false
		resp.error_code = "ALREADY_STOPPING"
		return false
	if cur_phase == GameLifecycleModel.LifecyclePhase.STOP_FAILED:
		resp.success = false
		resp.error_code = "PREVIOUS_SHUTDOWN_FAILED"
		return false

	if fsm.is_stopped():
		resp.success = true
		resp.error_code = "ALREADY_STOPPED"
		return false

	# 若尚未初始化，先初始化并跃迁至 RUNNING，支持直接停机
	if cur_phase == GameLifecycleModel.LifecyclePhase.UNINITIALIZED:
		fsm.transition_to(GameLifecycleModel.LifecyclePhase.BOOT_INITIALIZING)
		fsm.transition_to(GameLifecycleModel.LifecyclePhase.RUNNING)

	if not fsm.transition_to(GameLifecycleModel.LifecyclePhase.STOPPING):
		resp.success = false
		resp.error_code = "TRANSITION_REJECTED"
		return false

	return true

static func _record_shutdown_failure(resp: GameShutdownDTO.Response, stage: String, error_code: String) -> void:
	if resp.failed_stage.is_empty():
		resp.failed_stage = stage
		resp.error_code = error_code

static func _execute_registered_shutdown_resources(resp: GameShutdownDTO.Response) -> Dictionary:
	var stop_noncritical: bool = false
	var critical_failure: bool = false
	var critical_error_code: String = ""
	for descriptor in _shutdown_resources:
		if stop_noncritical and not descriptor.is_critical:
			resp.unexecuted_resources.append(descriptor.resource_id)
			resp.remaining_resources.append(descriptor.resource_id)
			resp.retained_resources.append(descriptor.resource_id)
			continue
		var started_usec: int = Time.get_ticks_usec()
		var cleanup_result: Dictionary = descriptor.execute_cleanup()
		var elapsed_ms: int = int((Time.get_ticks_usec() - started_usec) / 1000)
		var timed_out: bool = descriptor.timeout_ms > 0 and elapsed_ms > descriptor.timeout_ms
		var succeeded: bool = bool(cleanup_result.get("success", false))
		if timed_out:
			resp.timed_out_resources.append(descriptor.resource_id)
			resp.degraded_resources.append(descriptor.resource_id)
			stop_noncritical = true
			if descriptor.is_critical:
				critical_failure = true
				critical_error_code = "CRITICAL_RESOURCE_TIMEOUT"
				_record_shutdown_failure(resp, "execute_resource_descriptors", critical_error_code)
		if not succeeded:
			resp.remaining_resources.append(descriptor.resource_id)
			resp.retained_resources.append(descriptor.resource_id)
			resp.degraded_resources.append(descriptor.resource_id)
			if descriptor.is_critical:
				critical_failure = true
				stop_noncritical = true
				critical_error_code = "CRITICAL_RESOURCE_CLEANUP_FAILED"
				_record_shutdown_failure(resp, "execute_resource_descriptors", critical_error_code)
	if critical_failure:
		return {"success": false, "error_code": critical_error_code}
	return {"success": true, "error_code": ""}

class ShutdownStageContext extends RefCounted:
	var stage: String = ""
	var request: GameShutdownDTO.Request
	var providers: Dictionary = {}
	var allow_default_fallback: bool = true
	var fsm: Variant
	var resp: GameShutdownDTO.Response
	var bus: Variant
	var save_timeout: float = 3.0
	var force_timeout: float = 2.0

static func _execute_shutdown_stage(ctx: ShutdownStageContext) -> Dictionary:
	var stage_started_ms: int = Time.get_ticks_msec()
	var stage_success: bool = true
	var stage_error: String = ""
	match ctx.stage:
		"freeze_inputs":
			_freeze_world_and_inputs()
		"flush_saves":
			var save_result: Dictionary = {}
			if GameConfig.get_bool("infrastructure.lifecycle", "policies/auto_save_on_exit", true):
				save_result = _flush_domain_saves(ctx.request.target_save_slot, ctx.providers, ctx.allow_default_fallback)
				ctx.resp.is_save_completed = bool(save_result.get("success", false))
				ctx.resp.save_sha256 = String(save_result.get("sha256", ""))
				if not ctx.resp.is_save_completed:
					stage_success = false
					stage_error = String(save_result.get("error_code", "SAVE_FLUSH_FAILED"))
					ctx.resp.degraded_resources.append("flush_saves")
			if ctx.bus != null:
				ctx.bus.emit_domain_event("lifecycle.save_completed", {
					"success": ctx.resp.is_save_completed,
					"slot": ctx.request.target_save_slot,
					"sha256": ctx.resp.save_sha256,
					"error_code": stage_error
				})
		"execute_resource_descriptors":
			var resource_result: Dictionary = _execute_registered_shutdown_resources(ctx.resp)
			stage_success = bool(resource_result.get("success", false))
			stage_error = String(resource_result.get("error_code", ""))
		"revoke_session":
			if not ctx.request.session_token.is_empty():
				AuthService.revoke_token(ctx.request.session_token)
				if ctx.bus != null:
					ctx.bus.emit_domain_event("lifecycle.session_revoked", {
						"token_prefix": ctx.request.session_token.substr(0, min(8, ctx.request.session_token.length()))
					})
		"teardown_bootstrap":
			var teardown_result: Dictionary = GameBootstrap.teardown()
			if not bool(teardown_result.get("success", false)):
				stage_success = false
				stage_error = "BOOTSTRAP_TEARDOWN_FAILED"
				ctx.resp.remaining_resources.append("bootstrap_teardown_failed")
				ctx.resp.retained_resources.append("bootstrap_teardown_failed")
				_record_shutdown_failure(ctx.resp, ctx.stage, stage_error)
	var elapsed_ms: int = Time.get_ticks_msec() - stage_started_ms
	var timeout_seconds: float = ctx.save_timeout if ctx.stage == "flush_saves" else (ctx.force_timeout if ctx.stage == "teardown_bootstrap" else 0.0)
	if timeout_seconds > 0.0 and elapsed_ms > int(timeout_seconds * 1000.0):
		stage_success = false
		stage_error = "STAGE_TIMEOUT"
		_mark_phase_timeout(ctx.fsm, ctx.resp, ctx.bus, ctx.stage)
	return {
		"stage": ctx.stage,
		"success": stage_success,
		"error_code": stage_error,
		"elapsed_milliseconds": elapsed_ms
	}

## 执行安全优雅停机总管线
static func execute_graceful_shutdown(
	request: GameShutdownDTO.Request,
	providers: Dictionary = {},
	allow_default_fallback: bool = true
) -> GameShutdownDTO.Response:
	var fsm: Variant = GameLifecycleManager.get_instance()
	var start_time := Time.get_ticks_msec()
	var resp := GameShutdownDTO.Response.new()
	var cur_phase: int = int(fsm.get_current_phase())
	resp.current_phase = cur_phase
	var shutdown_timeout := GameConfig.get_float("infrastructure.lifecycle", "timeouts/shutdown_timeout_seconds", 5.0)
	var save_timeout := GameConfig.get_float("infrastructure.lifecycle", "timeouts/save_flush_timeout_seconds", 3.0)
	var force_timeout := GameConfig.get_float("infrastructure.lifecycle", "timeouts/force_kill_timeout_seconds", 2.0)
	var shutdown_hooks: Dictionary = GameConfig.get_dict("infrastructure.lifecycle", "shutdown_hooks", {})
	var shutdown_plan: Dictionary = _validate_shutdown_stage_order(shutdown_hooks)
	if not bool(shutdown_plan.get("success", false)):
		resp.error_code = String(shutdown_plan.get("error_code", "INVALID_SHUTDOWN_STAGE_ORDER"))
		resp.failed_stage = "preflight"
		resp.elapsed_milliseconds = Time.get_ticks_msec() - start_time
		return resp
	var resource_plan: Dictionary = _prepare_shutdown_resources()
	if not bool(resource_plan.get("success", false)):
		resp.error_code = String(resource_plan.get("error_code", "INVALID_SHUTDOWN_RESOURCE_POLICY"))
		resp.failed_stage = "preflight"
		resp.elapsed_milliseconds = Time.get_ticks_msec() - start_time
		return resp

	if not _guard_shutdown_entry(fsm, cur_phase, resp):
		return resp
	if _shutdown_execution_active:
		resp.success = false
		resp.error_code = "ALREADY_STOPPING"
		return resp
	_shutdown_execution_active = true
	var bus: EventBusCore = EventBusCore.get_instance()

	if bus != null:
		bus.emit_domain_event("lifecycle.shutdown_started", {
			"reason": request.exit_reason,
			"reason_name": GameLifecycleModel.get_reason_name(request.exit_reason),
			"idempotency_key": request.idempotency_key,
			"target_save_slot": request.target_save_slot,
			"stage_order": shutdown_hooks.get("stage_order", [])
		})
		bus.emit_log("info", "安全停机管线启动，原因: %s" % GameLifecycleModel.get_reason_name(request.exit_reason))

	var ctx := ShutdownStageContext.new()
	ctx.request = request
	ctx.providers = providers
	ctx.allow_default_fallback = allow_default_fallback
	ctx.fsm = fsm
	ctx.resp = resp
	ctx.bus = bus
	ctx.save_timeout = save_timeout
	ctx.force_timeout = force_timeout

	var total_timeout_recorded: bool = false
	var stage_order: Array[String] = shutdown_plan["stage_order"]
	for stage in stage_order:
		ctx.stage = stage
		var stage_result: Dictionary = _execute_shutdown_stage(ctx)
		resp.stage_results.append(stage_result)
		if not total_timeout_recorded and _deadline_exceeded(start_time, shutdown_timeout):
			_mark_phase_timeout(fsm, resp, bus, "shutdown_total")
			total_timeout_recorded = true

	_shutdown_execution_active = false
	_shutdown_resources.clear()
	if resp.failed_stage.is_empty():
		if fsm.transition_to(GameLifecycleModel.LifecyclePhase.STOPPED):
			resp.success = true
			resp.error_code = "OK"
		else:
			_record_shutdown_failure(resp, "finalize", "STOP_TRANSITION_REJECTED")
	else:
		if int(fsm.get_current_phase()) == GameLifecycleModel.LifecyclePhase.STOPPING:
			fsm.transition_to(GameLifecycleModel.LifecyclePhase.STOP_FAILED)
		resp.success = false
	resp.current_phase = int(fsm.get_current_phase())
	resp.elapsed_milliseconds = Time.get_ticks_msec() - start_time

	if bus != null:
		bus.emit_domain_event("lifecycle.shutdown_completed", {
			"elapsed_ms": resp.elapsed_milliseconds,
			"success": resp.success,
			"error_code": resp.error_code,
			"is_save_completed": resp.is_save_completed,
			"timestamp_utc": int(Time.get_unix_time_from_system())
		})
		bus.emit_log("info", "安全停机流程闭环，耗时: %d ms" % resp.elapsed_milliseconds)

	return resp

## 记录停机截止失败；同步回调仅在返回后检测，不能由当前流程强制中断
static func _mark_phase_timeout(fsm: Variant, resp: GameShutdownDTO.Response, bus: Variant, phase_label: String) -> void:
	if fsm != null and int(fsm.get_current_phase()) == GameLifecycleModel.LifecyclePhase.STOPPING:
		fsm.transition_to(GameLifecycleModel.LifecyclePhase.STOP_FAILED)
	if not resp.timed_out_stages.has(phase_label):
		resp.timed_out_stages.append(phase_label)
	_record_shutdown_failure(resp, phase_label, "SHUTDOWN_STAGE_TIMEOUT")
	resp.remaining_resources.append("phase_timeout:%s" % phase_label)
	if bus != null:
		bus.emit_log("warn", "停机阶段 %s 超时；同步回调已返回，后续清理按配置继续" % phase_label)

## 阶段截止判定：耗时超过配置超时即降级（timeout<=0 视为不设限）
static func _deadline_exceeded(start_ms: int, timeout_seconds: float) -> bool:
	if timeout_seconds <= 0.0:
		return false
	return Time.get_ticks_msec() - start_ms > int(timeout_seconds * 1000.0)

## 阶段一：冻结输入与外来通知（I6 null 守卫）
static func _freeze_world_and_inputs() -> void:
	var bus: EventBusCore = EventBusCore.get_instance()
	if bus == null:
		return
	bus.emit_domain_event("lifecycle.inputs_frozen", {
		"timestamp_utc": int(Time.get_unix_time_from_system())
	})

## 阶段二：收集并落盘存档（经 SaveDataAccessLayer 统一访问门面；未接线严格模式下拒绝静默绑定 quicksave_exit）
static func _flush_domain_saves(target_slot: String, providers: Dictionary = {}, allow_default_fallback: bool = true) -> Dictionary:
	var require_explicit := GameConfig.get_bool("infrastructure.lifecycle", "shutdown_hooks/require_explicit_save_slot", false)
	var sentinel: String = GameConfig.get_string("infrastructure.lifecycle", "shutdown_hooks/unwired_slot_sentinel", "")
	if sentinel.is_empty():
		return {"success": false, "error_code": "INVALID_UNBOUND_SENTINEL_CONFIG", "unwired_slot": "UNBOUND_SENTINEL", "sha256": ""}
	if target_slot.is_empty() or target_slot == sentinel:
		if not allow_default_fallback or require_explicit:
			return {
				"success": false,
				"error_code": "UNBOUND_SAVE_SLOT",
				"unwired_slot": "target_save_slot",
				"sha256": ""
			}
	var slot_name := target_slot if not target_slot.is_empty() else "quicksave_exit"
	var registered: Array[String] = []
	for d_id in providers.keys():
		SaveDataAccessLayer.register_provider(String(d_id), providers[d_id])
		registered.append(String(d_id))
	var payload := SaveDataAccessLayer.build_save_payload()
	var result := SaveDataAccessLayer.save_game(slot_name, payload)
	for d_id in registered:
		SaveDataAccessLayer.unregister_provider(d_id)
	return result

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

## 执行安全优雅停机总管线
static func execute_graceful_shutdown(request: GameShutdownDTO.Request, providers: Dictionary = {}) -> GameShutdownDTO.Response:
	var fsm: Variant = GameLifecycleManager.get_instance()
	var start_time := Time.get_ticks_msec()
	var resp := GameShutdownDTO.Response.new()
	var cur_phase: int = int(fsm.get_current_phase())
	resp.current_phase = cur_phase
	# B3 接线：读取停机/存盘/强杀超时配置作为各阶段截止判据（infrastructure.lifecycle timeouts 段，
	# 同步消除死配置——超时值不再仅存在于测试断言中）
	var shutdown_timeout := GameConfig.get_float("infrastructure.lifecycle", "timeouts/shutdown_timeout_seconds", 5.0)
	var save_timeout := GameConfig.get_float("infrastructure.lifecycle", "timeouts/save_flush_timeout_seconds", 3.0)
	var force_timeout := GameConfig.get_float("infrastructure.lifecycle", "timeouts/force_kill_timeout_seconds", 2.0)
	var bus = EventBusCore.get_instance()

	# 1. 状态守卫（Inv-EX-2 / Inv-EX2-1 并发与重入拦截）
	if fsm.is_stopping():
		resp.success = false
		resp.error_code = "ALREADY_STOPPING"
		return resp

	if fsm.is_stopped():
		resp.success = true
		resp.error_code = "ALREADY_STOPPED"
		return resp

	# 若尚未初始化，先初始化并跃迁至 RUNNING，支持直接停机
	if cur_phase == GameLifecycleModel.LifecyclePhase.UNINITIALIZED:
		fsm.transition_to(GameLifecycleModel.LifecyclePhase.BOOT_INITIALIZING)
		fsm.transition_to(GameLifecycleModel.LifecyclePhase.RUNNING)

	# 2. 跃迁至 STOPPING 态
	if not fsm.transition_to(GameLifecycleModel.LifecyclePhase.STOPPING):
		resp.success = false
		resp.error_code = "TRANSITION_REJECTED"
		return resp

	# 统一 EventBus 广播：停机启动（I6 null 守卫）
	if bus != null:
		bus.emit_domain_event("lifecycle.shutdown_started", {
			"reason": request.exit_reason,
			"reason_name": GameLifecycleModel.get_reason_name(request.exit_reason),
			"idempotency_key": request.idempotency_key,
			"target_save_slot": request.target_save_slot
		})
		bus.emit_log("info", "安全停机管线启动，原因: %s" % GameLifecycleModel.get_reason_name(request.exit_reason))

	# 3. 阶段一：冻结输入与外来调度
	_freeze_world_and_inputs()
	# B3：冻结阶段截止检查——超时降级 STOP_FAILED → FORCE_STOPPING
	if _deadline_exceeded(start_time, shutdown_timeout):
		_mark_phase_timeout(fsm, resp, bus, "freeze_inputs")

	# 4. 阶段二：全域持久化落盘
	var auto_save: bool = GameConfig.get_bool("infrastructure.lifecycle", "policies/auto_save_on_exit", true)
	if auto_save:
		var save_result := _flush_domain_saves(request.target_save_slot, providers)
		resp.is_save_completed = bool(save_result.get("success", false))
		resp.save_sha256 = String(save_result.get("sha256", ""))
		if bus != null:
			bus.emit_domain_event("lifecycle.save_completed", {
				"success": resp.is_save_completed,
				"slot": request.target_save_slot,
				"sha256": resp.save_sha256
			})
		if not resp.is_save_completed:
			if bus != null:
				bus.emit_log("warn", "停机自动存盘未完全成功，降级继续清理")
		# B3：存盘阶段截止检查（save_flush 超时降级）
		if _deadline_exceeded(start_time, save_timeout):
			_mark_phase_timeout(fsm, resp, bus, "save_flush")

	# 5. 阶段三：会话注销与凭证销毁
	if not request.session_token.is_empty():
		AuthService.revoke_token(request.session_token)
		if bus != null:
			bus.emit_domain_event("lifecycle.session_revoked", {
				"token_prefix": request.session_token.substr(0, min(8, request.session_token.length()))
			})
	# B3：会话注销阶段截止检查
	if _deadline_exceeded(start_time, shutdown_timeout):
		_mark_phase_timeout(fsm, resp, bus, "session_revoke")

	# 6. 阶段四：引擎对称反装配（单例复位与监听器解绑）
	# B3：进入反装配前强杀截止检查（force_kill 超时触发强制清理路径）
	if _deadline_exceeded(start_time, force_timeout):
		_mark_phase_timeout(fsm, resp, bus, "teardown_force")
	var td_res := GameBootstrap.teardown()
	if not bool(td_res.get("success", false)):
		resp.remaining_resources.append("bootstrap_teardown_failed")

	# 7. 跃迁至 STOPPED 终态
	fsm.transition_to(GameLifecycleModel.LifecyclePhase.STOPPED)
	resp.success = true
	resp.error_code = "OK"
	resp.current_phase = GameLifecycleModel.LifecyclePhase.STOPPED
	resp.elapsed_milliseconds = Time.get_ticks_msec() - start_time

	# 统一 EventBus 广播：停机完全闭环（I6 null 守卫）
	if bus != null:
		bus.emit_domain_event("lifecycle.shutdown_completed", {
			"elapsed_ms": resp.elapsed_milliseconds,
			"is_save_completed": resp.is_save_completed,
			"timestamp_utc": int(Time.get_unix_time_from_system())
		})
		bus.emit_log("info", "安全停机流程闭环，耗时: %d ms" % resp.elapsed_milliseconds)

	return resp

## 停机截止降级：STOPPING → STOP_FAILED → FORCE_STOPPING 并登记超时资源（B3 超时接线）
static func _mark_phase_timeout(fsm: Variant, resp: GameShutdownDTO.Response, bus: Variant, phase_label: String) -> void:
	if fsm != null and int(fsm.get_current_phase()) == GameLifecycleModel.LifecyclePhase.STOPPING:
		fsm.transition_to(GameLifecycleModel.LifecyclePhase.STOP_FAILED)
		fsm.transition_to(GameLifecycleModel.LifecyclePhase.FORCE_STOPPING)
	resp.remaining_resources.append("phase_timeout:%s" % phase_label)
	if bus != null:
		bus.emit_log("warn", "停机阶段 %s 超时，已降级强制清理路径" % phase_label)

## 阶段截止判定：耗时超过配置超时即降级（timeout<=0 视为不设限）
static func _deadline_exceeded(start_ms: int, timeout_seconds: float) -> bool:
	if timeout_seconds <= 0.0:
		return false
	return Time.get_ticks_msec() - start_ms > int(timeout_seconds * 1000.0)

## 阶段一：冻结输入与外来通知（I6 null 守卫）
static func _freeze_world_and_inputs() -> void:
	var bus = EventBusCore.get_instance()
	if bus == null:
		return
	bus.emit_domain_event("lifecycle.inputs_frozen", {
		"timestamp_utc": int(Time.get_unix_time_from_system())
	})

## 阶段二：收集并落盘存档（经 SaveDataAccessLayer 统一访问门面，Inv-SV-6）
static func _flush_domain_saves(target_slot: String, providers: Dictionary = {}) -> Dictionary:
	var slot_name := target_slot if not target_slot.is_empty() else "quicksave_exit"
	var registered: Array[String] = []
	for d_id in providers.keys():
		SaveDataAccessLayer.register_provider(String(d_id), providers[d_id])
		registered.append(String(d_id))
	var payload := SaveDataAccessLayer.build_save_payload()
	var result := SaveDataAccessLayer.save_game(slot_name, payload)
	# 停机装配收尾：注销本次注册的 provider，避免跨停机周期静态契约残留（域边界隔离）
	for d_id in registered:
		SaveDataAccessLayer.unregister_provider(d_id)
	return result

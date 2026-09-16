# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/lifecycle/game_lifecycle_manager.gd
# 架构定位: Domain Service / State Orchestrator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/lifecycle.json | 信号: EventBus 领域广播
# 职责说明: 维护引擎生命周期状态机权威单例、执行单向跃迁守卫与统一 EventBus 广播
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name GameLifecycleManager
extends RefCounted

const GameLifecycleModel = preload("res://backend/domains/lifecycle/lifecycle_model.gd")
const GameShutdownDTO = preload("res://backend/domains/lifecycle/dto/game_shutdown_dto.gd")

signal lifecycle_state_changed(previous_phase: int, new_phase: int)

static var _instance: RefCounted = null

var _current_phase: int = GameLifecycleModel.LifecyclePhase.UNINITIALIZED
var _shutdown_in_progress: bool = false
var _active_shutdown_req: GameShutdownDTO.Request = null

## 生命周期管理器权威单例（懒加载）
static func get_instance() -> RefCounted:
	if _instance == null:
		_instance = new()
	return _instance

## 测试重置：复位内部状态并清空单例
static func reset_for_test() -> void:
	if _instance != null:
		_instance._current_phase = GameLifecycleModel.LifecyclePhase.UNINITIALIZED
		_instance._shutdown_in_progress = false
		_instance._active_shutdown_req = null
	_instance = null

## 当前生命周期阶段
func get_current_phase() -> int:
	return _current_phase

## 是否运行中（RUNNING）
func is_running() -> bool:
	return _current_phase == GameLifecycleModel.LifecyclePhase.RUNNING

## 是否停止中（STOPPING / FORCE_STOPPING）
func is_stopping() -> bool:
	return _current_phase == GameLifecycleModel.LifecyclePhase.STOPPING or _current_phase == GameLifecycleModel.LifecyclePhase.FORCE_STOPPING

## 是否已停止（STOPPED）
func is_stopped() -> bool:
	return _current_phase == GameLifecycleModel.LifecyclePhase.STOPPED

## 推进状态跃迁（写权限内部收敛，Inv-EX-1 / Inv-EX-2）
func transition_to(target_phase: int) -> bool:
	if not _is_valid_transition(_current_phase, target_phase):
		var prev_name := GameLifecycleModel.get_phase_name(_current_phase)
		var target_name := GameLifecycleModel.get_phase_name(target_phase)
		EventBusCore.get_instance().emit_log("warn", "非法生命周期跃迁被拦截: %s -> %s" % [prev_name, target_name])
		return false

	var prev := _current_phase
	_current_phase = target_phase
	lifecycle_state_changed.emit(prev, target_phase)

	# 接入统一 EventBus 广播
	EventBusCore.get_instance().emit_domain_event("lifecycle.phase_changed", {
		"previous_phase": prev,
		"new_phase": target_phase,
		"previous_name": GameLifecycleModel.get_phase_name(prev),
		"new_name": GameLifecycleModel.get_phase_name(target_phase),
		"timestamp_utc": int(Time.get_unix_time_from_system())
	})

	return true

## 单向跃迁合法性表（终态 STOPPED 后禁再跃迁；非法跃迁拦截告警）
func _is_valid_transition(from_phase: int, to_phase: int) -> bool:
	match from_phase:
		GameLifecycleModel.LifecyclePhase.UNINITIALIZED:
			return to_phase == GameLifecycleModel.LifecyclePhase.BOOT_INITIALIZING
		GameLifecycleModel.LifecyclePhase.BOOT_INITIALIZING:
			return to_phase == GameLifecycleModel.LifecyclePhase.RUNNING or to_phase == GameLifecycleModel.LifecyclePhase.STOPPED
		GameLifecycleModel.LifecyclePhase.RUNNING:
			return to_phase == GameLifecycleModel.LifecyclePhase.PAUSED or to_phase == GameLifecycleModel.LifecyclePhase.STOPPING
		GameLifecycleModel.LifecyclePhase.PAUSED:
			return to_phase == GameLifecycleModel.LifecyclePhase.RUNNING or to_phase == GameLifecycleModel.LifecyclePhase.STOPPING
		GameLifecycleModel.LifecyclePhase.STOPPING:
			return to_phase == GameLifecycleModel.LifecyclePhase.STOPPED or to_phase == GameLifecycleModel.LifecyclePhase.STOP_FAILED or to_phase == GameLifecycleModel.LifecyclePhase.FORCE_STOPPING
		GameLifecycleModel.LifecyclePhase.STOP_FAILED:
			return to_phase == GameLifecycleModel.LifecyclePhase.FORCE_STOPPING or to_phase == GameLifecycleModel.LifecyclePhase.STOPPED
		GameLifecycleModel.LifecyclePhase.FORCE_STOPPING:
			return to_phase == GameLifecycleModel.LifecyclePhase.STOPPED
		GameLifecycleModel.LifecyclePhase.STOPPED:
			return false
	return false

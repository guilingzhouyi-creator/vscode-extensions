# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/lifecycle/dto/game_shutdown_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/lifecycle.json | 信号: EventBus 领域广播
# 职责说明: 规范前后端及服务间退出指令交互的参数结构与序列化契约
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## GameShutdownDTO：Value Object DTO / Data Transport Model
class_name GameShutdownDTO
extends RefCounted

const GameLifecycleModel = preload("res://backend/domains/lifecycle/game_lifecycle_model.gd")

## 停机请求 DTO
class Request extends RefCounted:
	var session_token: String = ""
	var account_id: String = ""
	var exit_reason: int = GameLifecycleModel.ExitReason.USER_DESKTOP_QUIT
	var target_save_slot: String = ""
	var idempotency_key: String = ""
	var force_timeout_seconds: float = 5.0
	var timestamp_utc: int = 0
	var save_before_quit: bool = true
	var require_save_success: bool = false
	var force_quit: bool = false

	## 序列化停机请求为字典
	func to_dto() -> Dictionary:
		return {
			"session_token": session_token,
			"account_id": account_id,
			"exit_reason": exit_reason,
			"target_save_slot": target_save_slot,
			"idempotency_key": idempotency_key,
			"force_timeout_seconds": force_timeout_seconds,
			"timestamp_utc": timestamp_utc,
			"save_before_quit": save_before_quit,
			"require_save_success": require_save_success,
			"force_quit": force_quit
		}

	## 从字典重建停机请求（缺省回退默认值）
	static func from_dto(serialized_payload: Dictionary) -> Request:
		var request := Request.new()
		request.session_token = String(serialized_payload.get("session_token", ""))
		request.account_id = String(serialized_payload.get("account_id", ""))
		request.exit_reason = int(serialized_payload.get("exit_reason", GameLifecycleModel.ExitReason.USER_DESKTOP_QUIT))
		request.target_save_slot = String(serialized_payload.get("target_save_slot", ""))
		request.idempotency_key = String(serialized_payload.get("idempotency_key", ""))
		request.force_timeout_seconds = float(serialized_payload.get("force_timeout_seconds", 5.0))
		request.timestamp_utc = int(serialized_payload.get("timestamp_utc", 0))
		request.save_before_quit = bool(serialized_payload.get("save_before_quit", true))
		request.require_save_success = bool(serialized_payload.get("require_save_success", false))
		request.force_quit = bool(serialized_payload.get("force_quit", false))
		return request


## 停机响应 DTO
class Response extends RefCounted:
	var success: bool = false
	var is_success: bool:
		get:
			return success
		set(value):
			success = value
	var error_code: String = "OK"
	var failed_stage: String = ""
	var current_phase: int = GameLifecycleModel.LifecyclePhase.STOPPED
	var is_save_completed: bool = false
	var save_sha256: String = ""
	var remaining_resources: Array[String] = []
	var retained_resources: Array[String] = []
	var timed_out_resources: Array[String] = []
	var timed_out_stages: Array[String] = []
	var unexecuted_resources: Array[String] = []
	var degraded_resources: Array[String] = []
	var stage_results: Array[Dictionary] = []
	var elapsed_milliseconds: int = 0

	## 序列化停机响应为字典（remaining_resources 副本）
	func to_dto() -> Dictionary:
		return {
			"success": success,
			"is_success": success,
			"error_code": error_code,
			"failed_stage": failed_stage,
			"current_phase": current_phase,
			"is_save_completed": is_save_completed,
			"save_sha256": save_sha256,
			"remaining_resources": remaining_resources.duplicate(),
			"retained_resources": retained_resources.duplicate(),
			"timed_out_resources": timed_out_resources.duplicate(),
			"timed_out_stages": timed_out_stages.duplicate(),
			"unexecuted_resources": unexecuted_resources.duplicate(),
			"degraded_resources": degraded_resources.duplicate(),
			"stage_results": stage_results.duplicate(true),
			"elapsed_milliseconds": elapsed_milliseconds
		}

	## 从字典重建停机响应（remaining_resources 逐元素转型）
	static func from_dto(serialized_payload: Dictionary) -> Response:
		var response := Response.new()
		response.success = bool(serialized_payload.get("success", false))
		response.error_code = String(serialized_payload.get("error_code", "OK"))
		response.failed_stage = String(serialized_payload.get("failed_stage", ""))
		response.current_phase = int(serialized_payload.get("current_phase", GameLifecycleModel.LifecyclePhase.STOPPED))
		response.is_save_completed = bool(serialized_payload.get("is_save_completed", false))
		response.save_sha256 = String(serialized_payload.get("save_sha256", ""))
		response.remaining_resources = _extract_string_array(serialized_payload.get("remaining_resources", []))
		response.retained_resources = _extract_string_array(serialized_payload.get("retained_resources", []))
		response.timed_out_resources = _extract_string_array(serialized_payload.get("timed_out_resources", []))
		response.timed_out_stages = _extract_string_array(serialized_payload.get("timed_out_stages", []))
		response.unexecuted_resources = _extract_string_array(serialized_payload.get("unexecuted_resources", []))
		response.degraded_resources = _extract_string_array(serialized_payload.get("degraded_resources", []))
		var raw_stage_results: Variant = serialized_payload.get("stage_results", [])
		if raw_stage_results is Array:
			var copied_results: Array = (raw_stage_results as Array).duplicate(true)
			for stage_result in copied_results:
				if stage_result is Dictionary:
					response.stage_results.append(stage_result as Dictionary)
		response.elapsed_milliseconds = int(serialized_payload.get("elapsed_milliseconds", 0))
		return response

	static func _extract_string_array(raw_entries: Variant) -> Array[String]:
		var string_entries: Array[String] = []
		if raw_entries is Array:
			for raw_entry in raw_entries:
				string_entries.append(String(raw_entry))
		return string_entries

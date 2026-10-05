# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/lifecycle/dto/game_shutdown_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/lifecycle.json | 信号: EventBus 领域广播
# 职责说明: 规范前后端及服务间退出指令交互的参数结构与序列化契约
# 设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

class_name GameShutdownDTO
extends RefCounted

const GameLifecycleModel = preload("res://backend/domains/lifecycle/lifecycle_model.gd")

## 停机请求 DTO
class Request extends RefCounted:
	var session_token: String = ""
	var account_id: String = ""
	var exit_reason: int = GameLifecycleModel.ExitReason.USER_DESKTOP_QUIT
	var target_save_slot: String = ""
	var idempotency_key: String = ""
	var force_timeout_seconds: float = 5.0
	var timestamp_utc: int = 0

	## 序列化停机请求为字典
	func to_dto() -> Dictionary:
		return {
			"session_token": session_token,
			"account_id": account_id,
			"exit_reason": exit_reason,
			"target_save_slot": target_save_slot,
			"idempotency_key": idempotency_key,
			"force_timeout_seconds": force_timeout_seconds,
			"timestamp_utc": timestamp_utc
		}

	## 从字典重建停机请求（缺省回退默认值）
	static func from_dto(data: Dictionary) -> Request:
		var req := Request.new()
		req.session_token = String(data.get("session_token", ""))
		req.account_id = String(data.get("account_id", ""))
		req.exit_reason = int(data.get("exit_reason", GameLifecycleModel.ExitReason.USER_DESKTOP_QUIT))
		req.target_save_slot = String(data.get("target_save_slot", ""))
		req.idempotency_key = String(data.get("idempotency_key", ""))
		req.force_timeout_seconds = float(data.get("force_timeout_seconds", 5.0))
		req.timestamp_utc = int(data.get("timestamp_utc", 0))
		return req


## 停机响应 DTO
class Response extends RefCounted:
	var success: bool = false
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
	static func from_dto(data: Dictionary) -> Response:
		var resp := Response.new()
		resp.success = bool(data.get("success", false))
		resp.error_code = String(data.get("error_code", "OK"))
		resp.failed_stage = String(data.get("failed_stage", ""))
		resp.current_phase = int(data.get("current_phase", GameLifecycleModel.LifecyclePhase.STOPPED))
		resp.is_save_completed = bool(data.get("is_save_completed", false))
		resp.save_sha256 = String(data.get("save_sha256", ""))
		resp.remaining_resources = _extract_string_array(data.get("remaining_resources", []))
		resp.retained_resources = _extract_string_array(data.get("retained_resources", []))
		resp.timed_out_resources = _extract_string_array(data.get("timed_out_resources", []))
		resp.timed_out_stages = _extract_string_array(data.get("timed_out_stages", []))
		resp.unexecuted_resources = _extract_string_array(data.get("unexecuted_resources", []))
		resp.degraded_resources = _extract_string_array(data.get("degraded_resources", []))
		var raw_stage_results: Variant = data.get("stage_results", [])
		if raw_stage_results is Array:
			var copied_results: Array = (raw_stage_results as Array).duplicate(true)
			for stage_result in copied_results:
				if stage_result is Dictionary:
					resp.stage_results.append(stage_result as Dictionary)
		resp.elapsed_milliseconds = int(data.get("elapsed_milliseconds", 0))
		return resp

	static func _extract_string_array(raw_values: Variant) -> Array[String]:
		var result: Array[String] = []
		if raw_values is Array:
			for value in raw_values:
				result.append(String(value))
		return result

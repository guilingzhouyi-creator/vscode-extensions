# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/lifecycle/dto/game_shutdown_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/lifecycle.json | 信号: EventBus 领域广播
# 职责说明: 规范前后端及服务间退出指令交互的参数结构与序列化契约
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
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
	var current_phase: int = GameLifecycleModel.LifecyclePhase.STOPPED
	var is_save_completed: bool = false
	var save_sha256: String = ""
	var remaining_resources: Array[String] = []
	var elapsed_milliseconds: int = 0

	## 序列化停机响应为字典（remaining_resources 副本）
	func to_dto() -> Dictionary:
		return {
			"success": success,
			"error_code": error_code,
			"current_phase": current_phase,
			"is_save_completed": is_save_completed,
			"save_sha256": save_sha256,
			"remaining_resources": remaining_resources.duplicate(),
			"elapsed_milliseconds": elapsed_milliseconds
		}

	## 从字典重建停机响应（remaining_resources 逐元素转型）
	static func from_dto(data: Dictionary) -> Response:
		var resp := Response.new()
		resp.success = bool(data.get("success", false))
		resp.error_code = String(data.get("error_code", "OK"))
		resp.current_phase = int(data.get("current_phase", GameLifecycleModel.LifecyclePhase.STOPPED))
		resp.is_save_completed = bool(data.get("is_save_completed", false))
		resp.save_sha256 = String(data.get("save_sha256", ""))
		var raw_res: Array = data.get("remaining_resources", [])
		resp.remaining_resources = []
		for r in raw_res:
			resp.remaining_resources.append(String(r))
		resp.elapsed_milliseconds = int(data.get("elapsed_milliseconds", 0))
		return resp

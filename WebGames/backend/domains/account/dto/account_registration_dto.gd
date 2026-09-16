# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/account/dto/account_registration_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/account.json | 信号: EventBus 领域广播
# 职责说明: 规范非游客正常注册的输入与输出数据载荷，屏蔽底层哈希细节。 安全红线：password_plain 仅存在于内存态 Request，严禁入广播/日志/存档。
# 设计依据: 业务域第一性原理 / Phase 02 施工细则规范
# ==============================================================================

class_name AccountRegistrationDTO
extends RefCounted

## 注册请求载荷（明文口令绝不序列化输出）
class Request extends RefCounted:
	var username: String = ""
	var password_plain: String = ""
	var device_fingerprint: String = ""
	var initial_entitlements: Array[String] = []

	func to_dto() -> Dictionary:
		return {
			"username": username,
			"device_fingerprint": device_fingerprint,
			"initial_entitlements": initial_entitlements.duplicate()
		}

	static func from_dto(data: Dictionary) -> Request:
		var req := Request.new()
		req.username = String(data.get("username", "")).strip_edges()
		req.password_plain = String(data.get("password_plain", ""))
		req.device_fingerprint = String(data.get("device_fingerprint", ""))
		var raw_ent = data.get("initial_entitlements", [])
		if raw_ent is Array:
			for item in raw_ent:
				req.initial_entitlements.append(String(item))
		return req

## 注册响应载荷（仅身份信息，无任何口令/哈希痕迹）
class Response extends RefCounted:
	var success: bool = false
	var error_code: String = "OK"
	var account_id: String = ""
	var username: String = ""
	var created_timestamp_utc: int = 0

	func to_dto() -> Dictionary:
		return {
			"success": success,
			"error_code": error_code,
			"account_id": account_id,
			"username": username,
			"created_timestamp_utc": created_timestamp_utc
		}

	static func from_dto(data: Dictionary) -> Response:
		var resp := Response.new()
		resp.success = bool(data.get("success", false))
		resp.error_code = String(data.get("error_code", "OK"))
		resp.account_id = String(data.get("account_id", ""))
		resp.username = String(data.get("username", ""))
		resp.created_timestamp_utc = int(data.get("created_timestamp_utc", 0))
		return resp

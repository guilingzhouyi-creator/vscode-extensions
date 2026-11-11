# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/account/dto/account_registration_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/account.json | 信号: EventBus 领域广播
# 职责说明: 规范非游客正常注册的输入与输出数据载荷，屏蔽底层哈希细节。 安全红线：password_plain 仅存在于内存态 Request，严禁入广播/日志/存档。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## AccountRegistrationDTO：Value Object DTO / Data Transport Model
class_name AccountRegistrationDTO
extends RefCounted

## 注册请求载荷（明文口令绝不序列化输出）
class Request extends RefCounted:
	var username: String = ""
	var password_plain: String = ""
	var device_fingerprint: String = ""
	var initial_entitlements: Array[String] = []

	## 重置内部数据状态，供对象池无堆分配复用
	func reset_state() -> void:
		username = ""
		password_plain = ""
		device_fingerprint = ""
		initial_entitlements.clear()

	## 序列化当前对象为通用字典传输结构
	func to_dto() -> Dictionary:
		return {
			"username": username,
			"device_fingerprint": device_fingerprint,
			"initial_entitlements": initial_entitlements.duplicate()
		}

	## 从输入字典填充注册请求基础字段（供子类复用，避免重复解析逻辑）
	static func populate_from_dict(req: Request, data: Dictionary) -> void:
		if req == null:
			return
		req.username = str(data.get("username", "")).strip_edges()
		req.password_plain = str(data.get("password_plain", ""))
		req.device_fingerprint = str(data.get("device_fingerprint", ""))
		var raw_ent: Variant = data.get("initial_entitlements", [])
		if raw_ent is Array:
			for item in (raw_ent as Array):
				req.initial_entitlements.append(str(item))

	## 从输入字典反序列化还原传输对象
	static func from_dto(data: Dictionary) -> Request:
		var req := Request.new()
		populate_from_dict(req, data)
		return req

## 注册响应载荷（仅身份信息，无任何口令/哈希痕迹）
class Response extends RefCounted:
	var success: bool = false
	var is_success: bool:
		get:
			return success
		set(val):
			success = val
	var error_code: String = "OK"
	var account_id: String = ""
	var username: String = ""
	var created_timestamp_utc: int = 0

	## 重置内部数据状态，供对象池无堆分配复用
	func reset_state() -> void:
		success = false
		error_code = "OK"
		account_id = ""
		username = ""
		created_timestamp_utc = 0

	## 序列化当前对象为通用字典传输结构
	func to_dto() -> Dictionary:
		return {
			"success": success,
			"is_success": success,
			"error_code": error_code,
			"account_id": account_id,
			"username": username,
			"created_timestamp_utc": created_timestamp_utc
		}

	## 从输入字典填充响应基础字段（供子类复用，避免重复反序列化）
	static func populate_from_dict(resp: Response, data: Dictionary) -> void:
		if resp == null:
			return
		resp.success = bool(data.get("success", false))
		resp.error_code = str(data.get("error_code", "OK"))
		resp.account_id = str(data.get("account_id", ""))
		resp.username = str(data.get("username", ""))
		resp.created_timestamp_utc = int(data.get("created_timestamp_utc", 0))

	## 从输入字典反序列化还原传输对象
	static func from_dto(data: Dictionary) -> Response:
		var resp := Response.new()
		populate_from_dict(resp, data)
		return resp

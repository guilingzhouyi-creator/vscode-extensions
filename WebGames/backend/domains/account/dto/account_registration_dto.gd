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
extends PoolableDtoBase

const PoolableDtoBase = preload("res://backend/domains/persistence_protocol/poolable_dto_base.gd")

## 注册请求载荷（明文口令绝不序列化输出）
class Request extends PoolableDtoBase:
	var username: String = ""
	var password_plain: String = ""
	var device_fingerprint: String = ""
	var initial_entitlements: Array[String] = []

	## 重置内部数据状态，供对象池无堆分配复用
	func reset_state() -> void:
		super.reset_state()
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
	static func populate_from_dict(request: Request, data: Dictionary) -> void:
		if request == null:
			return
		request.username = str(data.get("username", "")).strip_edges()
		request.password_plain = str(data.get("password_plain", ""))
		request.device_fingerprint = str(data.get("device_fingerprint", ""))
		var raw_entitlements: Variant = data.get("initial_entitlements", [])
		if raw_entitlements is Array:
			for item in (raw_entitlements as Array):
				request.initial_entitlements.append(str(item))

	## 从输入字典反序列化还原传输对象
	static func from_dto(data: Dictionary) -> Request:
		var request := Request.new()
		populate_from_dict(request, data)
		return request

## 注册响应载荷（仅身份信息，无任何口令/哈希痕迹）
class Response extends PoolableDtoBase:
	var success: bool = false
	var is_success: bool:
		get:
			return success
		set(value):
			success = value
	var error_code: String = "OK"
	var account_id: String = ""
	var username: String = ""
	var created_timestamp_utc: int = 0

	## 重置内部数据状态，供对象池无堆分配复用
	func reset_state() -> void:
		super.reset_state()
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
	static func populate_from_dict(response: Response, data: Dictionary) -> void:
		if response == null:
			return
		response.success = bool(data.get("success", false))
		response.error_code = str(data.get("error_code", "OK"))
		response.account_id = str(data.get("account_id", ""))
		response.username = str(data.get("username", ""))
		response.created_timestamp_utc = int(data.get("created_timestamp_utc", 0))

	## 从输入字典反序列化还原传输对象
	static func from_dto(data: Dictionary) -> Response:
		var response := Response.new()
		populate_from_dict(response, data)
		return response

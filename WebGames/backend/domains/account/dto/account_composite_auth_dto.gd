# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/account/dto/account_composite_auth_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: account | 配置: config/domains/account.json | 信号: EventBus 领域广播
# 职责说明: 规范注册与登录复合鉴权请求与响应数据载荷，支持自动注册与登录双模流转。
# 退出语义与设计依据: 业务领域第一性原理 / 复合鉴权与分流契约规范
# ==============================================================================

## AccountCompositeAuthDTO：Value Object DTO / Data Transport Model
class_name AccountCompositeAuthDTO
extends RefCounted

const BaseRegistrationDTO = preload("res://backend/domains/account/dto/account_registration_dto.gd")
const SaveSlotDTO = preload("res://backend/domains/account/save_slot_dto.gd")

const MODE_AUTO: String = "MODE_AUTO"
const MODE_LOGIN_ONLY: String = "MODE_LOGIN_ONLY"
const MODE_REGISTER_ONLY: String = "MODE_REGISTER_ONLY"

## 复合鉴权请求载荷（继承基础注册请求字段，扩展分流模式）
class Request extends BaseRegistrationDTO.Request:
	var action_mode: String = MODE_AUTO

	func _init(
		initial_username: String = "",
		initial_password_plain: String = "",
		initial_action_mode: String = MODE_AUTO,
		initial_device_fingerprint: String = ""
	) -> void:
		username = initial_username
		password_plain = initial_password_plain
		action_mode = initial_action_mode
		device_fingerprint = initial_device_fingerprint

	## 重置内部数据状态，供对象池无堆分配复用
	func reset_state() -> void:
		super.reset_state()
		action_mode = MODE_AUTO

	## 序列化当前对象为通用字典传输结构
	func to_dto() -> Dictionary:
		var payload: Dictionary = super.to_dto()
		payload["action_mode"] = action_mode
		return payload

	## 从输入字典反序列化还原传输对象
	static func from_dto(serialized_payload: Dictionary) -> Request:
		var request := Request.new()
		BaseRegistrationDTO.Request.populate_from_dict(request, serialized_payload)
		request.action_mode = str(serialized_payload.get("action_mode", MODE_AUTO))
		return request

## 复合鉴权响应载荷（继承基础注册响应字段，扩展会话与世界槽位摘要）
class Response extends BaseRegistrationDTO.Response:
	var session_token: String = ""
	var is_new_registration: bool = false
	var last_login_timestamp_utc: int = 0
	var save_slot_summaries: Dictionary = {}
	var world_state_ref: String = ""

	## 重置内部数据状态，供对象池无堆分配复用
	func reset_state() -> void:
		super.reset_state()
		session_token = ""
		is_new_registration = false
		last_login_timestamp_utc = 0
		save_slot_summaries.clear()
		world_state_ref = ""

	## 序列化当前对象为通用字典传输结构
	func to_dto() -> Dictionary:
		var serialized_slots: Dictionary = {}
		for slot_key in save_slot_summaries.keys():
			var slot_entry: Variant = save_slot_summaries[slot_key]
			if slot_entry is SaveSlotDTO:
				serialized_slots[slot_key] = (slot_entry as SaveSlotDTO).serialize()
			elif slot_entry is Dictionary:
				serialized_slots[slot_key] = slot_entry
		var payload: Dictionary = super.to_dto()
		payload["session_token"] = session_token
		payload["is_new_registration"] = is_new_registration
		payload["last_login_timestamp_utc"] = last_login_timestamp_utc
		payload["save_slot_summaries"] = serialized_slots
		payload["world_state_ref"] = world_state_ref
		return payload

	## 从输入字典反序列化还原传输对象
	static func from_dto(serialized_payload: Dictionary) -> Response:
		var response := Response.new()
		BaseRegistrationDTO.Response.populate_from_dict(response, serialized_payload)
		response.session_token = str(serialized_payload.get("session_token", ""))
		response.is_new_registration = bool(serialized_payload.get("is_new_registration", false))
		response.last_login_timestamp_utc = int(serialized_payload.get("last_login_timestamp_utc", 0))
		response.world_state_ref = str(serialized_payload.get("world_state_ref", ""))
		var raw_slots: Variant = serialized_payload.get("save_slot_summaries", {})
		if raw_slots is Dictionary:
			for slot_key in (raw_slots as Dictionary).keys():
				var slot_payload: Variant = (raw_slots as Dictionary)[slot_key]
				if slot_payload is Dictionary:
					response.save_slot_summaries[slot_key] = SaveSlotDTO.deserialize(slot_payload)
		return response

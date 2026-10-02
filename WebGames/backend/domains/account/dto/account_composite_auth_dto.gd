# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/account/dto/account_composite_auth_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: account | 配置: config/domains/account.json | 信号: EventBus 领域广播
# 职责说明: 规范注册与登录复合鉴权请求与响应数据载荷，支持自动注册与登录双模流转。
# 设计依据: 业务领域第一性原理 / 复合鉴权与分流契约规范
# ==============================================================================

class_name AccountCompositeAuthDTO
extends RefCounted

const SaveSlotSummaryDTO = preload("res://backend/domains/account/save_slot_dto.gd")

const MODE_AUTO: String = "MODE_AUTO"
const MODE_LOGIN_ONLY: String = "MODE_LOGIN_ONLY"
const MODE_REGISTER_ONLY: String = "MODE_REGISTER_ONLY"

## 复合鉴权请求载荷
class Request extends RefCounted:
	var username: String = ""
	var password_plain: String = ""
	var action_mode: String = MODE_AUTO
	var device_fingerprint: String = ""
	var initial_entitlements: Array[String] = []

	func _init(
		p_username: String = "",
		p_password_plain: String = "",
		p_action_mode: String = MODE_AUTO,
		p_device_fingerprint: String = ""
	) -> void:
		username = p_username
		password_plain = p_password_plain
		action_mode = p_action_mode
		device_fingerprint = p_device_fingerprint

	func reset_state() -> void:
		username = ""
		password_plain = ""
		action_mode = MODE_AUTO
		device_fingerprint = ""
		initial_entitlements.clear()

	func to_dto() -> Dictionary:
		return {
			"username": username,
			"action_mode": action_mode,
			"device_fingerprint": device_fingerprint,
			"initial_entitlements": initial_entitlements.duplicate()
		}

	static func from_dto(data: Dictionary) -> Request:
		var req := Request.new()
		req.username = String(data.get("username", "")).strip_edges()
		req.password_plain = String(data.get("password_plain", ""))
		req.action_mode = String(data.get("action_mode", MODE_AUTO))
		req.device_fingerprint = String(data.get("device_fingerprint", ""))
		var raw_ent = data.get("initial_entitlements", [])
		if raw_ent is Array:
			for item in raw_ent:
				req.initial_entitlements.append(String(item))
		return req

## 复合鉴权响应载荷
class Response extends RefCounted:
	var success: bool = false
	var error_code: String = "OK"
	var account_id: String = ""
	var username: String = ""
	var session_token: String = ""
	var is_new_registration: bool = false
	var created_timestamp_utc: int = 0
	var last_login_timestamp_utc: int = 0
	var save_slot_summaries: Dictionary = {}
	var world_state_ref: String = ""

	func reset_state() -> void:
		success = false
		error_code = "OK"
		account_id = ""
		username = ""
		session_token = ""
		is_new_registration = false
		created_timestamp_utc = 0
		last_login_timestamp_utc = 0
		save_slot_summaries.clear()
		world_state_ref = ""

	func to_dto() -> Dictionary:
		var slot_dicts: Dictionary = {}
		for k in save_slot_summaries.keys():
			var item = save_slot_summaries[k]
			if item is SaveSlotSummaryDTO:
				slot_dicts[k] = item.serialize()
			elif item is Dictionary:
				slot_dicts[k] = item
		return {
			"success": success,
			"error_code": error_code,
			"account_id": account_id,
			"username": username,
			"session_token": session_token,
			"is_new_registration": is_new_registration,
			"created_timestamp_utc": created_timestamp_utc,
			"last_login_timestamp_utc": last_login_timestamp_utc,
			"save_slot_summaries": slot_dicts,
			"world_state_ref": world_state_ref
		}

	static func from_dto(data: Dictionary) -> Response:
		var resp := Response.new()
		resp.success = bool(data.get("success", false))
		resp.error_code = String(data.get("error_code", "OK"))
		resp.account_id = String(data.get("account_id", ""))
		resp.username = String(data.get("username", ""))
		resp.session_token = String(data.get("session_token", ""))
		resp.is_new_registration = bool(data.get("is_new_registration", false))
		resp.created_timestamp_utc = int(data.get("created_timestamp_utc", 0))
		resp.last_login_timestamp_utc = int(data.get("last_login_timestamp_utc", 0))
		resp.world_state_ref = String(data.get("world_state_ref", ""))
		var raw_slots = data.get("save_slot_summaries", {})
		if raw_slots is Dictionary:
			for k in (raw_slots as Dictionary).keys():
				var slot_data: Variant = (raw_slots as Dictionary)[k]
				if slot_data is Dictionary:
					resp.save_slot_summaries[k] = SaveSlotSummaryDTO.deserialize(slot_data)
		return resp


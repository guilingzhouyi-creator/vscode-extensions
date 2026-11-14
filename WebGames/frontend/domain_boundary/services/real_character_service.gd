# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Services)
# 文件路径: res://frontend/domain_boundary/services/real_character_service.gd
# 架构定位: Domain Boundary Adapter / Real Character Service Bridge
# 依赖与触发: 上游: ServiceContainer, ServiceLocator | 下游: UnifiedProtocolDispatcher
# 职责说明: 实现 ICharacterService 接口，封装权威创角编排器与资质骰点协议动作，
#           通过 UnifiedProtocolDispatcher 触发实际存档落盘、装备实体挂载与序章上下文初始化。
# 退出语义与设计依据: 业务领域第一性原理 / 表现层零计算纪律 / 权威创角唯一真源
# ==============================================================================

## RealCharacterService：直连后端权威创角编排与命途预览的真实边界服务实现
class_name RealCharacterService
extends "res://frontend/domain_boundary/interfaces/i_character_service.gd"

const IAuthService = preload("res://frontend/domain_boundary/interfaces/i_auth_service.gd")
const RealProtocolBridge = preload("res://frontend/domain_boundary/services/real_protocol_bridge.gd")
const WorldSessionRuntimeService = preload("res://backend/domains/world_state/services/world_session_runtime_service.gd")

func _build_creation_payload(request_data: Dictionary) -> Dictionary:
	var char_name: String = str(request_data.get("name", request_data.get("character_name", ""))).strip_edges()
	var slot_index: int = int(request_data.get("slot_index", 0))
	if slot_index <= 0 and request_data.has("slot_id"):
		var raw_slot: String = str(request_data.get("slot_id", ""))
		var digits := raw_slot.to_int()
		slot_index = maxi(1, digits) if digits > 0 else 1
	if slot_index <= 0:
		slot_index = 1
	var request_payload: Dictionary = {
		"character_name": char_name,
		"slot_index": slot_index,
		"request_seed": int(request_data.get("request_seed", 0)),
		"extra_custom_fields": {
			"race": str(request_data.get("race", "HUMAN")),
			"class": str(request_data.get("class", "Novice")),
			"title_prefix": str(request_data.get("title_prefix", "")),
			"is_permadeath": bool(request_data.get("is_permadeath", false))
		}
	}
	var effective_world_id := str(request_data.get("world_id", WorldSessionRuntimeService.get_active_world_id())).strip_edges()
	if not effective_world_id.is_empty():
		request_payload["world_id"] = effective_world_id
	for optional_key in ["selected_origin_id", "selected_positive_trait", "selected_negative_trait", "reroll_nonce", "gender", "starter_kit_id"]:
		if request_data.has(optional_key):
			request_payload[optional_key] = request_data[optional_key]
	return request_payload

## 异步创建权威角色契约实现（对齐 CREATE_AUTHORITATIVE_CHARACTER）
func create_character_async(account_id: String, token: String, request_data: Dictionary, callback: Callable) -> void:
	RealProtocolBridge.dispatch_and_reply("character_creation", "CREATE_AUTHORITATIVE_CHARACTER", _build_creation_payload(request_data), account_id, token, callback)

## 异步资质骰点契约实现（兼容前端 8~18 预览点分布）
func roll_attributes_async(callback: Callable) -> void:
	if callback.is_valid():
		callback.call(IAuthService.build_preview_attribute_spread())

## 异步后端权威命途轮盘预览契约实现（对齐 ROLL_CHARACTER_PREVIEW）
func roll_destiny_preview_async(account_id: String, token: String, request_data: Dictionary, callback: Callable) -> void:
	RealProtocolBridge.dispatch_and_reply("character_creation", "ROLL_CHARACTER_PREVIEW", _build_creation_payload(request_data), account_id, token, callback)

## 异步获取创角只读 UI 适配快照（对齐 GET_CREATION_UI_SNAPSHOT）
func get_creation_ui_snapshot_async(account_id: String, token: String, callback: Callable) -> void:
	RealProtocolBridge.dispatch_and_reply("character_creation", "GET_CREATION_UI_SNAPSHOT", {}, account_id, token, callback)

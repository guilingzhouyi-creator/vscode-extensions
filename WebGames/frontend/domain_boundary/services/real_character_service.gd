# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Services)
# 文件路径: res://frontend/domain_boundary/services/real_character_service.gd
# 架构定位: Domain Boundary Adapter / Real Character Service Bridge
# 依赖与触发: 上游: ServiceContainer, ServiceLocator | 下游: UnifiedProtocolDispatcher
# 职责说明: 实现 ICharacterService 接口，封装权威创角编排器与资质骰点协议动作，
#           通过 UnifiedProtocolDispatcher 触发实际存档落盘、装备水化与序章上下文。
# 设计依据: 业务领域第一性原理 / 表现层零计算纪律 / 权威创角唯一真源
# ==============================================================================

class_name RealCharacterService
extends "res://frontend/domain_boundary/interfaces/i_character_service.gd"

const IAuthService = preload("res://frontend/domain_boundary/interfaces/i_auth_service.gd")
const UnifiedProtocolFactory = preload("res://backend/domains/world_state/services/unified_protocol_factory.gd")
const UnifiedProtocolDispatcher = preload("res://backend/domains/world_state/services/unified_protocol_dispatcher.gd")
const WorldSessionRuntimeService = preload("res://backend/domains/world_state/services/world_session_runtime_service.gd")

## 异步创建权威角色契约实现（对齐 CREATE_AUTHORITATIVE_CHARACTER）
func create_character_async(account_id: String, token: String, req_data: Dictionary, callback: Callable) -> void:
	var char_name: String = str(req_data.get("name", "")).strip_edges()
	var slot_index: int = int(req_data.get("slot_index", 1))
	if req_data.has("slot_id"):
		var raw_slot: String = str(req_data.get("slot_id", ""))
		if raw_slot.begins_with("SLOT_"):
			slot_index = int(raw_slot.trim_prefix("SLOT_"))
	var req_payload: Dictionary = {
		"character_name": char_name,
		"slot_index": slot_index,
		"world_id": str(req_data.get("world_id", WorldSessionRuntimeService.get_active_world_id())),
		"request_seed": int(req_data.get("request_seed", 20261110)),
		"extra_custom_fields": {
			"race": str(req_data.get("race", "HUMAN")),
			"class": str(req_data.get("class", "Novice")),
			"title_prefix": str(req_data.get("title_prefix", "")),
			"is_permadeath": bool(req_data.get("is_permadeath", false))
		}
	}
	var req := UnifiedProtocolFactory.create_human_request(
		"character_creation",
		"CREATE_AUTHORITATIVE_CHARACTER",
		req_payload,
		token,
		account_id
	)
	var resp := UnifiedProtocolDispatcher.dispatch_request(req)
	if callback.is_valid():
		callback.call({
			"success": resp.success,
			"error_code": resp.error_code,
			"message": resp.error_message,
			"data": resp.data
		})

## 异步资质骰点契约实现（复用前后端边界统一预览点分布）
func roll_attributes_async(callback: Callable) -> void:
	if callback.is_valid():
		callback.call(IAuthService.build_preview_attribute_spread())

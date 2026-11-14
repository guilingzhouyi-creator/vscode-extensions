# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Services)
# 文件路径: res://frontend/domain_boundary/services/real_protocol_bridge.gd
# 架构定位: Domain Boundary Shared Protocol Helper
# 依赖与触发: 上游: Real*Service 适配器 | 下游: UnifiedProtocolFactory, UnifiedProtocolDispatcher, WorldSessionRuntimeService
# 职责说明: 单源收敛人类 UI 统一协议请求信封构造、活跃凭据注入与异步回调分发，消除各服务适配器重复路由样板。
# 退出语义与设计依据: 卡拉尔领域边界单一路由原则与零逻辑重复规范
# ==============================================================================

## RealProtocolBridge：前端领域边界共享统一协议分发桥接器
class_name RealProtocolBridge
extends RefCounted

const UnifiedProtocolFactory = preload("res://backend/domains/world_state/services/unified_protocol_factory.gd")
const UnifiedProtocolDispatcher = preload("res://backend/domains/world_state/services/unified_protocol_dispatcher.gd")
const UnifiedResponseEnvelopeDTO = preload("res://backend/domains/world_state/dto/unified_response_envelope_dto.gd")
const WorldSessionRuntimeService = preload("res://backend/domains/world_state/services/world_session_runtime_service.gd")

## 构造人类 UI 请求信封并分发至后端统一协议调度器
static func dispatch_human(
	domain: String,
	action_type: String,
	request_payload: Dictionary,
	account_id: String,
	token: String,
	character_id: String = ""
) -> UnifiedResponseEnvelopeDTO:
	var effective_account_id := account_id if not account_id.is_empty() else WorldSessionRuntimeService.get_active_account_id()
	var effective_token := token if not token.is_empty() else WorldSessionRuntimeService.get_active_session_token()
	var effective_character_id := character_id if not character_id.is_empty() else WorldSessionRuntimeService.get_active_character_id()
	var request_envelope := UnifiedProtocolFactory.create_human_request(domain, action_type, request_payload, effective_token, effective_account_id, effective_character_id)
	return UnifiedProtocolDispatcher.dispatch_request(request_envelope)

## 基于显式凭证分发协议请求并按规范结构触发异步回调
static func dispatch_and_reply(
	domain: String,
	action_type: String,
	request_payload: Dictionary,
	account_id: String,
	token: String,
	result_callback: Callable,
	result_key: String = "data",
	fallback_value: Variant = {},
	character_id: String = ""
) -> void:
	var service_response := dispatch_human(domain, action_type, request_payload, account_id, token, character_id)
	reply_callback(result_callback, service_response, result_key, fallback_value)

## 自动读取当前活跃会话凭证（Account/Token/Character）分发动作用信封
static func dispatch_active_session(
	domain: String,
	action_type: String,
	extra_payload: Dictionary,
	result_callback: Callable,
	result_key: String = "data",
	fallback_value: Variant = {}
) -> void:
	var account_id := WorldSessionRuntimeService.get_active_account_id()
	var session_payload := {"account_id": account_id}
	if not extra_payload.is_empty():
		session_payload.merge(extra_payload, true)
	var service_response := dispatch_human(domain, action_type, session_payload, account_id, WorldSessionRuntimeService.get_active_session_token())
	reply_callback(result_callback, service_response, result_key, fallback_value)

## 将后端 UnifiedResponseEnvelopeDTO 统一解包为前端领域边界回调字典
static func reply_callback(
	result_callback: Callable,
	service_response: UnifiedResponseEnvelopeDTO,
	result_key: String = "data",
	fallback_value: Variant = {}
) -> void:
	if not result_callback.is_valid() or service_response == null:
		return
	var output_value: Variant = service_response.data
	if result_key != "data":
		output_value = service_response.data.get(result_key, fallback_value) if service_response.data is Dictionary else fallback_value
	result_callback.call({
		"success": service_response.success,
		"error_code": service_response.error_code,
		"message": service_response.error_message,
		result_key: output_value
	})

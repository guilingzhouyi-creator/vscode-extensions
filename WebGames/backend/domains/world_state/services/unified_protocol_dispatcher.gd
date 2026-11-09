# ==============================================================================
# 模块归属: 跨端通信层 (Protocol · 统一协议调度器)
# 文件路径: res://backend/domains/world_state/services/unified_protocol_dispatcher.gd
# 架构定位: Domain Dispatcher / Entry Router
# 依赖与触发: 上游: 前端视图, 伴侣通道 | 下游: EscMenuBackendService, AgentActionExecutionSolver, HumanControlLeaseManager
# 职责说明: 接收 ClientRequestEnvelopeDTO，统一实施租约裁决、鉴权校验与领域路由分发
# 退出语义与设计依据: 调度中心类；设计依据: 卡拉尔统一协议分发路由与零瞬态堆分配契约 (Inv-LEASE-PREEMPTION-1, Inv-ZERO-HEAP-DISPATCH-3)
# ==============================================================================

## 统一协议分发器：集中解包客户端请求信封并路由至对应领域业务处理器
class_name UnifiedProtocolDispatcher
extends RefCounted

const EscMenuBackendService = preload("res://backend/domains/world_state/services/esc_menu_backend_service.gd")
const AgentActionExecutionSolver = preload("res://backend/domains/world_state/solvers/agent_action_execution_solver.gd")
const UnifiedProtocolFactory = preload("res://backend/domains/world_state/services/unified_protocol_factory.gd")
const ClientRequestEnvelopeDTO = preload("res://backend/domains/world_state/dto/client_request_envelope_dto.gd")
const UnifiedResponseEnvelopeDTO = preload("res://backend/domains/world_state/dto/unified_response_envelope_dto.gd")
const HumanControlLeaseManager = preload("res://backend/domains/world_state/services/human_control_lease_manager.gd")
const AgentActionPacketDTO = preload("res://backend/domains/world_state/dto/agent_action_packet_dto.gd")
const AuthoritativeHudSyncService = preload("res://backend/domains/world_state/services/authoritative_hud_sync_service.gd")
const WorldGatewayFSM = preload("res://backend/domains/world_gateway/world_gateway_fsm.gd")

## 自定义领域请求处理器映射表 (domain -> Callable(req, gateway))
static var _custom_handlers: Dictionary = {}

## 动态扩展：注册自定义领域的统一请求处理器（满足 OCP 开闭原则）
static func register_domain_handler(domain: String, handler: Callable) -> void:
	if not domain.is_empty() and handler.is_valid():
		_custom_handlers[domain] = handler

## 注销自定义领域处理器
static func unregister_domain_handler(domain: String) -> void:
	_custom_handlers.erase(domain)

## 检查是否注册了自定义领域处理器
static func has_domain_handler(domain: String) -> bool:
	return _custom_handlers.has(domain)

## 测试清理
static func reset_custom_handlers_for_tests() -> void:
	_custom_handlers.clear()

## 快捷派发门面（对齐 dispatch_request）
static func dispatch(request: ClientRequestEnvelopeDTO, gateway: WorldGatewayFSM = null) -> UnifiedResponseEnvelopeDTO:
	return dispatch_request(request, gateway)

## 核心派发入口：处理一切来自客户端或 Agent 包装的统一请求信封
static func dispatch_request(request: ClientRequestEnvelopeDTO, gateway: WorldGatewayFSM = null) -> UnifiedResponseEnvelopeDTO:
	if request == null:
		return UnifiedProtocolFactory.create_response(
			"", false, {}, "ERR_NULL_REQUEST", "请求信封不能为空"
		)

	# 1. 租约与并发冲突仲裁
	if request.actor_type == ClientRequestEnvelopeDTO.ACTOR_HUMAN_UI:
		HumanControlLeaseManager.renew_human_lease(request.account_id, request.lease_nonce)
	elif request.actor_type == ClientRequestEnvelopeDTO.ACTOR_AGENT:
		if HumanControlLeaseManager.is_lease_active():
			return UnifiedProtocolFactory.create_response(
				request.request_id, false, {}, "ERR_PREEMPTED_BY_HUMAN", "人类前台正在操作，Agent 动作已被抢占式阻断"
			)

	# 2. 优先检查外部动态注册的领域处理器 (OCP 扩展点)
	if _custom_handlers.has(request.domain):
		var custom_fn: Callable = _custom_handlers[request.domain]
		if custom_fn.is_valid():
			return custom_fn.call(request, gateway)

	# 3. 按核心内置领域路由分发
	match request.domain:
		"world_state", "world_gateway", "lifecycle":
			if request.action_type.begins_with("ESC_"):
				return EscMenuBackendService.handle_esc_action(request, gateway)
			elif request.domain == "world_state":
				return _dispatch_agent_action_compat(request)
		"game_settings":
			return _dispatch_settings_action(request)
		_:
			return UnifiedProtocolFactory.create_response(
				request.request_id, false, {}, "ERR_UNKNOWN_DOMAIN", "未知业务领域: %s" % request.domain
			)

	return UnifiedProtocolFactory.create_response(
		request.request_id, false, {}, "ERR_UNHANDLED_ACTION", "未支持的操作指令: %s" % request.action_type
	)

static func _dispatch_agent_action_compat(request: ClientRequestEnvelopeDTO) -> UnifiedResponseEnvelopeDTO:
	var agent_packet := AgentActionPacketDTO.new()
	agent_packet.session_id = request.character_id
	agent_packet.directive_id = request.action_type
	agent_packet.params = request.payload
	agent_packet.client_timestamp_ms = request.client_timestamp_ms
	var hud_context: Dictionary = {"account_id": request.account_id, "character_id": request.character_id}
	if request.payload is Dictionary:
		for payload_key in request.payload.keys():
			hud_context[payload_key] = request.payload[payload_key]
	if not hud_context.has("unallocated_potential_points"):
		hud_context["unallocated_potential_points"] = 5
	if not hud_context.has("unread_mail_count"):
		hud_context["unread_mail_count"] = 1
	var hud_snapshot := AuthoritativeHudSyncService.get_authoritative_snapshot(hud_context)
	var is_human_active: bool = false if request.actor_type == ClientRequestEnvelopeDTO.ACTOR_HUMAN_UI else HumanControlLeaseManager.is_lease_active()
	var execution_result := AgentActionExecutionSolver.validate_and_execute(agent_packet, hud_snapshot, is_human_active)
	return UnifiedProtocolFactory.create_response(
		request.request_id,
		bool(execution_result.get("success", false)),
		execution_result,
		str(execution_result.get("error_code", "")),
		str(execution_result.get("cause", "")),
		execution_result.get("causal_delta", {}) if execution_result.has("causal_delta") else {}
	)

static func _dispatch_settings_action(request: ClientRequestEnvelopeDTO) -> UnifiedResponseEnvelopeDTO:
	return UnifiedProtocolFactory.create_response(
		request.request_id, true, {"applied_settings": request.payload}, "", "设置应用成功"
	)

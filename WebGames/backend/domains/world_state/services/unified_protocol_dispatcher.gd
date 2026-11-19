# ==============================================================================
# 模块归属: 跨端通信层 (Protocol · 统一协议调度器)
# 文件路径: res://backend/domains/world_state/services/unified_protocol_dispatcher.gd
# 架构定位: Domain Dispatcher / Entry Router
# 依赖与触发: 上游: 前端视图, 伴侣通道 | 下游: AuthService, WorldGatewayFSM, EscMenuBackendService, WorldSessionRuntimeService, GameLifecycleService
# 职责说明: 接收 ClientRequestEnvelopeDTO，统一实施会话令牌守卫、人类租约仲裁与全 7 域 11 环路由分发。
# 退出语义与设计依据: 调度中心类；设计依据: 卡拉尔统一协议分发路由与端到端交互契约 (Inv-LEASE-PREEMPTION-1, Inv-FE-BE-CONTRACT-1)
# ==============================================================================

## UnifiedProtocolDispatcher：集中解包客户端请求信封，执行令牌与租约裁决并路由至对应业务处理器
class_name UnifiedProtocolDispatcher
extends RefCounted

const DOMAIN_WORLD_STATE_CONFIG: String = "domains.world_state"
const PROTECTED_GATEWAY_ACTIONS: Array[String] = [
	"ENTER_GATEWAY", "PROBE_MODES", "LIST_WORLDS", "SELECT_MODE",
	"SELECT_OR_CREATE_WORLD", "ATTACH_READY_CHARACTER", "ENTER_WORLD",
	"DISCOVER_MODS", "PRECHECK_MODS", "LIST_REMOTE_REALMS", "DELETE_WORLD",
	"EXIT_WORLD_TO_GATEWAY", "SWITCH_GATEWAY_MODE"
]

## 自定义领域请求处理器映射表 (domain -> Callable(request, gateway))
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

## 测试清理（含动态处理器与运行时会话上下文）
static func reset_custom_handlers_for_tests() -> void:
	_custom_handlers.clear()

## 快捷派发门面（对齐 dispatch_request）
static func dispatch(request: ClientRequestEnvelopeDTO, gateway: WorldGatewayFSM = null) -> UnifiedResponseEnvelopeDTO:
	return dispatch_request(request, gateway)

## 核心派发入口：处理一切来自客户端或 Agent 包装的统一请求信封
static func dispatch_request(request: ClientRequestEnvelopeDTO, gateway: WorldGatewayFSM = null) -> UnifiedResponseEnvelopeDTO:
	if request == null:
		return UnifiedProtocolFactory.create_response(
			"", false, {}, "ERR_NULL_REQUEST", "Request envelope cannot be null"
		)

	# 1. 租约与并发冲突仲裁
	if request.actor_type == ClientRequestEnvelopeDTO.ACTOR_HUMAN_UI:
		HumanControlLeaseManager.renew_human_lease(request.account_id, request.lease_nonce)
	elif request.actor_type == ClientRequestEnvelopeDTO.ACTOR_AGENT:
		if HumanControlLeaseManager.is_lease_active():
			return UnifiedProtocolFactory.create_response(
				request.request_id, false, {}, "ERR_PREEMPTED_BY_HUMAN", "Human operator is active; Agent action was preemptively blocked"
			)

	# 2. 会话凭据与撤销令牌防线（拦截已注销/过期令牌及受保护域越权）
	var auth_block := _enforce_auth_guard(request)
	if auth_block != null:
		return auth_block

	# 3. 优先检查外部动态注册的领域处理器 (OCP 扩展点)
	if _custom_handlers.has(request.domain):
		var custom_handler: Callable = _custom_handlers[request.domain]
		if custom_handler.is_valid():
			return custom_handler.call(request, gateway)

	var effective_gateway: WorldGatewayFSM = gateway if gateway != null else (WorldSessionRuntimeService.get_gateway() as WorldGatewayFSM)

	# 4. 按核心 7 域路由分发全 11 环请求
	match request.domain:
		"account":
			return AccountProtocolHandler.dispatch(request, effective_gateway)
		"world_gateway":
			return WorldGatewayProtocolHandler.dispatch(request, effective_gateway)
		"character_creation":
			return CharacterCreationProtocolHandler.dispatch_creation(request, effective_gateway)
		"prologue":
			return CharacterCreationProtocolHandler.dispatch_prologue(request, effective_gateway)
		"world_state":
			return _dispatch_world_state_action(request, effective_gateway)
		"lifecycle":
			return LifecycleProtocolHandler.dispatch(request, effective_gateway)
		"game_settings":
			return _dispatch_settings_action(request)
		"combat", "economy", "gacha", "quest", "crafting", "grimoire", "monster_ecology", "world_navigation":
			return GameplayDomainProtocolHandler.dispatch(request)
		"mail", "guild", "misc_edge", "system_save", "gm_command":
			return GameplaySocialProtocolHandler.dispatch(request)
		_:
			return UnifiedProtocolFactory.create_response(
				request.request_id, false, {}, "ERR_UNKNOWN_DOMAIN",
				TemplateFormatter.format("Unknown domain: {domain}", {"domain": request.domain})
			)

# ==============================================================================
# 会话鉴权门禁与令牌核验
# ==============================================================================

static var _auth_policy_version: int = -1
static var _cached_unauthorized_error_code: String = "ERR_UNAUTHORIZED"
static var _cached_anonymous_actions_set: Dictionary = {}
static var _cached_require_session_auth: bool = true

static func _sync_auth_policy_cache() -> void:
	var current_version: int = GameConfig.config_reload_version()
	if _auth_policy_version == current_version:
		return
	_cached_unauthorized_error_code = GameConfig.get_string(DOMAIN_WORLD_STATE_CONFIG, "dispatcher/errors/unauthorized", "ERR_UNAUTHORIZED")
	_cached_require_session_auth = GameConfig.get_bool(DOMAIN_WORLD_STATE_CONFIG, "dispatcher/require_session_auth", true)
	_cached_anonymous_actions_set.clear()
	var allowed_actions: Array = GameConfig.get_array(DOMAIN_WORLD_STATE_CONFIG, "dispatcher/anonymous_allowed_actions", [])
	for action_entry in allowed_actions:
		_cached_anonymous_actions_set[str(action_entry)] = true
	_auth_policy_version = current_version

static func _enforce_auth_guard(request: ClientRequestEnvelopeDTO) -> UnifiedResponseEnvelopeDTO:
	_sync_auth_policy_cache()
	var is_anonymous_action := _cached_anonymous_actions_set.has(request.action_type)

	if _is_agent_blocked_request(request):
		return UnifiedProtocolFactory.create_response(
			request.request_id, false, {}, "ERR_AGENT_PRIVILEGE_BLOCKED", "Agent actor is prohibited from executing account or gateway mutation directives"
		)

	if is_anonymous_action:
		return null

	var session_check := AuthService.validate_session_request(request.session_token, request.account_id, _cached_require_session_auth)
	if bool(session_check.get("revoked_or_expired", false)):
		return UnifiedProtocolFactory.create_response(
			request.request_id, false, {"revoked": true}, _cached_unauthorized_error_code, "Session token revoked or expired, access denied"
		)
	if not _cached_require_session_auth:
		return null
	if not bool(session_check.get("success", false)):
		return UnifiedProtocolFactory.create_response(
			request.request_id, false, session_check, _cached_unauthorized_error_code, "Protected business requests must provide a valid authenticated session token"
		)
	if request.account_id.is_empty():
		request.account_id = String(session_check.get("account_id", ""))
	return null

static func _is_agent_blocked_request(request: ClientRequestEnvelopeDTO) -> bool:
	if request.actor_type != ClientRequestEnvelopeDTO.ACTOR_AGENT:
		return false
	if PROTECTED_GATEWAY_ACTIONS.has(request.action_type):
		return true
	return request.domain in ["account", "lifecycle", "character_creation", "prologue", "game_settings"]

# ==============================================================================
# 各领域路由分派实现 (Link 1 ~ Link 11)
# ==============================================================================

static func _dispatch_world_state_action(request: ClientRequestEnvelopeDTO, gateway: WorldGatewayFSM) -> UnifiedResponseEnvelopeDTO:
	if request.action_type.begins_with("ESC_"):
		return EscMenuBackendService.handle_esc_action(request, gateway)
	if request.action_type == "PULL_HUD_SNAPSHOT":
		var authoritative_snapshot := WorldSessionRuntimeService.pull_authoritative_hud_snapshot()
		return UnifiedProtocolFactory.create_response(
			request.request_id, true, {
				"hud_snapshot": authoritative_snapshot.to_dto(),
				"world_active": WorldSessionRuntimeService.has_active_world()
			}, "", "Home HUD authoritative snapshot retrieved successfully"
		)
	if request.action_type == "TICK_WORLD_CLOCK":
		var request_payload: Dictionary = request.payload if request.payload is Dictionary else {}
		var updated_snapshot := WorldSessionRuntimeService.apply_mutation_and_sync(request_payload, int(request_payload.get("now_ms", -1)), bool(request_payload.get("force_push", true)))
		return UnifiedProtocolFactory.create_response(
			request.request_id, true, {"hud_snapshot": updated_snapshot.to_dto()}, "", "World clock and resident HUD synchronized successfully"
		)
	return _dispatch_agent_action(request)

static func _dispatch_agent_action(request: ClientRequestEnvelopeDTO) -> UnifiedResponseEnvelopeDTO:
	var agent_packet := AgentActionPacketDTO.new()
	agent_packet.session_id = request.character_id
	agent_packet.directive_id = request.action_type
	agent_packet.params = request.payload
	agent_packet.client_timestamp_ms = request.client_timestamp_ms

	var is_active_world := WorldSessionRuntimeService.has_active_world()
	var hud_context: Dictionary = WorldSessionRuntimeService.build_live_hud_context() if is_active_world else {}
	if not request.account_id.is_empty():
		hud_context["account_id"] = request.account_id
	if not request.character_id.is_empty():
		hud_context["character_id"] = request.character_id
	if request.payload is Dictionary:
		for payload_key in request.payload.keys():
			hud_context[payload_key] = request.payload[payload_key]

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
	return GameSettingsProtocolHandler.dispatch(request)

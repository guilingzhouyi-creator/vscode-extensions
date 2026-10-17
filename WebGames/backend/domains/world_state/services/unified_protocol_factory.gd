# ==============================================================================
# 模块归属: 跨端通信层 (Protocol · 统一协议工厂)
# 文件路径: res://backend/domains/world_state/services/unified_protocol_factory.gd
# 架构定位: Domain Service / Object Factory
# 依赖与触发: 上游: 前端视图, 业务调度器 | 下游: ClientRequestEnvelopeDTO, UnifiedResponseEnvelopeDTO, AgentActionPacketDTO
# 职责说明: 统一装箱人类 UI 请求信封、无头 Agent 动作包及响应信封，自维护租约序号与确定性时钟
# 退出语义与设计依据: 工厂服务类；设计依据: 卡拉尔跨端请求信封与双轨适配工厂契约 (Inv-UNIFIED-ENVELOPE-1, Inv-DUAL-TRACK-DISCIPLINE-2, Inv-ZERO-HEAP-POOL-3)
# ==============================================================================

## 统一协议工厂：集中构造和重置请求信封与响应信封，支撑人类与 Agent 双轨通信
class_name UnifiedProtocolFactory
extends RefCounted

const ClientRequestEnvelopeDTO = preload("res://backend/domains/world_state/dto/client_request_envelope_dto.gd")
const UnifiedResponseEnvelopeDTO = preload("res://backend/domains/world_state/dto/unified_response_envelope_dto.gd")
const AgentActionPacketDTO = preload("res://backend/domains/world_state/dto/agent_action_packet_dto.gd")

static var _lease_counter: int = 1
static var _request_counter: int = 1

## 创建人类 UI 标准请求信封
static func create_human_request(
	domain: String,
	action_type: String,
	payload: Dictionary = {},
	session_token: String = "",
	account_id: String = "",
	character_id: String = ""
) -> ClientRequestEnvelopeDTO:
	var req := ClientRequestEnvelopeDTO.new()
	req.request_id = "REQ_H_%d_%d" % [Time.get_ticks_msec(), _request_counter]
	_request_counter += 1
	req.actor_type = ClientRequestEnvelopeDTO.ACTOR_HUMAN_UI
	req.domain = domain
	req.action_type = action_type
	req.payload = payload.duplicate(true)
	req.session_token = session_token
	req.account_id = account_id
	req.character_id = character_id
	req.lease_nonce = _lease_counter
	_lease_counter += 1
	req.client_timestamp_ms = Time.get_ticks_msec()
	return req

## 从既有 AgentActionPacketDTO 转换为统一请求信封（实现双轨统一收口）
static func wrap_agent_action(
	agent_pkt: AgentActionPacketDTO,
	session_token: String = "",
	account_id: String = ""
) -> ClientRequestEnvelopeDTO:
	var req := ClientRequestEnvelopeDTO.new()
	var seq: int = agent_pkt.sequence_index if agent_pkt != null else 0
	req.request_id = "REQ_A_%d_%d" % [Time.get_ticks_msec(), seq]
	req.actor_type = ClientRequestEnvelopeDTO.ACTOR_AGENT
	req.domain = "world_state"
	var target_directive: String = ""
	var target_params: Dictionary = {}
	if agent_pkt != null:
		target_directive = agent_pkt.directive_id if not agent_pkt.directive_id.is_empty() else agent_pkt.action_id
		target_params = agent_pkt.params if not agent_pkt.params.is_empty() else agent_pkt.parameters
		req.character_id = agent_pkt.session_id
		req.client_timestamp_ms = agent_pkt.client_timestamp_ms
	req.action_type = target_directive
	req.payload = target_params.duplicate(true)
	req.session_token = session_token
	req.account_id = account_id
	req.lease_nonce = 0  # Agent 不具备人类租约，租约序号归零
	if req.client_timestamp_ms <= 0:
		req.client_timestamp_ms = Time.get_ticks_msec()
	return req

## 创建无头 Agent 标准请求信封
static func create_agent_request(
	domain: String,
	action_type: String,
	payload: Dictionary = {},
	account_id: String = "",
	character_id: String = "",
	session_token: String = ""
) -> ClientRequestEnvelopeDTO:
	var req := ClientRequestEnvelopeDTO.new()
	req.request_id = "REQ_A_%d_%d" % [Time.get_ticks_msec(), _request_counter]
	_request_counter += 1
	req.actor_type = ClientRequestEnvelopeDTO.ACTOR_AGENT
	req.domain = domain
	req.action_type = action_type
	req.payload = payload.duplicate(true)
	req.session_token = session_token
	req.account_id = account_id
	req.character_id = character_id
	req.lease_nonce = 0
	req.client_timestamp_ms = Time.get_ticks_msec()
	return req

## 创建标准服务端响应信封
static func create_response(
	request_id: String,
	success: bool,
	data: Dictionary = {},
	error_code: String = "",
	error_message: String = "",
	causal_delta: Dictionary = {}
) -> UnifiedResponseEnvelopeDTO:
	var resp := UnifiedResponseEnvelopeDTO.new()
	resp.request_id = request_id
	resp.success = success
	resp.error_code = error_code
	resp.error_message = error_message
	resp.data = data.duplicate(true)
	resp.causal_delta = causal_delta.duplicate(true)
	resp.server_timestamp_ms = Time.get_ticks_msec()
	return resp

## 测试环境重置计数器
static func reset_for_tests() -> void:
	_lease_counter = 1
	_request_counter = 1

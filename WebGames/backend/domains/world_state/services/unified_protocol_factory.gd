# ==============================================================================
# 模块归属: 跨端通信层 (Protocol · 统一协议工厂)
# 文件路径: res://backend/domains/world_state/services/unified_protocol_factory.gd
# 架构定位: Domain Service / Object Factory
# 依赖与触发: 上游: 前端视图, 业务调度器 | 下游: ClientRequestEnvelopeDTO, UnifiedResponseEnvelopeDTO, AgentActionPacketDTO
# 职责说明: 统一装箱人类 UI 请求信封、无头 Agent 动作包及响应信封，自维护租约序号与确定性时钟
# 退出语义与设计依据: 工厂服务类；设计依据: 卡拉尔跨端请求信封与双通道适配工厂契约 (Inv-UNIFIED-ENVELOPE-1, Inv-DUAL-TRACK-DISCIPLINE-2, Inv-ZERO-HEAP-POOL-3)
# ==============================================================================

## UnifiedProtocolFactory：集中构造和重置请求信封与响应信封，支撑人类与 Agent 双通道通信
class_name UnifiedProtocolFactory
extends RefCounted

const MAX_POOLED_ENVELOPES: int = 32

static var _lease_counter: int = 1
static var _request_counter: int = 1
static var _request_pool: Array[ClientRequestEnvelopeDTO] = []
static var _response_pool: Array[UnifiedResponseEnvelopeDTO] = []
static var _request_borrowed_count: int = 0
static var _response_borrowed_count: int = 0

## 从对象池借出请求信封（ADV-PRF-002：高频调用零瞬态堆分配）
static func borrow_request_envelope() -> ClientRequestEnvelopeDTO:
	_request_borrowed_count += 1
	if not _request_pool.is_empty():
		var reused: ClientRequestEnvelopeDTO = _request_pool.pop_back()
		reused.reset_state()
		return reused
	return ClientRequestEnvelopeDTO.new()

## 归还请求信封至对象池并彻底复位
static func recycle_request_envelope(request: ClientRequestEnvelopeDTO) -> void:
	if request == null:
		return
	request.reset_state()
	if _request_borrowed_count > 0:
		_request_borrowed_count -= 1
	if _request_pool.size() < MAX_POOLED_ENVELOPES:
		_request_pool.append(request)

## 从对象池借出响应信封（ADV-PRF-002）
static func borrow_response_envelope() -> UnifiedResponseEnvelopeDTO:
	_response_borrowed_count += 1
	if not _response_pool.is_empty():
		var reused: UnifiedResponseEnvelopeDTO = _response_pool.pop_back()
		reused.reset_state()
		return reused
	return UnifiedResponseEnvelopeDTO.new()

## 归还响应信封至对象池并彻底复位
static func recycle_response_envelope(response: UnifiedResponseEnvelopeDTO) -> void:
	if response == null:
		return
	response.reset_state()
	if _response_borrowed_count > 0:
		_response_borrowed_count -= 1
	if _response_pool.size() < MAX_POOLED_ENVELOPES:
		_response_pool.append(response)

## 查询信封对象池借还遥测统计（校验借还严格守恒）
static func get_pool_stats() -> Dictionary:
	return {
		"req_borrowed": _request_borrowed_count,
		"resp_borrowed": _response_borrowed_count,
		"req_pooled": _request_pool.size(),
		"resp_pooled": _response_pool.size()
	}

## 创建人类 UI 标准请求信封
static func create_human_request(
	domain: String,
	action_type: String,
	payload: Dictionary = {},
	session_token: String = "",
	account_id: String = "",
	character_id: String = ""
) -> ClientRequestEnvelopeDTO:
	return _build_request_envelope(
		ClientRequestEnvelopeDTO.ACTOR_HUMAN_UI, domain, action_type, payload, session_token, account_id, character_id
	)

## 从既有 AgentActionPacketDTO 转换为统一请求信封（实现双通道统一收口）
static func wrap_agent_action(
	agent_packet: AgentActionPacketDTO,
	session_token: String = "",
	account_id: String = ""
) -> ClientRequestEnvelopeDTO:
	var request := ClientRequestEnvelopeDTO.new()
	var sequence_index: int = agent_packet.sequence_index if agent_packet != null else 0
	request.request_id = "REQ_A_%d_%d" % [Time.get_ticks_msec(), sequence_index]
	request.actor_type = ClientRequestEnvelopeDTO.ACTOR_AGENT
	request.domain = "world_state"
	var target_directive: String = ""
	var target_parameters: Dictionary = {}
	if agent_packet != null:
		target_directive = agent_packet.directive_id if not agent_packet.directive_id.is_empty() else agent_packet.action_id
		target_parameters = agent_packet.params if not agent_packet.params.is_empty() else agent_packet.parameters
		request.character_id = agent_packet.session_id
		request.client_timestamp_ms = agent_packet.client_timestamp_ms
	request.action_type = target_directive
	request.payload = target_parameters.duplicate(true)
	request.session_token = session_token
	request.account_id = account_id
	request.lease_nonce = 0  # Agent 不具备人类租约，租约序号归零
	if request.client_timestamp_ms <= 0:
		request.client_timestamp_ms = Time.get_ticks_msec()
	return request

## 创建无头 Agent 标准请求信封
static func create_agent_request(
	domain: String,
	action_type: String,
	payload: Dictionary = {},
	account_id: String = "",
	character_id: String = "",
	session_token: String = ""
) -> ClientRequestEnvelopeDTO:
	return _build_request_envelope(
		ClientRequestEnvelopeDTO.ACTOR_AGENT, domain, action_type, payload, session_token, account_id, character_id
	)

static func _build_request_envelope(
	actor_type: String,
	domain: String,
	action_type: String,
	payload: Dictionary,
	session_token: String,
	account_id: String,
	character_id: String
) -> ClientRequestEnvelopeDTO:
	var is_human: bool = (actor_type == ClientRequestEnvelopeDTO.ACTOR_HUMAN_UI)
	var id_prefix: String = "REQ_H" if is_human else "REQ_A"
	var request := ClientRequestEnvelopeDTO.new()
	request.request_id = "%s_%d_%d" % [id_prefix, Time.get_ticks_msec(), _request_counter]
	_request_counter += 1
	request.actor_type = actor_type
	request.domain = domain
	request.action_type = action_type
	request.payload = payload.duplicate(true)
	request.session_token = session_token
	request.account_id = account_id
	request.character_id = character_id
	if is_human:
		request.lease_nonce = _lease_counter
		_lease_counter += 1
	else:
		request.lease_nonce = 0
	request.client_timestamp_ms = Time.get_ticks_msec()
	return request

## 创建标准服务端响应信封
static func create_response(
	request_id: String,
	is_succeeded: bool,
	response_payload: Dictionary = {},
	error_code: String = "",
	error_message: String = "",
	causal_delta: Dictionary = {}
) -> UnifiedResponseEnvelopeDTO:
	var response := UnifiedResponseEnvelopeDTO.new()
	response.request_id = request_id
	response.success = is_succeeded
	response.error_code = error_code
	response.error_message = error_message
	response.data = response_payload.duplicate(true)
	response.causal_delta = causal_delta.duplicate(true)
	response.server_timestamp_ms = Time.get_ticks_msec()
	return response

## 创建未处理动作的标准错误响应信封
static func create_unhandled_action_response(request_id: String, action_type: String) -> UnifiedResponseEnvelopeDTO:
	var error_message := TemplateFormatter.format("Unsupported action instruction: {action_type}.", {"action_type": action_type})
	return create_response(request_id, false, {}, "ERR_UNHANDLED_ACTION", error_message)

## 测试环境重置计数器与信封对象池
static func reset_for_tests() -> void:
	_lease_counter = 1
	_request_counter = 1
	_request_pool.clear()
	_response_pool.clear()
	_request_borrowed_count = 0
	_response_borrowed_count = 0

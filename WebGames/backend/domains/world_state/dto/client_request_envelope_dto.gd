# ==============================================================================
# 模块归属: 跨端通信层 (Protocol · 通用客户端请求信封)
# 文件路径: res://backend/domains/world_state/dto/client_request_envelope_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 依赖与触发: 上游: UnifiedProtocolFactory, 前端视图 | 下游: UnifiedProtocolDispatcher
# 职责说明: 规范全域前端（人类 UI 与外部输入）向后端发起的请求封包格式，携带会话、实体动作、参数与时间戳
# 退出语义与设计依据: 纯数据模型无退出码；设计依据: 卡拉尔客户端统一协议信封规范与零堆分配对象池契约 (Inv-UNIFIED-ENVELOPE-1, Inv-ZERO-HEAP-POOL-3)
# ==============================================================================

## 客户端统一请求信封 DTO：封装客户端请求元数据与业务参数
class_name ClientRequestEnvelopeDTO
extends RefCounted

const ACTOR_HUMAN_UI: String = "HUMAN_UI"
const ACTOR_AGENT: String = "AGENT"

var request_id: String = ""              # 请求唯一序号 (UUID 或 时间戳派生)
var session_token: String = ""           # 当前有效登录态令牌
var account_id: String = ""              # 操作所属账号 ID
var character_id: String = ""            # 当前绑定的角色 ID (可选)
var actor_type: String = ACTOR_HUMAN_UI  # 操作主体: HUMAN_UI | AGENT
var domain: String = ""                  # 目标领域: world_gateway | world_state | lifecycle | game_settings 等
var action_type: String = ""             # 具体操作指令: SAVE_GAME | EXIT_TO_GATEWAY | QUIT_GAME | APPLY_SETTINGS 等
var payload: Dictionary = {}             # 强类型业务参数载荷
var lease_nonce: int = 0                 # 人类控制租约流水号
var client_timestamp_ms: int = 0         # 客户端发射时毫秒时间戳

## 重置内部数据状态，供对象池无堆分配复用
func reset_state() -> void:
	request_id = ""
	session_token = ""
	account_id = ""
	character_id = ""
	actor_type = ACTOR_HUMAN_UI
	domain = ""
	action_type = ""
	payload.clear()
	lease_nonce = 0
	client_timestamp_ms = 0

## 序列化当前对象为通用字典传输结构
func to_dto() -> Dictionary:
	return {
		"request_id": request_id,
		"session_token": session_token,
		"account_id": account_id,
		"character_id": character_id,
		"actor_type": actor_type,
		"domain": domain,
		"action_type": action_type,
		"payload": payload.duplicate(true),
		"lease_nonce": lease_nonce,
		"client_timestamp_ms": client_timestamp_ms
	}

## 从输入字典反序列化还原传输对象
static func from_dto(data: Dictionary) -> ClientRequestEnvelopeDTO:
	var req := ClientRequestEnvelopeDTO.new()
	req.request_id = str(data.get("request_id", ""))
	req.session_token = str(data.get("session_token", ""))
	req.account_id = str(data.get("account_id", ""))
	req.character_id = str(data.get("character_id", ""))
	req.actor_type = str(data.get("actor_type", ACTOR_HUMAN_UI))
	req.domain = str(data.get("domain", ""))
	req.action_type = str(data.get("action_type", ""))
	var raw_p: Variant = data.get("payload", {})
	req.payload = (raw_p as Dictionary).duplicate(true) if raw_p is Dictionary else {}
	req.lease_nonce = int(data.get("lease_nonce", 0))
	req.client_timestamp_ms = int(data.get("client_timestamp_ms", 0))
	return req

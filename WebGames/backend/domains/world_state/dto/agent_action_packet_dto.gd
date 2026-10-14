# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/dto/agent_action_packet_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 依赖与触发: 上游: LLM / 决策客户端 | 下游: AgentActionChannel, AgentActionExecutionSolver | 配置: config/domains/world_state.json | 信号: EventBus 领域广播
# 职责说明: 面向专属逻辑动作通道的上行标准动作包契约，携带目标指令与强类型参数，实现零硬件争抢直投领域用例。
# 退出语义与设计依据: 主页HUD面向Agent结构化切片流与行动空间双轨适配引擎施工细则 (Inv-SEPARATE-INPUT-CHANNEL-8)
# ==============================================================================

## AgentActionPacketDTO：Value Object DTO / Data Transport Model
class_name AgentActionPacketDTO
extends RefCounted

var session_id: String = ""         # 对应会话 ID
var sequence_index: int = 0         # 响应的目标遥测包序号
var directive_id: String = ""       # 选定的合法指令 ID (如 "ALLOCATE_POTENTIAL_STAT")
var action_id: String = ""          # 指令别名 (如 "ALLOCATE_POTENTIAL")
var params: Dictionary = {}         # 参数载荷 (如 {"stat_target": "STR", "points": 1})
var parameters: Dictionary = {}     # 参数别名
var origin_packet_id: String = ""   # 来源数据包 ID
var agent_signature: String = ""    # 签名标记
var client_timestamp_ms: int = 0   # 决策产出物理时间戳

## 重置内部数据状态，供对象池无堆分配复用
func reset_state() -> void:
	session_id = ""
	sequence_index = 0
	directive_id = ""
	action_id = ""
	params.clear()
	parameters.clear()
	origin_packet_id = ""
	agent_signature = ""
	client_timestamp_ms = 0

## 序列化当前对象为通用字典传输结构
func to_dto() -> Dictionary:
	var final_id := directive_id if not directive_id.is_empty() else action_id
	var final_params := params if not params.is_empty() else parameters
	return {
		"session_id": session_id,
		"sequence_index": sequence_index,
		"directive_id": final_id,
		"action_id": final_id,
		"params": final_params.duplicate(true),
		"parameters": final_params.duplicate(true),
		"origin_packet_id": origin_packet_id,
		"agent_signature": agent_signature,
		"client_timestamp_ms": client_timestamp_ms
	}

## 从输入字典反序列化还原传输对象
static func from_dto(data: Dictionary) -> AgentActionPacketDTO:
	var pkt := AgentActionPacketDTO.new()
	pkt.session_id = str(data.get("session_id", ""))
	pkt.sequence_index = int(data.get("sequence_index", 0))
	pkt.directive_id = str(data.get("directive_id", data.get("action_id", "")))
	pkt.action_id = pkt.directive_id
	pkt.params = data.get("params", data.get("parameters", {})).duplicate(true)
	pkt.parameters = pkt.params.duplicate(true)
	pkt.origin_packet_id = str(data.get("origin_packet_id", ""))
	pkt.agent_signature = str(data.get("agent_signature", ""))
	pkt.client_timestamp_ms = int(data.get("client_timestamp_ms", 0))
	return pkt


# ==============================================================================
# 模块归属: 业务领域层 (Domains · 角色创建集群 (Character Creation))
# 文件路径: res://backend/domains/character_creation/dto/agent_observation_packet_dto.gd
# 架构定位: Data Transfer Object (DTO)
# 依赖与触发: 上游: AgentPlaythroughSession, ModWorkbenchView | 下游: NarrativeDagExecutionEngine | 配置: config/domains/character_creation/core.json | 信号: 无
# 职责说明: 长程交互式推演会话观测包与动作包数据传输契约；承载推演会话标识、步骤索引、当前活跃节点、双通道填充文本、可选动作分支集、角色快照及终态/错误码标志，支持双向无损序列化与对象重置。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## AgentObservationPacketDTO：Data Transfer Object (DTO)
class_name AgentObservationPacketDTO
extends PoolableDtoBase

# ==============================================================================
# 一、观测包契约字段
# ==============================================================================

var session_id: String = ""
var step_index: int = 0
var current_node_id: String = ""
var hydrated_text: String = ""
var available_choices: Array[Dictionary] = []
var character_snapshot: Dictionary = {}
var is_terminal: bool = false
var error_code: String = ""
var diagnostic_dump: Dictionary = {} # 伴侣黑匣子现场转储字典（故障排查与现场复盘）

# ==============================================================================
# 二、对象池与重置契约 (ADV-PRF-002)
# ==============================================================================
## 重置内部数据状态，供对象池无堆分配复用
func reset_state() -> void:
	super.reset_state()
	session_id = ""
	step_index = 0
	current_node_id = ""
	hydrated_text = ""
	available_choices.clear()
	character_snapshot.clear()
	is_terminal = false
	error_code = ""
	diagnostic_dump.clear()

# ==============================================================================
# 三、序列化与工厂方法
# ==============================================================================

## 序列化当前观测包为通用字典传输结构
func to_dto() -> Dictionary:
	var choices_copy: Array[Dictionary] = available_choices.duplicate(true)
	var payload: Dictionary = {
		"session_id": session_id,
		"step_index": step_index,
		"current_node_id": current_node_id,
		"hydrated_text": hydrated_text,
		"available_choices": choices_copy,
		"character_snapshot": character_snapshot.duplicate(true),
		"is_terminal": is_terminal,
		"error_code": error_code
	}
	if not diagnostic_dump.is_empty():
		payload["diagnostic_dump"] = diagnostic_dump.duplicate(true)
	return payload

## 从输入字典反序列化还原传输对象
static func from_dto(serialized_packet: Dictionary) -> AgentObservationPacketDTO:
	var packet_dto := AgentObservationPacketDTO.new()
	if serialized_packet.is_empty():
		return packet_dto
	packet_dto.session_id = str(serialized_packet.get("session_id", ""))
	packet_dto.step_index = int(serialized_packet.get("step_index", 0))
	packet_dto.current_node_id = str(serialized_packet.get("current_node_id", ""))
	packet_dto.hydrated_text = str(serialized_packet.get("hydrated_text", ""))
	var raw_choices: Variant = serialized_packet.get("available_choices", [])
	if raw_choices is Array:
		var cloned_choices: Array = (raw_choices as Array).duplicate(true)
		for choice_entry in cloned_choices:
			if choice_entry is Dictionary:
				packet_dto.available_choices.append(choice_entry as Dictionary)
	var raw_snapshot: Variant = serialized_packet.get("character_snapshot", {})
	if raw_snapshot is Dictionary:
		packet_dto.character_snapshot = (raw_snapshot as Dictionary).duplicate(true)
	packet_dto.is_terminal = bool(serialized_packet.get("is_terminal", false))
	packet_dto.error_code = str(serialized_packet.get("error_code", ""))
	var raw_dump: Variant = serialized_packet.get("diagnostic_dump", {})
	if raw_dump is Dictionary:
		packet_dto.diagnostic_dump = (raw_dump as Dictionary).duplicate(true)
	return packet_dto

# ==============================================================================
# 四、动作包契约类 (AgentSessionActionDTO)
# ==============================================================================
class AgentSessionActionDTO extends PoolableDtoBase:
	var session_id: String = ""
	var action_type: String = "" # "CHOOSE", "ROLLBACK", "QUIT"
	var choice_id: String = ""
	var params: Dictionary = {}

	## 重置内部数据状态，供对象池无堆分配复用
	func reset_state() -> void:
		super.reset_state()
		session_id = ""
		action_type = ""
		choice_id = ""
		params.clear()

	## 序列化当前对象为通用字典传输结构
	func to_dto() -> Dictionary:
		return {
			"session_id": session_id,
			"action_type": action_type,
			"choice_id": choice_id,
			"params": params.duplicate(true)
		}

	## 从输入字典反序列化还原传输对象
	static func from_dto(serialized_action: Dictionary) -> AgentSessionActionDTO:
		var action_dto := AgentSessionActionDTO.new()
		if serialized_action.is_empty():
			return action_dto
		action_dto.session_id = str(serialized_action.get("session_id", ""))
		action_dto.action_type = str(serialized_action.get("action_type", ""))
		action_dto.choice_id = str(serialized_action.get("choice_id", ""))
		var raw_parameters: Variant = serialized_action.get("params", {})
		if raw_parameters is Dictionary:
			action_dto.params = (raw_parameters as Dictionary).duplicate(true)
		return action_dto

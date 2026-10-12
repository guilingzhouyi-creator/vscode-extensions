# ==============================================================================
# 模块归属: 业务领域层 (Domains · 角色创建集群 (Character Creation))
# 文件路径: res://backend/domains/character_creation/dto/agent_observation_packet_dto.gd
# 架构定位: Data Transfer Object (DTO)
# 跨域依赖: 上游: AgentPlaythroughSession, ModWorkbenchView | 下游: NarrativeDagExecutionEngine | 配置: config/domains/character_creation/core.json | 信号: 无
# 职责说明: 长程交互式推演会话观测包与动作包数据传输契约；承载推演会话标识、步骤索引、当前活跃节点、双轨水化文本、可选动作分支集、角色快照及终态/错误码标志，支持双向无损序列化与对象重置。
# 设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

class_name AgentObservationPacketDTO
extends RefCounted

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

# ==============================================================================
# 二、对象池与重置契约 (ADV-PRF-002)
# ==============================================================================

func reset_state() -> void:
	session_id = ""
	step_index = 0
	current_node_id = ""
	hydrated_text = ""
	available_choices.clear()
	character_snapshot.clear()
	is_terminal = false
	error_code = ""

# ==============================================================================
# 三、序列化与工厂方法
# ==============================================================================

func to_dto() -> Dictionary:
	var choices_copy: Array[Dictionary] = []
	for c in available_choices:
		choices_copy.append(c.duplicate(true))
	return {
		"session_id": session_id,
		"step_index": step_index,
		"current_node_id": current_node_id,
		"hydrated_text": hydrated_text,
		"available_choices": choices_copy,
		"character_snapshot": character_snapshot.duplicate(true),
		"is_terminal": is_terminal,
		"error_code": error_code
	}

static func from_dto(raw: Dictionary) -> AgentObservationPacketDTO:
	var dto := AgentObservationPacketDTO.new()
	if raw.is_empty():
		return dto
	dto.session_id = str(raw.get("session_id", ""))
	dto.step_index = int(raw.get("step_index", 0))
	dto.current_node_id = str(raw.get("current_node_id", ""))
	dto.hydrated_text = str(raw.get("hydrated_text", ""))
	var raw_choices: Variant = raw.get("available_choices", [])
	if raw_choices is Array:
		for c in (raw_choices as Array):
			if c is Dictionary:
				dto.available_choices.append((c as Dictionary).duplicate(true))
	var raw_snap: Variant = raw.get("character_snapshot", {})
	if raw_snap is Dictionary:
		dto.character_snapshot = (raw_snap as Dictionary).duplicate(true)
	dto.is_terminal = bool(raw.get("is_terminal", false))
	dto.error_code = str(raw.get("error_code", ""))
	return dto

# ==============================================================================
# 四、动作包契约类 (AgentActionPacketDTO)
# ==============================================================================

class AgentActionPacketDTO extends RefCounted:
	var session_id: String = ""
	var action_type: String = "" # "CHOOSE", "ROLLBACK", "QUIT"
	var choice_id: String = ""
	var params: Dictionary = {}

	func reset_state() -> void:
		session_id = ""
		action_type = ""
		choice_id = ""
		params.clear()

	func to_dto() -> Dictionary:
		return {
			"session_id": session_id,
			"action_type": action_type,
			"choice_id": choice_id,
			"params": params.duplicate(true)
		}

	static func from_dto(raw: Dictionary) -> AgentActionPacketDTO:
		var dto := AgentActionPacketDTO.new()
		if raw.is_empty():
			return dto
		dto.session_id = str(raw.get("session_id", ""))
		dto.action_type = str(raw.get("action_type", ""))
		dto.choice_id = str(raw.get("choice_id", ""))
		var raw_params: Variant = raw.get("params", {})
		if raw_params is Dictionary:
			dto.params = (raw_params as Dictionary).duplicate(true)
		return dto

# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/dto/agent_hud_telemetry_packet_dto.gd
# 架构定位: 顶层遥测数据信封传输模型
# 依赖与触发: 上游: AgentHudSliceSolver | 下游: CompanionObserverBus, LLM 决策客户端 | 配置: config/domains/world_state.json | 信号: EventBus 领域广播
# 职责说明: 面向 LLM 逐包解读的标准原子遥测数据包外壳契约，封装信封与控制权租约、纯净观测、单步因果差分及动态行动空间。
# 退出语义与设计依据: 主页HUD面向Agent结构化切片流与行动空间双通道适配引擎规约 (Inv-STANDARD-PACKET-ENVELOPE-1, Inv-HUMAN-SUPREMACY-PREEMPTION-10)
# ==============================================================================

## AgentHudTelemetryPacketDTO：顶层遥测数据信封传输模型
class_name AgentHudTelemetryPacketDTO
extends PoolableDtoBase

# 一、信封元数据与控制权租约
var protocol_version: String = "1.0.0"
var packet_id: String = ""
var sequence_index: int = 0
var timestamp_ms: int = 0
var domain: String = "HOME_HUD"
var is_terminal: bool = false

var human_interaction_state: String = "IDLE"      # 交互状态：空闲(IDLE)、激活(ACTIVE)、独占模态(EXCLUSIVE_MODAL_OPEN)
var agent_control_mode: String = "READ_WRITE"     # 控制模式：读写模式(READ_WRITE)、纯只读观察者(READ_ONLY_OBSERVER)
var active_operator: String = "IDLE"             # 操作主体：玩家(HUMAN_PLAYER)、智能体(AGENT)、系统(SYSTEM)
var is_writable: bool = true                     # 当前帧是否允许智能体上行提交动作
var preempted_by_human: bool = false             # 是否被人类前台操作抢占锁定

# 二、纯净状态观测
var observation: AgentHudContextSliceDTO = null

# 三、单步因果差分流
var causal_deltas: Array[HudCausalDeltaDTO] = []

# 四、动态行动空间指令集
var action_space: Array[AgentActionDirectiveDTO] = []

## 重置内部遥测信封与切片状态，供对象池无堆分配复用
func reset_state() -> void:
	super.reset_state()
	protocol_version = "1.0.0"
	packet_id = ""
	sequence_index = 0
	timestamp_ms = 0
	domain = "HOME_HUD"
	is_terminal = false

	human_interaction_state = "IDLE"
	agent_control_mode = "READ_WRITE"
	active_operator = "IDLE"
	is_writable = true
	preempted_by_human = false

	if observation != null:
		observation.reset_state()
	causal_deltas.clear()
	action_space.clear()

## 序列化当前遥测数据信封为字典结构
func to_dto() -> Dictionary:
	var delta_entries: Array[Dictionary] = []
	for delta_entry in causal_deltas:
		if delta_entry != null:
			delta_entries.append(delta_entry.to_dto())

	var action_entries: Array[Dictionary] = []
	for action_entry in action_space:
		if action_entry != null:
			action_entries.append(action_entry.to_dto())

	return {
		"envelope": {
			"protocol_version": protocol_version,
			"packet_id": packet_id,
			"sequence_index": sequence_index,
			"timestamp_ms": timestamp_ms,
			"domain": domain,
			"is_terminal": is_terminal,
			"control_lease": {
				"human_interaction_state": human_interaction_state,
				"agent_control_mode": agent_control_mode,
				"active_operator": active_operator,
				"is_writable": is_writable,
				"preempted_by_human": preempted_by_human
			}
		},
		"observation": observation.to_dto() if observation != null else {},
		"causal_deltas": delta_entries,
		"action_space": action_entries
	}

## 从输入字典反序列化解析还原遥测数据信封传输对象
static func from_dto(serialized_payload: Dictionary) -> AgentHudTelemetryPacketDTO:
	var packet := AgentHudTelemetryPacketDTO.new()
	var envelope_payload: Dictionary = serialized_payload.get("envelope", {})
	packet.protocol_version = str(envelope_payload.get("protocol_version", "1.0.0"))
	packet.packet_id = str(envelope_payload.get("packet_id", ""))
	packet.sequence_index = int(envelope_payload.get("sequence_index", 0))
	packet.timestamp_ms = int(envelope_payload.get("timestamp_ms", 0))
	packet.domain = str(envelope_payload.get("domain", "HOME_HUD"))
	packet.is_terminal = bool(envelope_payload.get("is_terminal", false))

	var lease: Dictionary = envelope_payload.get("control_lease", {})
	packet.human_interaction_state = str(lease.get("human_interaction_state", "IDLE"))
	packet.agent_control_mode = str(lease.get("agent_control_mode", "READ_WRITE"))
	packet.active_operator = str(lease.get("active_operator", "IDLE"))
	packet.is_writable = bool(lease.get("is_writable", true))
	packet.preempted_by_human = bool(lease.get("preempted_by_human", false))

	var observation_payload: Dictionary = serialized_payload.get("observation", {})
	if not observation_payload.is_empty():
		packet.observation = AgentHudContextSliceDTO.from_dto(observation_payload)

	packet.causal_deltas.clear()
	var raw_deltas: Array = serialized_payload.get("causal_deltas", [])
	for delta_entry in raw_deltas:
		if delta_entry is Dictionary:
			packet.causal_deltas.append(HudCausalDeltaDTO.from_dto(delta_entry))

	packet.action_space.clear()
	var raw_actions: Array = serialized_payload.get("action_space", [])
	for action_entry in raw_actions:
		if action_entry is Dictionary:
			packet.action_space.append(AgentActionDirectiveDTO.from_dto(action_entry))

	return packet

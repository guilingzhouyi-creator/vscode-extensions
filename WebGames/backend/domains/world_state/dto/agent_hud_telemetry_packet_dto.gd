# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/dto/agent_hud_telemetry_packet_dto.gd
# 架构定位: 顶层遥测数据信封传输模型
# 依赖与触发: 上游: AgentHudSliceSolver | 下游: CompanionObserverBus, LLM 决策客户端 | 配置: config/domains/world_state.json | 信号: EventBus 领域广播
# 职责说明: 面向 LLM 逐包解读的标准原子遥测数据包外壳契约，封装信封与控制权租约、纯净观测、单步因果差分及动态行动空间。
# 退出语义与设计依据: 主页HUD面向Agent结构化切片流与行动空间双轨适配引擎规约 (Inv-STANDARD-PACKET-ENVELOPE-1, Inv-HUMAN-SUPREMACY-PREEMPTION-10)
# ==============================================================================

## AgentHudTelemetryPacketDTO：顶层遥测数据信封传输模型
class_name AgentHudTelemetryPacketDTO
extends RefCounted

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
	var deltas_arr: Array[Dictionary] = []
	for d in causal_deltas:
		if d != null:
			deltas_arr.append(d.to_dto())

	var actions_arr: Array[Dictionary] = []
	for a in action_space:
		if a != null:
			actions_arr.append(a.to_dto())

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
		"causal_deltas": deltas_arr,
		"action_space": actions_arr
	}

## 从输入字典反序列化解析还原遥测数据信封传输对象
static func from_dto(data: Dictionary) -> AgentHudTelemetryPacketDTO:
	var pkt := AgentHudTelemetryPacketDTO.new()
	var env: Dictionary = data.get("envelope", {})
	pkt.protocol_version = str(env.get("protocol_version", "1.0.0"))
	pkt.packet_id = str(env.get("packet_id", ""))
	pkt.sequence_index = int(env.get("sequence_index", 0))
	pkt.timestamp_ms = int(env.get("timestamp_ms", 0))
	pkt.domain = str(env.get("domain", "HOME_HUD"))
	pkt.is_terminal = bool(env.get("is_terminal", false))

	var lease: Dictionary = env.get("control_lease", {})
	pkt.human_interaction_state = str(lease.get("human_interaction_state", "IDLE"))
	pkt.agent_control_mode = str(lease.get("agent_control_mode", "READ_WRITE"))
	pkt.active_operator = str(lease.get("active_operator", "IDLE"))
	pkt.is_writable = bool(lease.get("is_writable", true))
	pkt.preempted_by_human = bool(lease.get("preempted_by_human", false))

	var obs_dict: Dictionary = data.get("observation", {})
	if not obs_dict.is_empty():
		pkt.observation = AgentHudContextSliceDTO.from_dto(obs_dict)

	pkt.causal_deltas.clear()
	var raw_deltas: Array = data.get("causal_deltas", [])
	for d in raw_deltas:
		if d is Dictionary:
			pkt.causal_deltas.append(HudCausalDeltaDTO.from_dto(d))

	pkt.action_space.clear()
	var raw_actions: Array = data.get("action_space", [])
	for a in raw_actions:
		if a is Dictionary:
			pkt.action_space.append(AgentActionDirectiveDTO.from_dto(a))

	return pkt

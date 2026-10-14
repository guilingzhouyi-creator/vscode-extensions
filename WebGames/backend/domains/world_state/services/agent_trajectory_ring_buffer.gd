# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/services/agent_trajectory_ring_buffer.gd
# 架构定位: Domain Service / Trajectory Ring Buffer & Memory State
# 依赖与触发: 上游: AgentHudSliceBridge | 下游: AgentHudTelemetryPacketDTO, HudCausalDeltaDTO | 配置: config/domains/world_state/core.json
# 职责说明: 面向 Agent 的定长环形缓冲轨迹器。
#           提供 O(1) 滚动覆盖覆写、多步时序轨迹窗口查询与累积因果差分跨步聚合，彻底杜绝 pop_front() 内存搬移抖动。
# 退出语义与设计依据: 定长环形缓冲与时序反思记忆规范 (Inv-RING-BUFFER-BOUNDED-2, Inv-TRAJECTORY-WINDOW-WINDOW-3)
# ==============================================================================

## AgentTrajectoryRingBuffer：Domain Service / Trajectory Ring Buffer & Memory State
class_name AgentTrajectoryRingBuffer
extends RefCounted

const AgentHudTelemetryPacketDTO = preload("res://backend/domains/world_state/dto/agent_hud_telemetry_packet_dto.gd")
const AgentHudContextSliceDTO = preload("res://backend/domains/world_state/dto/agent_hud_context_slice_dto.gd")
const HudCausalDeltaDTO = preload("res://backend/domains/world_state/dto/hud_causal_delta_dto.gd")
const AgentActionDirectiveDTO = preload("res://backend/domains/world_state/dto/agent_action_directive_dto.gd")

var _capacity: int = 32
var _slots: Array[AgentHudTelemetryPacketDTO] = []
var _head: int = 0
var _count: int = 0

func _init(capacity: int = 32) -> void:
	_capacity = maxi(1, capacity)
	_slots.resize(_capacity)
	for i in range(_capacity):
		_slots[i] = AgentHudTelemetryPacketDTO.new()
	_head = 0
	_count = 0

## O(1) 取模写入，原位重置槽位并同步数据
func append_packet(packet: AgentHudTelemetryPacketDTO) -> void:
	if packet == null:
		return

	var target_slot: AgentHudTelemetryPacketDTO = _slots[_head]
	_sync_packet_data(packet, target_slot)

	_head = (_head + 1) % _capacity
	_count = mini(_capacity, _count + 1)

## 导出最近 k 步保序时序窗口（按 sequence_index 与时间顺序正向排列）
func get_trajectory_window(steps: int = 8) -> Array[AgentHudTelemetryPacketDTO]:
	var out: Array[AgentHudTelemetryPacketDTO] = []
	var k: int = mini(steps, _count)
	if k <= 0:
		return out

	out.resize(k)
	var start_idx: int = (_head - k + _capacity) % _capacity
	for i in range(k):
		var slot_idx: int = (start_idx + i) % _capacity
		out[i] = _slots[slot_idx]
	return out

## 获取自指定序列号（大于等于 from_seq）以来的累积因果突变
func get_cumulative_deltas(from_sequence: int = 0) -> Array[HudCausalDeltaDTO]:
	var deltas: Array[HudCausalDeltaDTO] = []
	if _count <= 0:
		return deltas

	var window := get_trajectory_window(_count)
	for pkt in window:
		if pkt == null or pkt.sequence_index < from_sequence:
			continue
		for d in pkt.causal_deltas:
			if d != null:
				deltas.append(d)
	return deltas

## 获取当前最新的遥测数据包
func get_latest_packet() -> AgentHudTelemetryPacketDTO:
	if _count <= 0:
		return null
	var latest_idx: int = (_head - 1 + _capacity) % _capacity
	return _slots[latest_idx]

## 获取当前缓冲项数
func get_count() -> int:
	return _count

## 获取最大容量
func get_capacity() -> int:
	return _capacity

## 重置清空缓冲
func clear() -> void:
	for slot in _slots:
		if slot != null:
			slot.reset_state()
	_head = 0
	_count = 0

static func _sync_packet_data(src: AgentHudTelemetryPacketDTO, dst: AgentHudTelemetryPacketDTO) -> void:
	dst.reset_state()
	dst.protocol_version = src.protocol_version
	dst.packet_id = src.packet_id
	dst.sequence_index = src.sequence_index
	dst.timestamp_ms = src.timestamp_ms
	dst.domain = src.domain
	dst.is_terminal = src.is_terminal
	dst.human_interaction_state = src.human_interaction_state
	dst.agent_control_mode = src.agent_control_mode
	dst.active_operator = src.active_operator
	dst.is_writable = src.is_writable
	dst.preempted_by_human = src.preempted_by_human

	if src.observation != null:
		if dst.observation == null:
			dst.observation = AgentHudContextSliceDTO.new()
		_sync_observation(src.observation, dst.observation)

	# 差分原位同步
	dst.causal_deltas.clear()
	for d in src.causal_deltas:
		if d != null:
			var clone_delta := HudCausalDeltaDTO.new()
			clone_delta.delta_category = d.delta_category
			clone_delta.target_field = d.target_field
			clone_delta.previous_value = d.previous_value
			clone_delta.current_value = d.current_value
			clone_delta.delta_amount = d.delta_amount
			clone_delta.cause_identifier = d.cause_identifier
			clone_delta.initiator = d.initiator
			clone_delta.reason = d.reason
			dst.causal_deltas.append(clone_delta)

	# 行动空间原位同步
	dst.action_space.clear()
	for a in src.action_space:
		if a != null:
			var clone_act := AgentActionDirectiveDTO.new()
			clone_act.directive_id = a.directive_id
			clone_act.domain = a.domain
			clone_act.description = a.description
			clone_act.cost_payload = a.cost_payload
			clone_act.preconditions = a.preconditions
			clone_act.allowed_parameters = a.allowed_parameters
			clone_act.is_executable = a.is_executable
			clone_act.blocked_reason = a.blocked_reason
			dst.action_space.append(clone_act)

static func _sync_observation(src: AgentHudContextSliceDTO, dst: AgentHudContextSliceDTO) -> void:
	dst.reset_state()
	dst.account_id = src.account_id
	dst.character_id = src.character_id
	dst.character_name = src.character_name
	dst.race_id = src.race_id
	dst.level = src.level
	dst.hp_current = src.hp_current
	dst.hp_max = src.hp_max
	dst.hp_ratio = src.hp_ratio
	dst.mp_current = src.mp_current
	dst.mp_max = src.mp_max
	dst.mp_ratio = src.mp_ratio
	dst.ap_current = src.ap_current
	dst.ap_max = src.ap_max
	dst.ap_ratio = src.ap_ratio
	dst.wallet_gold = src.wallet_gold
	dst.wallet_mana_monocrystals = src.wallet_mana_monocrystals
	dst.ledger_nonce = src.ledger_nonce
	dst.unallocated_potential_points = src.unallocated_potential_points
	dst.attribute_values.clear()
	for k in src.attribute_values.keys():
		dst.attribute_values[k] = src.attribute_values[k]
	dst.title_rank_key = src.title_rank_key
	dst.calendar_year = src.calendar_year
	dst.calendar_month = src.calendar_month
	dst.calendar_day = src.calendar_day
	dst.day_phase_key = src.day_phase_key
	dst.active_quest_id = src.active_quest_id
	dst.active_quest_target_count = src.active_quest_target_count
	dst.active_quest_current_count = src.active_quest_current_count
	dst.is_quest_completable = src.is_quest_completable
	dst.game_mode = src.game_mode
	dst.is_multiplayer_ready = src.is_multiplayer_ready
	dst.unread_mail_count = src.unread_mail_count
	dst.ui_notices.clear()
	for n in src.ui_notices:
		if n != null:
			dst.ui_notices.append(n)


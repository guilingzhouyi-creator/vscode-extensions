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

var _capacity: int = 32
var _slots: Array[AgentHudTelemetryPacketDTO] = []
var _slot_delta_pools: Array = []
var _slot_action_pools: Array = []
var _head: int = 0
var _count: int = 0

func _init(capacity: int = 32) -> void:
	_capacity = maxi(1, capacity)
	_slots.resize(_capacity)
	_slot_delta_pools.resize(_capacity)
	_slot_action_pools.resize(_capacity)
	for slot_index in range(_capacity):
		_slots[slot_index] = _create_empty_packet_slot()
		_slot_delta_pools[slot_index] = []
		_slot_action_pools[slot_index] = []
	_head = 0
	_count = 0

static func _create_empty_packet_slot() -> AgentHudTelemetryPacketDTO:
	return AgentHudTelemetryPacketDTO.new()

## O(1) 取模写入，原位重置槽位并同步数据
func append_packet(packet: AgentHudTelemetryPacketDTO) -> void:
	if packet == null:
		return

	var target_slot: AgentHudTelemetryPacketDTO = _slots[_head]
	var delta_pool: Array = _slot_delta_pools[_head] as Array
	var action_pool: Array = _slot_action_pools[_head] as Array
	_sync_packet_data(packet, target_slot, delta_pool, action_pool)

	_head = (_head + 1) % _capacity
	_count = mini(_capacity, _count + 1)

## 导出最近 k 步保序时序窗口（按 sequence_index 与时间顺序正向排列）
func get_trajectory_window(steps: int = 8) -> Array[AgentHudTelemetryPacketDTO]:
	var window_packets: Array[AgentHudTelemetryPacketDTO] = []
	var window_count: int = mini(steps, _count)
	if window_count <= 0:
		return window_packets

	window_packets.resize(window_count)
	var start_index: int = (_head - window_count + _capacity) % _capacity
	for offset_index in range(window_count):
		var slot_index: int = (start_index + offset_index) % _capacity
		window_packets[offset_index] = _slots[slot_index]
	return window_packets

static func _append_packet_deltas(packet: AgentHudTelemetryPacketDTO, target_deltas: Array[HudCausalDeltaDTO]) -> void:
	for delta_entry in packet.causal_deltas:
		if delta_entry != null:
			target_deltas.append(delta_entry)


## 获取自指定序列号（大于等于 from_seq）以来的累积因果突变（直读环形槽位，零临时窗口数组分配）
func get_cumulative_deltas(from_sequence: int = 0) -> Array[HudCausalDeltaDTO]:
	var deltas: Array[HudCausalDeltaDTO] = []
	if _count <= 0:
		return deltas

	var start_index: int = (_head - _count + _capacity) % _capacity
	for offset_index in range(_count):
		var packet: AgentHudTelemetryPacketDTO = _slots[(start_index + offset_index) % _capacity]
		if packet == null or packet.sequence_index < from_sequence:
			continue
		_append_packet_deltas(packet, deltas)
	return deltas

## 获取当前最新的遥测数据包
func get_latest_packet() -> AgentHudTelemetryPacketDTO:
	if _count <= 0:
		return null
	var latest_index: int = (_head - 1 + _capacity) % _capacity
	return _slots[latest_index]

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

static func _sync_packet_data(
	source_packet: AgentHudTelemetryPacketDTO,
	target_packet: AgentHudTelemetryPacketDTO,
	delta_pool: Array,
	action_pool: Array
) -> void:
	target_packet.reset_state()
	target_packet.protocol_version = source_packet.protocol_version
	target_packet.packet_id = source_packet.packet_id
	target_packet.sequence_index = source_packet.sequence_index
	target_packet.timestamp_ms = source_packet.timestamp_ms
	target_packet.domain = source_packet.domain
	target_packet.is_terminal = source_packet.is_terminal
	target_packet.human_interaction_state = source_packet.human_interaction_state
	target_packet.agent_control_mode = source_packet.agent_control_mode
	target_packet.active_operator = source_packet.active_operator
	target_packet.is_writable = source_packet.is_writable
	target_packet.preempted_by_human = source_packet.preempted_by_human

	if source_packet.observation != null:
		if target_packet.observation == null:
			target_packet.observation = AgentHudContextSliceDTO.new()
		_sync_observation(source_packet.observation, target_packet.observation)

	# 差分原位同步（依托槽位长驻对象池，零事件帧不销毁已分配实例）
	_sync_causal_deltas(source_packet, target_packet, delta_pool)
	# 行动空间原位同步
	_sync_action_space(source_packet, target_packet, action_pool)

static func _sync_causal_deltas(source_packet: AgentHudTelemetryPacketDTO, target_packet: AgentHudTelemetryPacketDTO, delta_pool: Array) -> void:
	var active_count: int = 0
	for delta_entry in source_packet.causal_deltas:
		if delta_entry == null:
			continue
		var clone_delta := _acquire_delta_slot(delta_pool, active_count)
		clone_delta.delta_category = delta_entry.delta_category
		clone_delta.target_field = delta_entry.target_field
		clone_delta.previous_value = delta_entry.previous_value
		clone_delta.current_value = delta_entry.current_value
		clone_delta.delta_amount = delta_entry.delta_amount
		clone_delta.cause_identifier = delta_entry.cause_identifier
		clone_delta.initiator = delta_entry.initiator
		clone_delta.reason = delta_entry.reason
		active_count += 1
	target_packet.causal_deltas.resize(active_count)
	for delta_index in range(active_count):
		target_packet.causal_deltas[delta_index] = delta_pool[delta_index]

static func _acquire_delta_slot(pool: Array, slot_index: int) -> HudCausalDeltaDTO:
	if slot_index < pool.size() and pool[slot_index] != null:
		return pool[slot_index] as HudCausalDeltaDTO
	var created := HudCausalDeltaDTO.new()
	if slot_index < pool.size():
		pool[slot_index] = created
	else:
		pool.append(created)
	return created

static func _sync_action_space(source_packet: AgentHudTelemetryPacketDTO, target_packet: AgentHudTelemetryPacketDTO, action_pool: Array) -> void:
	var active_count: int = 0
	for directive_entry in source_packet.action_space:
		if directive_entry == null:
			continue
		var cloned_directive := _acquire_action_slot(action_pool, active_count)
		cloned_directive.directive_id = directive_entry.directive_id
		cloned_directive.domain = directive_entry.domain
		cloned_directive.description = directive_entry.description
		cloned_directive.cost_payload = directive_entry.cost_payload
		cloned_directive.preconditions = directive_entry.preconditions
		cloned_directive.allowed_parameters = directive_entry.allowed_parameters
		cloned_directive.is_executable = directive_entry.is_executable
		cloned_directive.blocked_reason = directive_entry.blocked_reason
		active_count += 1
	target_packet.action_space.resize(active_count)
	for action_index in range(active_count):
		target_packet.action_space[action_index] = action_pool[action_index]

static func _acquire_action_slot(pool: Array, slot_index: int) -> AgentActionDirectiveDTO:
	if slot_index < pool.size() and pool[slot_index] != null:
		return pool[slot_index] as AgentActionDirectiveDTO
	var created := AgentActionDirectiveDTO.new()
	if slot_index < pool.size():
		pool[slot_index] = created
	else:
		pool.append(created)
	return created

static func _sync_observation(source_slice: AgentHudContextSliceDTO, target_slice: AgentHudContextSliceDTO) -> void:
	target_slice.reset_state()
	target_slice.account_id = source_slice.account_id
	target_slice.character_id = source_slice.character_id
	target_slice.character_name = source_slice.character_name
	target_slice.race_id = source_slice.race_id
	target_slice.level = source_slice.level
	target_slice.hp_current = source_slice.hp_current
	target_slice.hp_max = source_slice.hp_max
	target_slice.hp_ratio = source_slice.hp_ratio
	target_slice.mp_current = source_slice.mp_current
	target_slice.mp_max = source_slice.mp_max
	target_slice.mp_ratio = source_slice.mp_ratio
	target_slice.ap_current = source_slice.ap_current
	target_slice.ap_max = source_slice.ap_max
	target_slice.ap_ratio = source_slice.ap_ratio
	target_slice.wallet_gold = source_slice.wallet_gold
	target_slice.wallet_mana_monocrystals = source_slice.wallet_mana_monocrystals
	target_slice.ledger_nonce = source_slice.ledger_nonce
	target_slice.unallocated_potential_points = source_slice.unallocated_potential_points
	target_slice.attribute_values.clear()
	for attribute_key in source_slice.attribute_values.keys():
		target_slice.attribute_values[attribute_key] = source_slice.attribute_values[attribute_key]
	target_slice.title_rank_key = source_slice.title_rank_key
	target_slice.calendar_year = source_slice.calendar_year
	target_slice.calendar_month = source_slice.calendar_month
	target_slice.calendar_day = source_slice.calendar_day
	target_slice.day_phase_key = source_slice.day_phase_key
	target_slice.active_quest_id = source_slice.active_quest_id
	target_slice.active_quest_target_count = source_slice.active_quest_target_count
	target_slice.active_quest_current_count = source_slice.active_quest_current_count
	target_slice.is_quest_completable = source_slice.is_quest_completable
	target_slice.game_mode = source_slice.game_mode
	target_slice.is_multiplayer_ready = source_slice.is_multiplayer_ready
	target_slice.unread_mail_count = source_slice.unread_mail_count
	target_slice.ui_notices.clear()
	for notice_entry in source_slice.ui_notices:
		if notice_entry != null:
			target_slice.ui_notices.append(notice_entry)

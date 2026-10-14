# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/services/agent_hud_slice_bridge.gd
# 架构定位: Domain Service / Stateful Telemetry Bridge Facade
# 依赖与触发: 上游: GameLoop, TestHarness | 下游: AuthoritativeHudSyncService, AgentHudSliceSolver, AgentTrajectoryRingBuffer, AgentAsyncDispatcher | 配置: config/domains/world_state/core.json
# 职责说明: 主页 HUD 面向 Agent 运行时会话的状态化切片流分发桥接门面。
#           管理时序单调序列号、前序切片增量比对、定长环形轨迹记忆、异步背压派发与人类交互独占租约。
# 退出语义与设计依据: 状态化切片桥接与多步因果时序回溯契约 (Inv-ATOMIC-PACK-PIPELINE-1, Inv-MULTISTEP-REFLECTION-2, ARCH-FAC-001)
# ==============================================================================

## AgentHudSliceBridge：Domain Service / Stateful Telemetry Bridge Facade
class_name AgentHudSliceBridge
extends RefCounted

const AuthoritativeHudSyncService = preload("res://backend/domains/world_state/services/authoritative_hud_sync_service.gd")
const AgentHudSliceSolver = preload("res://backend/domains/world_state/solvers/agent_hud_slice_solver.gd")
const AgentTrajectoryRingBuffer = preload("res://backend/domains/world_state/services/agent_trajectory_ring_buffer.gd")
const AgentAsyncDispatcher = preload("res://backend/domains/world_state/services/agent_async_dispatcher.gd")

const AgentHudTelemetryPacketDTO = preload("res://backend/domains/world_state/dto/agent_hud_telemetry_packet_dto.gd")
const AgentHudContextSliceDTO = preload("res://backend/domains/world_state/dto/agent_hud_context_slice_dto.gd")
const HudUiNoticeDTO = preload("res://backend/domains/world_state/dto/hud_ui_notice_dto.gd")
const HudCausalDeltaDTO = preload("res://backend/domains/world_state/dto/hud_causal_delta_dto.gd")

var _context: Dictionary = {}
var _prev_slice: AgentHudContextSliceDTO = null
var _sequence_index: int = 0
var _pending_ui_notices: Array[HudUiNoticeDTO] = []
var _human_interacting: bool = false

var _trajectory_ring: AgentTrajectoryRingBuffer = null
var _async_dispatcher: AgentAsyncDispatcher = null

func _init() -> void:
	var ring_cap: int = 32
	if GameConfig.has_table("domains.world_state"):
		ring_cap = GameConfig.get_int("domains.world_state", "agent_telemetry_stream/ring_buffer_capacity", 32)
	_trajectory_ring = AgentTrajectoryRingBuffer.new(ring_cap)

	var queue_cap: int = 128
	if GameConfig.has_table("domains.world_state"):
		queue_cap = GameConfig.get_int("domains.world_state", "agent_telemetry_stream/async_queue_capacity", 128)
	_async_dispatcher = AgentAsyncDispatcher.new(queue_cap)

## 绑定当前上下文字典
func set_context(ctx: Dictionary) -> void:
	_context = ctx

## 获取当前绑定上下文
func get_context() -> Dictionary:
	return _context

## 注入前台去表现化 UI 通知或引导提示
func inject_ui_notice(notice: HudUiNoticeDTO) -> void:
	if notice != null:
		_pending_ui_notices.append(notice)

## 设定前台人类操作独占租约状态
func set_human_interacting(active: bool) -> void:
	_human_interacting = active
	AuthoritativeHudSyncService.set_human_interacting_for_tests(active)

## 获取人类操作租约状态
func is_human_interacting() -> bool:
	return _human_interacting

## 执行单步推演与原子装箱分发（装箱 -> 轨迹入环 -> 异步流控派发 -> 伴侣总线广播）
func step_and_publish(cause: String = "") -> AgentHudTelemetryPacketDTO:
	_sequence_index += 1

	var snapshot := AuthoritativeHudSyncService.get_authoritative_snapshot(_context)
	var initiator: String = "HUMAN_UI_INTERACTION" if _human_interacting else ("AGENT_ACTION_CHANNEL" if not cause.is_empty() else "SYSTEM_TICK_SIMULATION")

	var packet := AgentHudSliceSolver.assemble_telemetry_packet(
		snapshot,
		_prev_slice,
		_sequence_index,
		cause,
		_human_interacting,
		initiator
	)

	# 合并并转移待分发的外部 UI 通知
	if not _pending_ui_notices.is_empty():
		for n in _pending_ui_notices:
			if n != null and packet.observation != null:
				packet.observation.ui_notices.append(n)
		_pending_ui_notices.clear()

	# 滚动更新前序切片副本
	_prev_slice = packet.observation

	# 1. 记录进定长环形轨迹缓冲器
	if _trajectory_ring != null:
		_trajectory_ring.append_packet(packet)

	# 2. 异步流控背压派发
	if _async_dispatcher != null:
		_async_dispatcher.dispatch_telemetry(packet)

	# 3. 向伴侣总线广播
	AuthoritativeHudSyncService.publish_agent_telemetry_packet(packet)

	return packet

## 获取最近 k 步时序轨迹切片（供 LLM 多步反思与长程因果归因）
func get_trajectory_history(steps: int = 8) -> Array[AgentHudTelemetryPacketDTO]:
	if _trajectory_ring == null:
		return []
	return _trajectory_ring.get_trajectory_window(steps)

## 获取自指定序列号以来的累积因果突变差分
func get_cumulative_deltas(from_sequence: int = 0) -> Array[HudCausalDeltaDTO]:
	if _trajectory_ring == null:
		return []
	return _trajectory_ring.get_cumulative_deltas(from_sequence)

## 获取内部异步派发器
func get_async_dispatcher() -> AgentAsyncDispatcher:
	return _async_dispatcher

## 获取内部定长环形缓冲轨迹器
func get_trajectory_ring_buffer() -> AgentTrajectoryRingBuffer:
	return _trajectory_ring

## 重置桥接器全部内部状态与时序序号
func reset_state() -> void:
	_context.clear()
	_prev_slice = null
	_sequence_index = 0
	_pending_ui_notices.clear()
	_human_interacting = false
	if _trajectory_ring != null:
		_trajectory_ring.clear()
	if _async_dispatcher != null:
		_async_dispatcher.clear()
	AuthoritativeHudSyncService.clear_human_interacting_override()

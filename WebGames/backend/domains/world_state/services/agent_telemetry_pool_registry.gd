# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/services/agent_telemetry_pool_registry.gd
# 架构定位: Domain Service / Object Pool Orchestration & Bridge
# 依赖与触发: 上游: AgentHudSliceSolver, HomeActionSpaceSolver | 下游: ObjectPoolManager, Agent DTOs | 配置: config/infrastructure/object_pool.json
# 职责说明: 面向 Agent 遥测高频推演的深度对象池化注册与借还门面。
#           集中管理数据包、切片观测、行动指令与因果差分等核心 DTO 的 O(1) 借还守恒，彻底阻断循环瞬态堆分配。
# 退出语义与设计依据: 高承压对象池与数据导向无头处理器架构规范 (Inv-DEEP-POOL-CONSERVATION-1, ADV-PRF-002)
# ==============================================================================

## AgentTelemetryPoolRegistry：Domain Service / Object Pool Orchestration & Bridge
class_name AgentTelemetryPoolRegistry
extends RefCounted

const ObjectPoolManager = preload("res://backend/infrastructure/object_pool_manager.gd")
const ObjectPool = preload("res://backend/infrastructure/object_pool.gd")

const AgentHudTelemetryPacketDTO = preload("res://backend/domains/world_state/dto/agent_hud_telemetry_packet_dto.gd")
const AgentHudContextSliceDTO = preload("res://backend/domains/world_state/dto/agent_hud_context_slice_dto.gd")
const AgentActionDirectiveDTO = preload("res://backend/domains/world_state/dto/agent_action_directive_dto.gd")
const HudCausalDeltaDTO = preload("res://backend/domains/world_state/dto/hud_causal_delta_dto.gd")

const POOL_PACKET: String = "agent_hud_telemetry_packet"
const POOL_SLICE: String = "agent_hud_context_slice"
const POOL_DIRECTIVE: String = "agent_action_directive"
const POOL_DELTA: String = "hud_causal_delta"

static var _pools_registered: bool = false

## 确保所有 Agent 专用池均已在 ObjectPoolManager 登记
static func ensure_pools_registered() -> void:
	if _pools_registered:
		return
	ObjectPoolManager.initialize()

	if ObjectPoolManager.get_pool(POOL_PACKET) == null:
		ObjectPoolManager.register_pool(POOL_PACKET, func() -> RefCounted:
			return AgentHudTelemetryPacketDTO.new()
		)

	if ObjectPoolManager.get_pool(POOL_SLICE) == null:
		ObjectPoolManager.register_pool(POOL_SLICE, func() -> RefCounted:
			return AgentHudContextSliceDTO.new()
		)

	if ObjectPoolManager.get_pool(POOL_DIRECTIVE) == null:
		ObjectPoolManager.register_pool(POOL_DIRECTIVE, func() -> RefCounted:
			return AgentActionDirectiveDTO.new()
		)

	if ObjectPoolManager.get_pool(POOL_DELTA) == null:
		ObjectPoolManager.register_pool(POOL_DELTA, func() -> RefCounted:
			return HudCausalDeltaDTO.new()
		)

	_pools_registered = true

## 借出遥测数据包外壳
static func borrow_packet() -> AgentHudTelemetryPacketDTO:
	ensure_pools_registered()
	var pool := ObjectPoolManager.get_pool(POOL_PACKET)
	if pool != null:
		var obj := pool.acquire() as AgentHudTelemetryPacketDTO
		if obj != null:
			return obj
	return AgentHudTelemetryPacketDTO.new()

## 归还遥测数据包
static func recycle_packet(packet: AgentHudTelemetryPacketDTO) -> void:
	if packet == null:
		return
	ensure_pools_registered()
	var pool := ObjectPoolManager.get_pool(POOL_PACKET)
	if pool != null:
		pool.release(packet)

## 借出上下文观测切片
static func borrow_slice() -> AgentHudContextSliceDTO:
	ensure_pools_registered()
	var pool := ObjectPoolManager.get_pool(POOL_SLICE)
	if pool != null:
		var obj := pool.acquire() as AgentHudContextSliceDTO
		if obj != null:
			return obj
	return AgentHudContextSliceDTO.new()

## 归还上下文观测切片
static func recycle_slice(slice: AgentHudContextSliceDTO) -> void:
	if slice == null:
		return
	ensure_pools_registered()
	var pool := ObjectPoolManager.get_pool(POOL_SLICE)
	if pool != null:
		pool.release(slice)

## 借出行动指令对象
static func borrow_directive() -> AgentActionDirectiveDTO:
	ensure_pools_registered()
	var pool := ObjectPoolManager.get_pool(POOL_DIRECTIVE)
	if pool != null:
		var obj := pool.acquire() as AgentActionDirectiveDTO
		if obj != null:
			return obj
	return AgentActionDirectiveDTO.new()

## 归还行动指令对象
static func recycle_directive(directive: AgentActionDirectiveDTO) -> void:
	if directive == null:
		return
	ensure_pools_registered()
	var pool := ObjectPoolManager.get_pool(POOL_DIRECTIVE)
	if pool != null:
		pool.release(directive)

## 借出因果差分对象
static func borrow_delta() -> HudCausalDeltaDTO:
	ensure_pools_registered()
	var pool := ObjectPoolManager.get_pool(POOL_DELTA)
	if pool != null:
		var obj := pool.acquire() as HudCausalDeltaDTO
		if obj != null:
			return obj
	return HudCausalDeltaDTO.new()

## 归还因果差分对象
static func recycle_delta(delta: HudCausalDeltaDTO) -> void:
	if delta == null:
		return
	ensure_pools_registered()
	var pool := ObjectPoolManager.get_pool(POOL_DELTA)
	if pool != null:
		pool.release(delta)

## 测试隔离专用：重置注册标记
static func reset_for_tests() -> void:
	_pools_registered = false

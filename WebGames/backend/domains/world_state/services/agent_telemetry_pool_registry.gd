# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/services/agent_telemetry_pool_registry.gd
# 架构定位: Domain Service / Object Pool Orchestration & Bridge
# 依赖与触发: 上游: AgentHudSliceSolver, HomeActionSpaceSolver | 下游: Agent DTOs, 注入式池后端端口 | 配置: config/infrastructure/object_pool.json
# 职责说明: 面向 Agent 遥测高频推演的深度对象池化注册与借还门面。
#           通过依赖倒置端口接入基础设施池管理器，并提供领域内有界 LIFO 安全回退栈，集中守恒借还且阻断跨层倒置依赖。
# 退出语义与设计依据: 高承压对象池与数据导向无头处理器架构规范 (Inv-DEEP-POOL-CONSERVATION-1, ADV-PRF-002)
# ==============================================================================

## AgentTelemetryPoolRegistry：Domain Service / Object Pool Orchestration & Bridge
class_name AgentTelemetryPoolRegistry
extends RefCounted

const POOL_PACKET: String = "agent_hud_telemetry_packet"
const POOL_SLICE: String = "agent_hud_context_slice"
const POOL_DIRECTIVE: String = "agent_action_directive"
const POOL_DELTA: String = "hud_causal_delta"
const MAX_LOCAL_POOL_CAPACITY: int = 256
const METHOD_RESET_STATE: String = "reset_state"

static var _are_pools_registered: bool = false
static var _backend_ensure_callback: Callable = Callable()
static var _backend_acquire_callback: Callable = Callable()
static var _backend_release_callback: Callable = Callable()
static var _local_pools: Dictionary = {}

## 基础设施层依赖倒置注入端口：由装配入口绑定 ObjectPoolManager 回调
static func bind_pool_backend(ensure_callback: Callable, acquire_callback: Callable, release_callback: Callable) -> void:
	_backend_ensure_callback = ensure_callback
	_backend_acquire_callback = acquire_callback
	_backend_release_callback = release_callback
	_are_pools_registered = false

static func _ensure_pool(pool_name: String, factory: Callable) -> void:
	if _backend_ensure_callback.is_valid():
		_backend_ensure_callback.call(pool_name, factory)
		return
	if not _local_pools.has(pool_name):
		_local_pools[pool_name] = []

static func _acquire_from_pool(pool_name: String) -> RefCounted:
	if _backend_acquire_callback.is_valid():
		return _backend_acquire_callback.call(pool_name) as RefCounted
	var stack: Array = _local_pools.get(pool_name, [])
	if not stack.is_empty():
		var pooled_object: RefCounted = stack.pop_back()
		if pooled_object != null and pooled_object.has_method(METHOD_RESET_STATE):
			pooled_object.reset_state()
		return pooled_object
	return null

static func _release_to_pool(pool_name: String, pooled_object: RefCounted) -> void:
	if _backend_release_callback.is_valid():
		_backend_release_callback.call(pool_name, pooled_object)
		return
	if not _local_pools.has(pool_name):
		_local_pools[pool_name] = []
	var stack: Array = _local_pools[pool_name]
	if stack.size() < MAX_LOCAL_POOL_CAPACITY:
		if pooled_object.has_method(METHOD_RESET_STATE):
			pooled_object.reset_state()
		stack.append(pooled_object)

## 确保所有 Agent 专用池均已在池后端登记
static func ensure_pools_registered() -> void:
	if _are_pools_registered:
		return
	_ensure_pool(POOL_PACKET, func() -> RefCounted:
		return AgentHudTelemetryPacketDTO.new()
	)
	_ensure_pool(POOL_SLICE, func() -> RefCounted:
		return AgentHudContextSliceDTO.new()
	)
	_ensure_pool(POOL_DIRECTIVE, func() -> RefCounted:
		return AgentActionDirectiveDTO.new()
	)
	_ensure_pool(POOL_DELTA, func() -> RefCounted:
		return HudCausalDeltaDTO.new()
	)
	_are_pools_registered = true

## 借出遥测数据包外壳
static func borrow_packet() -> AgentHudTelemetryPacketDTO:
	ensure_pools_registered()
	var pooled_packet := _acquire_from_pool(POOL_PACKET) as AgentHudTelemetryPacketDTO
	if pooled_packet != null:
		return pooled_packet
	return AgentHudTelemetryPacketDTO.new()

## 归还遥测数据包
static func recycle_packet(packet: AgentHudTelemetryPacketDTO) -> void:
	if packet == null:
		return
	ensure_pools_registered()
	_release_to_pool(POOL_PACKET, packet)

## 深度递归归还遥测包及其持有的观测切片、因果差分与行动指令子树
static func recycle_packet_tree(packet: AgentHudTelemetryPacketDTO, keep_observation: AgentHudContextSliceDTO = null) -> void:
	if packet == null:
		return
	var observation_slice := packet.observation
	packet.observation = null
	if observation_slice != null and observation_slice != keep_observation:
		recycle_slice(observation_slice)

	if not packet.causal_deltas.is_empty():
		for delta in packet.causal_deltas:
			if delta != null:
				recycle_delta(delta)
		packet.causal_deltas.clear()

	if not packet.action_space.is_empty():
		for directive in packet.action_space:
			if directive != null:
				recycle_directive(directive)
		packet.action_space.clear()

	recycle_packet(packet)

## 借出上下文观测切片
static func borrow_slice() -> AgentHudContextSliceDTO:
	ensure_pools_registered()
	var pooled_slice := _acquire_from_pool(POOL_SLICE) as AgentHudContextSliceDTO
	if pooled_slice != null:
		return pooled_slice
	return AgentHudContextSliceDTO.new()

## 归还上下文观测切片
static func recycle_slice(slice: AgentHudContextSliceDTO) -> void:
	if slice == null:
		return
	ensure_pools_registered()
	_release_to_pool(POOL_SLICE, slice)

## 借出行动指令对象
static func borrow_directive() -> AgentActionDirectiveDTO:
	ensure_pools_registered()
	var pooled_directive := _acquire_from_pool(POOL_DIRECTIVE) as AgentActionDirectiveDTO
	if pooled_directive != null:
		return pooled_directive
	return AgentActionDirectiveDTO.new()

## 归还行动指令对象
static func recycle_directive(directive: AgentActionDirectiveDTO) -> void:
	if directive == null:
		return
	ensure_pools_registered()
	_release_to_pool(POOL_DIRECTIVE, directive)

## 借出因果差分对象
static func borrow_delta() -> HudCausalDeltaDTO:
	ensure_pools_registered()
	var pooled_delta := _acquire_from_pool(POOL_DELTA) as HudCausalDeltaDTO
	if pooled_delta != null:
		return pooled_delta
	return HudCausalDeltaDTO.new()

## 归还因果差分对象
static func recycle_delta(delta: HudCausalDeltaDTO) -> void:
	if delta == null:
		return
	ensure_pools_registered()
	_release_to_pool(POOL_DELTA, delta)

## 测试隔离专用：重置注册标记与领域本地缓存栈
static func reset_for_tests() -> void:
	_are_pools_registered = false
	_local_pools.clear()

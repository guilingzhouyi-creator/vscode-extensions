# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/spatial_movement/spatial_trigger_fsm.gd
# 架构定位: Domain FSM / Lifecycle Session Engine
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/spatial_movement.json | 信号: EventBus 领域广播
# 职责说明: 判定圆形半径与 AABB 矩形空间触发器进出事件 (ENTER/INSIDE/EXIT)
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## SpatialTriggerFSM：Domain FSM / Lifecycle Session Engine
class_name SpatialTriggerFSM
extends PoolableDtoBase

const POOL_SPATIAL_TRIGGERS: String = "spatial_triggers"
const MAX_LOCAL_TRIGGER_POOL: int = 256

static var _cached_default_radius: float = 5.0
static var _radius_config_version: int = -1
static var _is_trigger_pools_bound: bool = false
static var _pool_ensure_callback: Callable = Callable()
static var _pool_acquire_callback: Callable = Callable()
static var _pool_release_callback: Callable = Callable()
static var _local_trigger_pool: Array = []

static func _get_cached_default_radius() -> float:
	var config_version: int = GameConfig.config_reload_version()
	if _radius_config_version != config_version:
		_cached_default_radius = GameConfig.get_float("domains.spatial_movement", "trigger/default_radius", 5.0)
		_radius_config_version = config_version
	return _cached_default_radius

## 依赖倒置对象池端口绑定（与 infrastructure.ObjectPoolManager 解耦对接 spatial_triggers 池）
static func bind_trigger_pool_backend(ensure_callback: Callable, acquire_callback: Callable, release_callback: Callable) -> void:
	_pool_ensure_callback = ensure_callback
	_pool_acquire_callback = acquire_callback
	_pool_release_callback = release_callback
	_is_trigger_pools_bound = false

static func _ensure_trigger_pool() -> void:
	if _is_trigger_pools_bound:
		return
	if _pool_ensure_callback.is_valid():
		_pool_ensure_callback.call(POOL_SPATIAL_TRIGGERS, func() -> RefCounted:
			return SpatialTriggerArea.new()
		)
	_is_trigger_pools_bound = true

## 从对象池借出可复用空间触发区域实例
static func borrow_trigger_area(initial_trigger_id: String = "", initial_center: Vector2 = Vector2.ZERO, initial_radius: float = -1.0) -> SpatialTriggerArea:
	_ensure_trigger_pool()
	var area: SpatialTriggerArea = null
	if _pool_acquire_callback.is_valid():
		area = _pool_acquire_callback.call(POOL_SPATIAL_TRIGGERS) as SpatialTriggerArea
	elif not _local_trigger_pool.is_empty():
		area = _local_trigger_pool.pop_back() as SpatialTriggerArea
		if area != null:
			area.reset_state()
	if area == null:
		area = SpatialTriggerArea.new()
	area.trigger_id = initial_trigger_id
	area.shape = TriggerShape.CIRCLE_RADIUS
	area.center_pos = initial_center
	area.radius = initial_radius if initial_radius >= 0.0 else _get_cached_default_radius()
	area.current_state = TriggerState.OUTSIDE
	return area

## 归还空间触发区域实例至对象池
static func recycle_trigger_area(area: SpatialTriggerArea) -> void:
	if area == null:
		return
	_ensure_trigger_pool()
	if _pool_release_callback.is_valid():
		_pool_release_callback.call(POOL_SPATIAL_TRIGGERS, area)
		return
	if _local_trigger_pool.size() < MAX_LOCAL_TRIGGER_POOL:
		area.reset_state()
		_local_trigger_pool.append(area)

## 测试隔离：重置本地回退池与版本号缓存
static func reset_pool_for_tests() -> void:
	_is_trigger_pools_bound = false
	_local_trigger_pool.clear()
	_radius_config_version = -1

enum TriggerShape {
	CIRCLE_RADIUS,
	AABB_RECTANGLE
}

enum TriggerState {
	OUTSIDE,
	ENTERED,
	INSIDE,
	EXITED
}

## SpatialTriggerArea：空间触发区域实体模型
class SpatialTriggerArea extends PoolableDtoBase:
	var trigger_id: String
	var shape: TriggerShape = TriggerShape.CIRCLE_RADIUS
	var center_pos: Vector2 = Vector2.ZERO
	var radius: float = 5.0
	var rect_extents: Rect2 = Rect2()
	var current_state: TriggerState = TriggerState.OUTSIDE

	## 触发区构造（ID/圆心/半径，圆形默认形状）
	func _init(initial_trigger_id: String = "", initial_center: Vector2 = Vector2.ZERO, initial_radius: float = -1.0) -> void:
		trigger_id = initial_trigger_id
		shape = TriggerShape.CIRCLE_RADIUS
		center_pos = initial_center
		radius = initial_radius if initial_radius >= 0.0 else SpatialTriggerFSM._get_cached_default_radius()

	## 重置空间触发区域状态，供对象池无堆分配复用
	func reset_state() -> void:
		super.reset_state()
		trigger_id = ""
		shape = TriggerShape.CIRCLE_RADIUS
		center_pos = Vector2.ZERO
		radius = SpatialTriggerFSM._get_cached_default_radius()
		rect_extents = Rect2()
		current_state = TriggerState.OUTSIDE

## 触发状态求值：圆形/AABB 包含判定 → ENTERED/INSIDE/EXITED/OUTSIDE 状态机迁移
static func evaluate_trigger_state(trigger: SpatialTriggerArea, entity_position: Vector2) -> TriggerState:
	var is_contained := false
	if trigger.shape == TriggerShape.CIRCLE_RADIUS:
		is_contained = SpatialProximitySolver.is_within_radius_2d(entity_position, trigger.center_pos, trigger.radius)
	elif trigger.shape == TriggerShape.AABB_RECTANGLE:
		is_contained = trigger.rect_extents.has_point(entity_position)

	var previous_state: Variant = trigger.current_state
	if is_contained:
		if previous_state == TriggerState.OUTSIDE or previous_state == TriggerState.EXITED:
			trigger.current_state = TriggerState.ENTERED
		else:
			trigger.current_state = TriggerState.INSIDE
	else:
		if previous_state == TriggerState.INSIDE or previous_state == TriggerState.ENTERED:
			trigger.current_state = TriggerState.EXITED
		else:
			trigger.current_state = TriggerState.OUTSIDE

	return trigger.current_state

## 多实体解耦求值：基于 MultiEntityTriggerRegistry 维护独立状态，消除单实体状态污染
static func evaluate_entity_trigger_state(
	registry: RefCounted,
	trigger: SpatialTriggerArea,
	entity_id: String,
	entity_position: Vector2
) -> TriggerState:
	var is_contained := false
	if trigger.shape == TriggerShape.CIRCLE_RADIUS:
		is_contained = entity_position.distance_to(trigger.center_pos) <= trigger.radius
	elif trigger.shape == TriggerShape.AABB_RECTANGLE:
		is_contained = trigger.rect_extents.has_point(entity_position)

	var previous_state: int = registry.get_state(trigger.trigger_id, entity_id) if registry else TriggerState.OUTSIDE
	var new_state: TriggerState = previous_state as TriggerState

	if is_contained:
		if previous_state == TriggerState.OUTSIDE or previous_state == TriggerState.EXITED:
			new_state = TriggerState.ENTERED
		else:
			new_state = TriggerState.INSIDE
	else:
		if previous_state == TriggerState.INSIDE or previous_state == TriggerState.ENTERED:
			new_state = TriggerState.EXITED
		else:
			new_state = TriggerState.OUTSIDE

	if registry != null:
		registry.update_state(trigger.trigger_id, entity_id, new_state)
	return new_state

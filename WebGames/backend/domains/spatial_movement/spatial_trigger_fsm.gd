# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/spatial_movement/spatial_trigger_fsm.gd
# 架构定位: Domain FSM / Lifecycle Session Engine
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/spatial_movement.json | 信号: EventBus 领域广播
# 职责说明: 判定圆形半径与 AABB 矩形空间触发器进出事件 (ENTER/INSIDE/EXIT)
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name SpatialTriggerFSM
extends RefCounted

const MultiEntityTriggerRegistryClass = preload("res://backend/domains/spatial_movement/multi_entity_trigger_registry.gd")

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

class SpatialTriggerArea extends RefCounted:
	var trigger_id: String
	var shape: TriggerShape = TriggerShape.CIRCLE_RADIUS
	var center_pos: Vector2 = Vector2.ZERO
	var radius: float = GameConfig.get_float("domains.spatial_movement", "trigger/default_radius", 5.0)
	var rect_extents: Rect2 = Rect2()
	var current_state: TriggerState = TriggerState.OUTSIDE

	## 触发区构造（ID/圆心/半径，圆形默认形状）
	func _init(p_id: String, p_center: Vector2, p_radius: float) -> void:
		trigger_id = p_id
		shape = TriggerShape.CIRCLE_RADIUS
		center_pos = p_center
		radius = p_radius

## 触发状态求值：圆形/AABB 包含判定 → ENTERED/INSIDE/EXITED/OUTSIDE 状态机迁移
static func evaluate_trigger_state(trigger: SpatialTriggerArea, entity_pos: Vector2) -> TriggerState:
	var is_contained := false
	if trigger.shape == TriggerShape.CIRCLE_RADIUS:
		is_contained = SpatialMath.within_radius(entity_pos, trigger.center_pos, trigger.radius)
	elif trigger.shape == TriggerShape.AABB_RECTANGLE:
		is_contained = trigger.rect_extents.has_point(entity_pos)

	var prev_state = trigger.current_state
	if is_contained:
		if prev_state == TriggerState.OUTSIDE or prev_state == TriggerState.EXITED:
			trigger.current_state = TriggerState.ENTERED
		else:
			trigger.current_state = TriggerState.INSIDE
	else:
		if prev_state == TriggerState.INSIDE or prev_state == TriggerState.ENTERED:
			trigger.current_state = TriggerState.EXITED
		else:
			trigger.current_state = TriggerState.OUTSIDE

	return trigger.current_state

## 多实体解耦求值：基于 MultiEntityTriggerRegistry 维护独立状态，消除单实体状态污染
static func evaluate_entity_trigger_state(
	registry: RefCounted,
	trigger: SpatialTriggerArea,
	entity_id: String,
	entity_pos: Vector2
) -> TriggerState:
	var is_contained := false
	if trigger.shape == TriggerShape.CIRCLE_RADIUS:
		is_contained = SpatialMath.within_radius(entity_pos, trigger.center_pos, trigger.radius)
	elif trigger.shape == TriggerShape.AABB_RECTANGLE:
		is_contained = trigger.rect_extents.has_point(entity_pos)

	var prev_state: int = registry.get_state(trigger.trigger_id, entity_id) if registry else TriggerState.OUTSIDE
	var new_state: TriggerState = prev_state

	if is_contained:
		if prev_state == TriggerState.OUTSIDE or prev_state == TriggerState.EXITED:
			new_state = TriggerState.ENTERED
		else:
			new_state = TriggerState.INSIDE
	else:
		if prev_state == TriggerState.INSIDE or prev_state == TriggerState.ENTERED:
			new_state = TriggerState.EXITED
		else:
			new_state = TriggerState.OUTSIDE

	if registry != null:
		registry.update_state(trigger.trigger_id, entity_id, new_state)
	return new_state


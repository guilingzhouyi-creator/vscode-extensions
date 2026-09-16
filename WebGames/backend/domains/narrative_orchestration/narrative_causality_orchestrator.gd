# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/narrative_orchestration/narrative_causality_orchestrator.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/narrative_orchestration.json | 信号: EventBus 领域广播
# 职责说明: 复杂 AST 复合条件表达式求值器、优先级仲裁与因果突变动作派发
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name NarrativeCausalityOrchestrator
extends RefCounted

## AST 复合条件求值：AND/OR/NOT 递归 + 叶子 kind 分派（TOWN_EQUALS/MIN_LEVEL/HOUR_BETWEEN/REPUTATION_GREATER），空节点恒真
static func evaluate_ast_condition(ast_node: Dictionary, world_context: Dictionary) -> bool:
	if ast_node.is_empty():
		return true

	var op_type = ast_node.get("type", "LEAF")
	if op_type == "AND":
		var conditions: Array = ast_node.get("conditions", [])
		for cond in conditions:
			if not evaluate_ast_condition(cond, world_context):
				return false
		return true
	elif op_type == "OR":
		var conditions: Array = ast_node.get("conditions", [])
		for cond in conditions:
			if evaluate_ast_condition(cond, world_context):
				return true
		return false
	elif op_type == "NOT":
		var child: Dictionary = ast_node.get("condition", {})
		return not evaluate_ast_condition(child, world_context)

	# 叶子节点判定
	var kind = ast_node.get("kind", "")
	var target_val = ast_node.get("val", null)
	match kind:
		"TOWN_EQUALS":
			return world_context.get("town_id", "") == target_val
		"MIN_LEVEL":
			return world_context.get("character_level", 1) >= int(target_val)
		"HOUR_BETWEEN":
			var h = world_context.get("world_hour", 12)
			var min_h = ast_node.get("min", 0)
			var max_h = ast_node.get("max", 24)
			return h >= min_h and h <= max_h
		"REPUTATION_GREATER":
			var faction = ast_node.get("faction", "")
			var reps: Dictionary = world_context.get("reputations", {})
			return reps.get(faction, 0) >= int(target_val)
	return false

## 事件仲裁触发：非重复且条件满足者入候选 → 优先级降序排序 → 批量置 has_triggered 并回写时间戳
static func arbitrate_and_trigger(
	events: Array[NarrativeEventAggregate],
	world_context: Dictionary,
	current_time_utc: int
) -> Array[NarrativeEventAggregate]:
	var eligible_events: Array[NarrativeEventAggregate] = []
	for evt in events:
		if not evt.is_repeatable and evt.has_triggered:
			continue
		if evaluate_ast_condition(evt.trigger_conditions_ast, world_context):
			eligible_events.append(evt)

	# 按优先级降序排序 (权重高者优先)
	eligible_events.sort_custom(func(a: NarrativeEventAggregate, b: NarrativeEventAggregate):
		return a.priority_weight > b.priority_weight
	)

	for evt in eligible_events:
		evt.has_triggered = true
		evt.triggered_timestamp_utc = current_time_utc

	return eligible_events

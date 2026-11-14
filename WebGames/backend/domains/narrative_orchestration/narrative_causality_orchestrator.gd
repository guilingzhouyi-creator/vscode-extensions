# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/narrative_orchestration/narrative_causality_orchestrator.gd
# 架构定位: Domain Logic Component
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/narrative_orchestration.json | 信号: EventBus 领域广播
# 职责说明: 复杂 AST 复合条件表达式求值器、优先级仲裁与因果突变动作派发
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## NarrativeCausalityOrchestrator：Domain Logic Component
class_name NarrativeCausalityOrchestrator
extends RefCounted

## AST 复合条件求值：AND/OR/NOT 递归 + 叶子 kind 分派（TOWN_EQUALS/MIN_LEVEL/HOUR_BETWEEN/REPUTATION_GREATER），空节点恒真
static func evaluate_ast_condition(ast_node: Dictionary, world_context: Dictionary) -> bool:
	if ast_node.is_empty():
		return true

	var operator_type: Variant = ast_node.get("type", "LEAF")
	if operator_type == "AND":
		var conditions: Array = ast_node.get("conditions", [])
		for child_condition in conditions:
			if not evaluate_ast_condition(child_condition, world_context):
				return false
		return true
	elif operator_type == "OR":
		var conditions: Array = ast_node.get("conditions", [])
		for child_condition in conditions:
			if evaluate_ast_condition(child_condition, world_context):
				return true
		return false
	elif operator_type == "NOT":
		var child: Dictionary = ast_node.get("condition", {})
		return not evaluate_ast_condition(child, world_context)

	# 叶子节点判定
	var kind: Variant = ast_node.get("kind", "")
	var target_value: Variant = ast_node.get("val", null)
	match kind:
		"TOWN_EQUALS":
			return world_context.get("town_id", "") == target_value
		"MIN_LEVEL":
			return world_context.get("character_level", 1) >= int(target_value)
		"HOUR_BETWEEN":
			var current_hour: Variant = world_context.get("world_hour", 12)
			var min_hour: Variant = ast_node.get("min", 0)
			var max_hour: Variant = ast_node.get("max", 24)
			return current_hour >= min_hour and current_hour <= max_hour
		"REPUTATION_GREATER":
			var faction: Variant = ast_node.get("faction", "")
			var reputations: Dictionary = world_context.get("reputations", {})
			return reputations.get(faction, 0) >= int(target_value)
	return false

## 事件仲裁触发：非重复且条件满足者入候选 → 优先级降序排序 → 批量置 has_triggered 并回写时间戳
static func arbitrate_and_trigger(
	events: Array[NarrativeEventAggregate],
	world_context: Dictionary,
	current_time_utc: int
) -> Array[NarrativeEventAggregate]:
	var eligible_events: Array[NarrativeEventAggregate] = []
	for event_entry in events:
		if not event_entry.is_repeatable and event_entry.has_triggered:
			continue
		if evaluate_ast_condition(event_entry.trigger_conditions_ast, world_context):
			eligible_events.append(event_entry)

	# 按优先级降序排序 (权重高者优先)
	eligible_events.sort_custom(func(first_event: NarrativeEventAggregate, second_event: NarrativeEventAggregate):
		return first_event.priority_weight > second_event.priority_weight
	)

	for event_entry in eligible_events:
		event_entry.has_triggered = true
		event_entry.triggered_timestamp_utc = current_time_utc

	return eligible_events

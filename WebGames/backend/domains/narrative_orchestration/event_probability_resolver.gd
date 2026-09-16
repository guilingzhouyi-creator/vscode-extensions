# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/narrative_orchestration/event_probability_resolver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/narrative_orchestration.json | 信号: EventBus 领域广播
# 职责说明: 事件在不同上下文/条件/状态下的概率计算、调整与关联——**只算不执行** （零动作派发/零生命周期指令/零触发写回），不得取代事件核心执行逻辑。 概率参数/条件/关联 100% 配置驱动（config/domains/event_probability.json）， 条件求值复用 NarrativeCausalityOrchestrator.evaluate_ast_condition。
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name EventProbabilityResolver
extends RefCounted

const CONFIG_TABLE: String = "domains.event_probability"

## 概率解析：基础概率 → 条件修正（上下文/状态）→ 动态调整（buff/环境）→ 事件关联
## 输出唯一契约：{ probability, modifiers, adjusted_by }——只算不执行
static func resolve(event_id: String, world_context: Dictionary) -> Dictionary:
	var events_cfg: Dictionary = GameConfig.get_dict(CONFIG_TABLE, "events", {})
	var entry: Dictionary = events_cfg.get(event_id, {})
	if entry.is_empty():
		return {"success": false, "code": "EVENT_NOT_CONFIGURED", "event_id": event_id}

	var prob: float = float(entry.get("base_probability", 0.0))
	var modifiers: Array = []
	var adjusted_by: Array = []

	# 1) 条件修正：world_context 满足的条件组合 → 修正系数（只读上下文，不写事件状态）
	var conditions: Array = entry.get("conditions", [])
	for cond in conditions:
		if NarrativeCausalityOrchestrator.evaluate_ast_condition(cond.get("when", {}), world_context):
			var factor: float = float(cond.get("factor", 1.0))
			prob *= factor
			modifiers.append({"kind": "condition", "id": str(cond.get("id", "")), "factor": factor})

	# 2) 动态调整：buff/环境修正（配置驱动，禁止内嵌事件执行指令）
	var adjustments: Array = entry.get("adjustments", [])
	for adj in adjustments:
		if NarrativeCausalityOrchestrator.evaluate_ast_condition(adj.get("when", {}), world_context):
			var delta: float = float(adj.get("delta", 0.0))
			prob += delta
			modifiers.append({"kind": "adjustment", "id": str(adj.get("id", "")), "delta": delta})

	# 3) 事件关联：关联事件已触发 → 概率联动（经事件状态上下文只读查询）
	var links: Array = entry.get("links", [])
	var triggered: Array = world_context.get("event_state.triggered", [])
	for link in links:
		if str(link.get("linked_event_id", "")) in triggered:
			prob *= float(link.get("factor", 1.0))
			adjusted_by.append(str(link.get("linked_event_id", "")))

	# 值域钳制：确定性 0~1（越界配置在 audit 启动校验拦截，此处兜底）
	prob = clampf(prob, 0.0, 1.0)
	return {
		"success": true,
		"event_id": event_id,
		"probability": prob,
		"modifiers": modifiers,
		"adjusted_by": adjusted_by,
	}

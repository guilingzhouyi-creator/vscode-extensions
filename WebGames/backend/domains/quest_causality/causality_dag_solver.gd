# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/quest_causality/causality_dag_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: inventory | 配置: config/domains/quest.json | 信号: EventBus 领域广播
# 职责说明: 状态事实评估、因果 DAG 路径判定 (强攻/隐匿/外交/黑市)
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name CausalityDAGSolver extends RefCounted

static func evaluate_quest_completion(
	quest: QuestObjectiveNode.QuestCausalityAggregate,
	world_state_facts: Dictionary
) -> Dictionary:
	# 0. 图结构校验（Phase 32 S2）：空路径/重复节点/未知节点引用 → QUEST_GRAPH_INVALID，
	#    非法图不改变任务完成标记（不得通过空路径或残留 is_completed 直接完成任务）
	var graph_err := _validate_graph(quest)
	if not graph_err.is_empty():
		return { "is_completed": quest.is_quest_finished, "solution_type": "", "code": graph_err }

	# 1. 评估各个因果节点是否达成
	for node_id in quest.objective_nodes:
		var node: QuestObjectiveNode = quest.objective_nodes[node_id]
		if world_state_facts.has(node.target_state_key):
			var cur_val = world_state_facts[node.target_state_key]
			if cur_val == node.required_value:
				node.is_completed = true

	# 2. 检查多手段路径 (只要有一条完整路径满足，即判定达成)
	var satisfied_path_type := ""
	for path in quest.solution_paths:
		var path_ok := true
		var last_type := ""
		for node_id in path:
			if not quest.objective_nodes.has(node_id) or not quest.objective_nodes[node_id].is_completed:
				path_ok = false
				break
			last_type = quest.objective_nodes[node_id].solution_type

		if path_ok:
			satisfied_path_type = last_type
			quest.is_quest_finished = true
			break

	return {
		"is_completed": quest.is_quest_finished,
		"solution_type": satisfied_path_type,
		"code": ""
	}

## 任务图结构校验：solution_paths 每条路径非空、节点全部已登记且无重复节点。
## 返回空串表示通过；否则返回错误码（QUEST_GRAPH_INVALID 等）。
static func _validate_graph(quest: QuestObjectiveNode.QuestCausalityAggregate) -> String:
	for path in quest.solution_paths:
		if path.is_empty():
			return "QUEST_GRAPH_INVALID"   # 空路径不得视为成功
		var seen := {}
		for node_id in path:
			if not quest.objective_nodes.has(node_id):
				return "QUEST_GRAPH_INVALID"   # 未知节点引用
			if seen.has(node_id):
				return "QUEST_GRAPH_INVALID"   # 路径重复节点
			seen[node_id] = true
	return ""

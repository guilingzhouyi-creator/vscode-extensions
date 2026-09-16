# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/narrative_orchestration/prologue_dag_registry.gd
# 架构定位: Domain Registry / Specification Catalog
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/narrative_orchestration.json | 信号: EventBus 领域广播
# 职责说明: 依据角色种族/身世路由规则，从配置加载并装配专属剧情 DAG
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name PrologueDagRegistry
extends RefCounted

## 依据角色种族与上下文动态匹配并解析专属 DAG
static func resolve_prologue_dag(race_id: String) -> NarrativeDAGGraphDTO:
	var catalog := GameConfig.get_dict("narratives.prologue_dag_catalog", "dag_graphs", {})
	var routing_rules: Array = GameConfig.get_array("narratives.prologue_dag_catalog", "prologue_routing_rules", [])

	var selected_dag_id: String = ""
	for r in routing_rules:
		var rule := r as Dictionary
		var cond: Dictionary = rule.get("match_condition", {})
		if cond.get("is_default", false):
			if selected_dag_id.is_empty():
				selected_dag_id = str(rule.get("target_dag_id", ""))
		elif cond.has("race_id") and str(cond["race_id"]) == race_id:
			selected_dag_id = str(rule.get("target_dag_id", ""))
			break

	# R4 审查修复：默认 DAG 单一事实源收敛为纯配置 is_default 规则驱动，
	# 移除代码内硬编码 fallback 字面量（配置缺失时返回 null 由上层防御，
	# 避免 catalog 改名后代码字面量指向空图的隐式双源不一致）。
	if selected_dag_id.is_empty() or not catalog.has(selected_dag_id):
		return null

	return get_graph_by_id(selected_dag_id)


## 按图编号获取已装配的 DAG 实体（R3 审查修复：复用模型 from_dto 全字段装配）
static func get_graph_by_id(dag_id: String) -> NarrativeDAGGraphDTO:
	var catalog := GameConfig.get_dict("narratives.prologue_dag_catalog", "dag_graphs", {})
	if not catalog.has(dag_id):
		return null

	var raw: Dictionary = catalog.get(dag_id, {})
	var g := NarrativeDAGGraphDTO.new(dag_id)
	g.entry_node_id = str(raw.get("entry_node_id", ""))
	g.terminal_node_id = str(raw.get("terminal_node_id", ""))

	var raw_nodes: Dictionary = raw.get("nodes", {})
	for nid in raw_nodes.keys():
		var nd_dict: Dictionary = (raw_nodes[nid] as Dictionary).duplicate(true)
		# 配置词条以键控形式存在（node_id 隐含在键中），补齐后走全字段 from_dto
		nd_dict["node_id"] = str(nid)
		var node := NarrativeDAGNode.from_dto(nd_dict)
		g.add_node(node)

	var raw_edges: Array = raw.get("edges", [])
	for ed in raw_edges:
		var ed_dict: Dictionary = (ed as Dictionary).duplicate(true)
		# 配置边用 from/to 键；对齐 NarrativeDAGEdge.from_dto 的 from_node_id/to_node_id 契约
		if not ed_dict.has("from_node_id") and ed_dict.has("from"):
			ed_dict["from_node_id"] = str(ed_dict.get("from", ""))
		if not ed_dict.has("to_node_id") and ed_dict.has("to"):
			ed_dict["to_node_id"] = str(ed_dict.get("to", ""))
		var edge := NarrativeDAGEdge.from_dto(ed_dict)
		g.add_edge(edge)

	return g

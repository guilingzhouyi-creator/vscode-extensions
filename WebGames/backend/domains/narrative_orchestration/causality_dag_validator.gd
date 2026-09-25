# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/narrative_orchestration/causality_dag_validator.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/narrative_orchestration.json | 信号: EventBus 领域广播
# 职责说明: 采用 Kahn 算法进行拓扑排序，检测并拦截死锁循环依赖环、悬挂边与非法依赖
# 设计依据: 业务域第一性原理 / 剧情编排因果拓扑规范
# ==============================================================================

class_name CausalityDagValidator
extends RefCounted

## 基础图元拓扑完整性校验（空校验、入口与终态存在性）
static func _validate_graph_topology_integrity(graph: NarrativeDAGGraphDTO) -> Dictionary:
	if graph == null or graph.nodes.is_empty():
		return { "is_valid": false, "error_code": "EMPTY_GRAPH", "message": "图元或节点集合为空" }

	if graph.entry_node_id.is_empty() or not graph.nodes.has(graph.entry_node_id):
		return { "is_valid": false, "error_code": "INVALID_ENTRY_NODE", "message": "入口节点不存在" }

	if not graph.terminal_node_id.is_empty() and not graph.nodes.has(graph.terminal_node_id):
		return {
			"is_valid": false,
			"error_code": "INVALID_TERMINAL_NODE",
			"message": "终态节点不存在: %s" % graph.terminal_node_id
		}

	return { "is_valid": true }

## 构建入度表、邻接表并校验悬挂边与缺失前置
static func _build_degrees_and_edges(graph: NarrativeDAGGraphDTO, in_degree: Dictionary, adj_list: Dictionary) -> Dictionary:
	for nid in graph.nodes.keys():
		in_degree[nid] = 0
		adj_list[nid] = []

	for edge in graph.edges:
		if not graph.nodes.has(edge.from_node_id) or not graph.nodes.has(edge.to_node_id):
			return {
				"is_valid": false,
				"error_code": "DANGLING_EDGE",
				"message": "边连接了不存在的节点: %s -> %s" % [edge.from_node_id, edge.to_node_id]
			}
		adj_list[edge.from_node_id].append(edge.to_node_id)
		in_degree[edge.to_node_id] = int(in_degree.get(edge.to_node_id, 0)) + 1

	for nid in graph.nodes.keys():
		var node: NarrativeDAGNode = graph.nodes[nid]
		for pre in node.required_prerequisites:
			if not graph.nodes.has(pre):
				return {
					"is_valid": false,
					"error_code": "MISSING_PREREQUISITE",
					"message": "节点 %s 依赖不存在的前置: %s" % [nid, pre]
				}

	return { "is_valid": true }

## 基于 Kahn 拓扑排序算法检测死锁循环依赖环
static func _detect_cycle_kahn(graph: NarrativeDAGGraphDTO, in_degree: Dictionary, adj_list: Dictionary) -> Dictionary:
	var zero_in_degree_queue: Array[String] = []
	for nid in in_degree.keys():
		if in_degree[nid] == 0:
			zero_in_degree_queue.append(nid)

	var visited_count := 0
	while not zero_in_degree_queue.is_empty():
		var current = zero_in_degree_queue.pop_front()
		visited_count += 1
		for neighbor in (adj_list.get(current, []) as Array):
			var n_str := str(neighbor)
			in_degree[n_str] = int(in_degree.get(n_str, 0)) - 1
			if in_degree[n_str] == 0:
				zero_in_degree_queue.append(n_str)

	if visited_count < graph.nodes.size():
		return {
			"is_valid": false,
			"error_code": "CYCLE_DETECTED",
			"message": "剧情 DAG 中检测到非法循环依赖环 (Cycle)，已访问 %d / 总节点数 %d" % [visited_count, graph.nodes.size()]
		}

	return { "is_valid": true, "visited_count": visited_count }

## 校验非可选节点的入口可达闭包
static func _verify_reachability(graph: NarrativeDAGGraphDTO) -> Dictionary:
	var reachable := _collect_reachable_nodes(graph)
	for nid in graph.nodes.keys():
		if reachable.has(nid):
			continue
		var node: NarrativeDAGNode = graph.nodes[nid]
		if not node.is_optional:
			return {
				"is_valid": false,
				"error_code": "UNREACHABLE_NODE",
				"message": "非可选节点 %s 无法从入口 %s 沿边到达（孤立/断链）" % [nid, graph.entry_node_id]
			}
	return { "is_valid": true }

## 对传入的剧情 DAG 图元进行静态拓扑校验 (Kahn 算法)
static func validate_graph(graph: NarrativeDAGGraphDTO) -> Dictionary:
	var integrity_res := _validate_graph_topology_integrity(graph)
	if not integrity_res.get("is_valid", false):
		return integrity_res

	var in_degree: Dictionary = {}
	var adj_list: Dictionary = {}
	var degree_res := _build_degrees_and_edges(graph, in_degree, adj_list)
	if not degree_res.get("is_valid", false):
		return degree_res

	var cycle_res := _detect_cycle_kahn(graph, in_degree, adj_list)
	if not cycle_res.get("is_valid", false):
		return cycle_res

	var reach_res := _verify_reachability(graph)
	if not reach_res.get("is_valid", false):
		return reach_res

	return { "is_valid": true, "sorted_node_count": cycle_res.get("visited_count", 0) }


## 从入口节点出发沿有向边收集可达节点集合（BFS）
static func _collect_reachable_nodes(graph: NarrativeDAGGraphDTO) -> Dictionary:
	var reachable := { graph.entry_node_id: true }
	var frontier: Array[String] = [graph.entry_node_id]
	while not frontier.is_empty():
		var current: String = frontier.pop_front()
		for edge in graph.edges:
			if edge.from_node_id != current:
				continue
			var next_id := edge.to_node_id
			if not reachable.has(next_id):
				reachable[next_id] = true
				frontier.append(next_id)
	return reachable

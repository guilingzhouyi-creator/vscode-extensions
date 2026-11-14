# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/narrative_orchestration/causality_dag_validator.gd
# 架构定位: Domain Logic Component
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/narrative_orchestration.json | 信号: EventBus 领域广播
# 职责说明: 采用 Kahn 算法进行拓扑排序，检测并拦截死锁循环依赖环、悬挂边与非法依赖
# 退出语义与设计依据: 业务域第一性原理 / 剧情编排因果拓扑规范
# ==============================================================================

## CausalityDagValidator：Domain Logic Component
class_name CausalityDagValidator
extends RefCounted

## 基础图元拓扑完整性校验（空校验、入口与终态存在性）
static func _validate_graph_topology_integrity(graph: NarrativeDAGGraphDTO) -> Dictionary:
	if graph == null or graph.nodes.is_empty():
		return {"is_valid": false, "error_code": "EMPTY_GRAPH", "message": "Empty DAG or node collection"}

	if graph.entry_node_id.is_empty() or not graph.nodes.has(graph.entry_node_id):
		return {"is_valid": false, "error_code": "INVALID_ENTRY_NODE", "message": "Entry node does not exist"}

	if not graph.terminal_node_id.is_empty() and not graph.nodes.has(graph.terminal_node_id):
		return {
			"is_valid": false,
			"error_code": "INVALID_TERMINAL_NODE",
			"message": TemplateFormatter.format("Terminal node does not exist: {node_id}", {"node_id": graph.terminal_node_id})
		}

	return {"is_valid": true}

static func _check_node_prerequisites(node_id: String, node: NarrativeDAGNode, graph: NarrativeDAGGraphDTO) -> Dictionary:
	for prerequisite_id in node.required_prerequisites:
		if not graph.nodes.has(prerequisite_id):
			return {
				"is_valid": false,
				"error_code": "MISSING_PREREQUISITE",
				"message": TemplateFormatter.format(
					"Node {node_id} requires missing prerequisite: {prerequisite}",
					{"node_id": node_id, "prerequisite": prerequisite_id}
				)
			}
	return {"is_valid": true}

static func _init_dag_buckets(node_id: Variant, in_degree: Dictionary, adjacency_list: Dictionary) -> void:
	in_degree[node_id] = 0
	adjacency_list[node_id] = []

## 构建入度表、邻接表并校验悬挂边与缺失前置
static func _build_degrees_and_edges(graph: NarrativeDAGGraphDTO, in_degree: Dictionary, adjacency_list: Dictionary) -> Dictionary:
	for node_id in graph.nodes.keys():
		_init_dag_buckets(node_id, in_degree, adjacency_list)

	for edge in graph.edges:
		if not graph.nodes.has(edge.from_node_id) or not graph.nodes.has(edge.to_node_id):
			return {
				"is_valid": false,
				"error_code": "DANGLING_EDGE",
				"message": TemplateFormatter.format(
					"Edge references non-existent node: {from_id} -> {to_id}",
					{"from_id": edge.from_node_id, "to_id": edge.to_node_id}
				)
			}
		adjacency_list[edge.from_node_id].append(edge.to_node_id)
		in_degree[edge.to_node_id] = int(in_degree.get(edge.to_node_id, 0)) + 1

	for node_id in graph.nodes.keys():
		var node: NarrativeDAGNode = graph.nodes[node_id]
		var prerequisite_result := _check_node_prerequisites(node_id, node, graph)
		if not prerequisite_result.get("is_valid", false):
			return prerequisite_result

	return {"is_valid": true}

## 基于 Kahn 拓扑排序算法检测死锁循环依赖环
static func _detect_cycle_kahn(graph: NarrativeDAGGraphDTO, in_degree: Dictionary, adjacency_list: Dictionary) -> Dictionary:
	var zero_in_degree_queue: Array[String] = []
	for node_id in in_degree.keys():
		if in_degree[node_id] == 0:
			zero_in_degree_queue.append(node_id)

	var head: int = 0
	var visited_count := 0
	while head < zero_in_degree_queue.size():
		var current: String = zero_in_degree_queue[head]
		head += 1
		visited_count += 1
		_drain_kahn_neighbors(current, adjacency_list, in_degree, zero_in_degree_queue)

	if visited_count < graph.nodes.size():
		return {
			"is_valid": false,
			"error_code": "CYCLE_DETECTED",
			"message": TemplateFormatter.format(
				"Cycle detected in narrative DAG: visited {visited} of {total} nodes",
				{"visited": visited_count, "total": graph.nodes.size()}
			)
		}

	return {"is_valid": true, "visited_count": visited_count}

## 消耗 Kahn 拓扑排序中当前节点的邻接入度
static func _drain_kahn_neighbors(current: String, adjacency_list: Dictionary, in_degree: Dictionary, frontier_queue: Array[String]) -> void:
	for neighbor in (adjacency_list.get(current, []) as Array):
		var neighbor_id := str(neighbor)
		in_degree[neighbor_id] = int(in_degree.get(neighbor_id, 0)) - 1
		if in_degree[neighbor_id] == 0:
			frontier_queue.append(neighbor_id)

## 校验非可选节点的入口可达闭包
static func _verify_reachability(graph: NarrativeDAGGraphDTO, adjacency_list: Dictionary = {}) -> Dictionary:
	var reachable := _collect_reachable_nodes(graph, adjacency_list)
	for node_id in graph.nodes.keys():
		if reachable.has(node_id):
			continue
		var node: NarrativeDAGNode = graph.nodes[node_id]
		if not node.is_optional:
			return {
				"is_valid": false,
				"error_code": "UNREACHABLE_NODE",
				"message": "非可选节点 %s 无法从入口 %s 沿边到达（孤立/断链）" % [node_id, graph.entry_node_id]
			}
	return {"is_valid": true}

## 对传入的剧情 DAG 图元进行静态拓扑校验 (Kahn 算法)
static func validate_graph(graph: NarrativeDAGGraphDTO) -> Dictionary:
	var integrity_result := _validate_graph_topology_integrity(graph)
	if not integrity_result.get("is_valid", false):
		return integrity_result

	var in_degree: Dictionary = {}
	var adjacency_list: Dictionary = {}
	var degree_result := _build_degrees_and_edges(graph, in_degree, adjacency_list)
	if not degree_result.get("is_valid", false):
		return degree_result

	var cycle_result := _detect_cycle_kahn(graph, in_degree, adjacency_list)
	if not cycle_result.get("is_valid", false):
		return cycle_result

	var reachability_result := _verify_reachability(graph, adjacency_list)
	if not reachability_result.get("is_valid", false):
		return reachability_result

	return {"is_valid": true, "sorted_node_count": cycle_result.get("visited_count", 0)}


static func _expand_reachable_edges(current: String, graph: NarrativeDAGGraphDTO, adjacency_list: Dictionary, reachable: Dictionary, frontier: Array[String]) -> void:
	if not adjacency_list.is_empty():
		var neighbors: Variant = adjacency_list.get(current, null)
		if neighbors is Array:
			for neighbor_node_id in (neighbors as Array):
				var next_id := str(neighbor_node_id)
				if not reachable.has(next_id):
					reachable[next_id] = true
					frontier.append(next_id)
		return
	for edge in graph.edges:
		if edge.from_node_id != current:
			continue
		var next_id := edge.to_node_id
		if not reachable.has(next_id):
			reachable[next_id] = true
			frontier.append(next_id)

## 从入口节点出发沿有向边收集可达节点集合（O(V+E) 邻接表 BFS）
static func _collect_reachable_nodes(graph: NarrativeDAGGraphDTO, adjacency_list: Dictionary = {}) -> Dictionary:
	var reachable := {graph.entry_node_id: true}
	var frontier: Array[String] = [graph.entry_node_id]
	var head: int = 0
	while head < frontier.size():
		var current: String = frontier[head]
		head += 1
		_expand_reachable_edges(current, graph, adjacency_list, reachable, frontier)
	return reachable

# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/narrative_orchestration/narrative_dag_graph_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/narrative_orchestration.json | 信号: EventBus 领域广播
# 职责说明: 封装完整剧情有向无环图，包含节点集合、边集合、入口与终态标记
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name NarrativeDAGGraphDTO
extends RefCounted

var graph_id: String = ""
var entry_node_id: String = ""
var terminal_node_id: String = ""
var nodes: Dictionary = {}  # node_id -> NarrativeDAGNode
var edges: Array[NarrativeDAGEdge] = []

## 图 DTO 构造（图 ID 装配）
func _init(p_id: String = "") -> void:
	graph_id = p_id

## 加入节点（非空且 ID 非空时按 ID 索引）
func add_node(node: NarrativeDAGNode) -> void:
	if node != null and not node.node_id.is_empty():
		nodes[node.node_id] = node

## 加入边（非空追加）
func add_edge(edge: NarrativeDAGEdge) -> void:
	if edge != null:
		edges.append(edge)

## 序列化为字典（节点/边递归 DTO）
func to_dto() -> Dictionary:
	var nodes_dict: Dictionary = {}
	for nid in nodes.keys():
		var n: NarrativeDAGNode = nodes[nid]
		nodes_dict[nid] = n.to_dto()

	var edges_arr: Array[Dictionary] = []
	for e in edges:
		edges_arr.append(e.to_dto())

	return {
		"graph_id": graph_id,
		"entry_node_id": entry_node_id,
		"terminal_node_id": terminal_node_id,
		"nodes": nodes_dict,
		"edges": edges_arr
	}

## 从字典重建图（节点/边逐条反序列化）
static func from_dto(d: Dictionary) -> NarrativeDAGGraphDTO:
	var graph := NarrativeDAGGraphDTO.new(str(d.get("graph_id", "")))
	graph.entry_node_id = str(d.get("entry_node_id", ""))
	graph.terminal_node_id = str(d.get("terminal_node_id", ""))

	var raw_nodes: Dictionary = d.get("nodes", {})
	for nid in raw_nodes.keys():
		var node := NarrativeDAGNode.from_dto(raw_nodes[nid] as Dictionary)
		graph.add_node(node)

	var raw_edges: Array = d.get("edges", [])
	for ed in raw_edges:
		var edge := NarrativeDAGEdge.from_dto(ed as Dictionary)
		graph.add_edge(edge)

	return graph

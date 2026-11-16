# ==============================================================================
# 模块归属: Frontend / Systems (模组工坊系统 Mod Workbench)
# 文件路径: res://frontend/systems/mod_workbench/mod_workbench_dag_layout_helper.gd
# 架构定位: Presentation Layout Helper / Narrative DAG Topology Serializer
# 依赖与触发: 上游: ModWorkbenchDagPanel | 下游: 无外部单向依赖
# 职责说明: 为 GraphEdit 剧情有向无环图提供 BFS 层次深度排布计算、连接边列表互转与标准节点/边字典构造原语。
# 退出语义与设计依据: 无状态纯静态拓扑计算辅助库，确保画布面板体积与认知复杂度受控
# ==============================================================================

## ModWorkbenchDagLayoutHelper：剧情 DAG 层次拓扑计算与 DTO 边转换纯静态助手
class_name ModWorkbenchDagLayoutHelper
extends RefCounted


## 计算从入口节点出发各可达节点的 BFS 分层深度，供 GraphEdit X/Y 坐标分配使用
static func compute_layer_depths(entry_node_id: String, edge_records: Array[Dictionary]) -> Dictionary:
	var depth_map: Dictionary = {}
	if entry_node_id.is_empty():
		return depth_map
	var frontier: Array[String] = [entry_node_id]
	depth_map[entry_node_id] = 0
	var cursor: int = 0
	while cursor < frontier.size():
		var current_node_id: String = frontier[cursor]
		cursor += 1
		var current_depth: int = int(depth_map.get(current_node_id, 0))
		for edge_entry in edge_records:
			if str(edge_entry.get("from_node_id", "")) == current_node_id:
				var neighbor_id: String = str(edge_entry.get("to_node_id", ""))
				if not depth_map.has(neighbor_id):
					depth_map[neighbor_id] = current_depth + 1
					frontier.append(neighbor_id)
	return depth_map


## 复制原始边列表为强类型 Dictionary 数组（循环外克隆确保热循环零瞬态分配）
static func clone_edge_array(raw_edges: Array) -> Array[Dictionary]:
	var cloned_list: Array[Dictionary] = []
	var cloned_source: Array = raw_edges.duplicate(true)
	for raw_edge in cloned_source:
		if raw_edge is Dictionary:
			cloned_list.append(raw_edge as Dictionary)
	return cloned_list


## 将 GraphEdit get_connection_list 单条连接映射为标准 NarrativeDAGEdge 字典结构
static func convert_connection_to_edge_dict(connection_entry: Dictionary) -> Dictionary:
	return {
		"from_node_id": str(connection_entry.get("from_node", "")),
		"to_node_id": str(connection_entry.get("to_node", "")),
		"branch_condition": {},
		"priority_weight": 100,
	}


## 构造默认剧情 DAG 节点数据字典
static func create_default_node_record(node_id: String, node_type: int, narrative_key: String) -> Dictionary:
	return {
		"node_id": node_id,
		"node_type": node_type,
		"narrative_key": narrative_key if not narrative_key.is_empty() else "narrative/custom/%s" % node_id.to_lower(),
		"inline_text": "",
		"choices": [],
		"required_prerequisites": [],
		"completion_condition_ast": {},
		"mutations_on_complete": [],
		"cutscene_trigger": "",
		"is_optional": false,
	}


## 构造默认有向边数据字典
static func make_edge_record(from_node_id: String, to_node_id: String) -> Dictionary:
	return {
		"from_node_id": from_node_id,
		"to_node_id": to_node_id,
		"branch_condition": {},
		"priority_weight": 100,
	}


## 从边集合中就地移除所有匹配起止节点标识的有向边
static func remove_edge_records(edge_records: Array[Dictionary], from_node_id: String, to_node_id: String) -> void:
	var cursor: int = edge_records.size() - 1
	while cursor >= 0:
		var edge_entry: Dictionary = edge_records[cursor]
		if str(edge_entry.get("from_node_id", "")) == from_node_id and str(edge_entry.get("to_node_id", "")) == to_node_id:
			edge_records.remove_at(cursor)
		cursor -= 1

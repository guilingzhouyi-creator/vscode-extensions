# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/narrative_orchestration/narrative_dag_execution_engine.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/narrative_orchestration.json | 信号: EventBus 领域广播
# 职责说明: 运行时编排 DAG 节点流转，管理条件分支选择、并行激活与汇聚等待 优化: 预编译出边邻接表索引与前置依赖哈希集合，消除全图全边线性遍历；支持会话 DTO 存盘恢复
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name NarrativeDagExecutionEngine
extends RefCounted

const NarrativeDagSessionDTOClass = preload("res://backend/domains/narrative_orchestration/narrative_dag_session_dto.gd")

var graph: NarrativeDAGGraphDTO = null
var active_node_ids: Array[String] = []
var completed_node_ids: Array[String] = []
var runtime_context: Dictionary = {}
var is_terminated: bool = false

## 出边邻接索引: from_node_id -> Array[NarrativeDAGEdge] (常数级获取出边)
var _outgoing_edges_index: Dictionary = {}
## 前置依赖哈希集合: completed_node_id -> true (O(1) 汇聚依赖检查)
var _completed_set: Dictionary = {}

## 以图结构初始化运行时会话：DAG 合法性校验（环检测/可达性）通过后激活入口节点并广播激活事件
func initialize_with_graph(p_graph: NarrativeDAGGraphDTO, initial_context: Dictionary = {}) -> Dictionary:
	if p_graph == null:
		return { "success": false, "error_code": "NULL_GRAPH" }

	var val_res := CausalityDagValidator.validate_graph(p_graph)
	if not val_res.get("is_valid", false):
		return { "success": false, "error_code": val_res.get("error_code", "INVALID_GRAPH"), "details": val_res }

	graph = p_graph
	_build_graph_indices()
	runtime_context = initial_context.duplicate(true)
	active_node_ids = [graph.entry_node_id]
	completed_node_ids = []
	_completed_set.clear()
	is_terminated = false

	_notify_event("narrative.dag.node_activated", {
		"dag_id": graph.graph_id,
		"node_id": graph.entry_node_id
	})

	return { "success": true, "entry_node_id": graph.entry_node_id }

## 预编译出边邻接表索引
func _build_graph_indices() -> void:
	_outgoing_edges_index.clear()
	if graph == null:
		return
	for edge in graph.edges:
		var from_id: String = edge.from_node_id
		if not _outgoing_edges_index.has(from_id):
			_outgoing_edges_index[from_id] = []
		_outgoing_edges_index[from_id].append(edge)

## 校验指定活跃节点是否可执行
func _verify_node_executable(node_id: String) -> Dictionary:
	if is_terminated:
		return { "success": false, "error_code": "GRAPH_ALREADY_TERMINATED" }

	if not active_node_ids.has(node_id):
		return { "success": false, "error_code": "NODE_NOT_ACTIVE", "node_id": node_id }

	if graph == null or not graph.nodes.has(node_id):
		return { "success": false, "error_code": "NODE_NOT_FOUND" }

	var current_node: NarrativeDAGNode = graph.nodes[node_id]
	for pre in current_node.required_prerequisites:
		if not _completed_set.has(pre):
			return {
				"success": false,
				"error_code": "PREREQUISITES_NOT_MET",
				"missing_pre": pre,
				"message": "汇聚前置节点 %s 尚未完成" % pre
			}
	return { "success": true }

## 提交节点动作完成态、合并载荷并广播完成事件
func _commit_node_completion(node_id: String, current_node: NarrativeDAGNode, action_payload: Dictionary) -> void:
	active_node_ids.erase(node_id)
	if not completed_node_ids.has(node_id):
		completed_node_ids.append(node_id)
		_completed_set[node_id] = true

	for k in action_payload.keys():
		runtime_context[k] = action_payload[k]

	_notify_event("narrative.dag.node_completed", {
		"dag_id": graph.graph_id,
		"node_id": node_id,
		"mutations": current_node.mutations_on_complete
	})

## 终态出口判定与广播
func _try_handle_terminal(node_id: String, current_node: NarrativeDAGNode) -> Dictionary:
	if node_id == graph.terminal_node_id or current_node.node_type == NarrativeDAGNode.NodeType.TERMINAL_EXIT:
		is_terminated = true
		active_node_ids.clear()
		_notify_event("narrative.dag.completed", {
			"dag_id": graph.graph_id,
			"terminal_node": node_id
		})
		return {
			"success": true,
			"status": "TERMINATED",
			"completed_node": node_id,
			"mutations": current_node.mutations_on_complete
		}
	return {}

## 派生激活下游分支或并行节点
func _derive_downstream_activations(node_id: String, current_node: NarrativeDAGNode) -> Array[String]:
	var newly_activated: Array[String] = []
	var outgoing_edges := _get_outgoing_edges(node_id)
	var matched_edges: Array[NarrativeDAGEdge] = []
	for edge in outgoing_edges:
		if _evaluate_edge_condition(edge.branch_condition, runtime_context):
			matched_edges.append(edge)

	var is_branch_choice: bool = current_node.node_type == NarrativeDAGNode.NodeType.BRANCH_CHOICE
	if is_branch_choice and matched_edges.size() > 1:
		var chosen: NarrativeDAGEdge = matched_edges[0]
		for i in range(1, matched_edges.size()):
			if matched_edges[i].priority_weight > chosen.priority_weight:
				chosen = matched_edges[i]
		matched_edges = [chosen]

	for edge in matched_edges:
		var next_id := edge.to_node_id
		var next_node: NarrativeDAGNode = graph.nodes.get(next_id)
		if next_node != null and _are_prerequisites_satisfied(next_node):
			if not active_node_ids.has(next_id):
				active_node_ids.append(next_id)
				newly_activated.append(next_id)
				_notify_event("narrative.dag.node_activated", {
					"dag_id": graph.graph_id,
					"node_id": next_id
				})
	return newly_activated

## 推进指定活跃节点的动作
func execute_node_action(node_id: String, action_payload: Dictionary = {}) -> Dictionary:
	var verify_res := _verify_node_executable(node_id)
	if not verify_res.get("success", false):
		return verify_res

	var current_node: NarrativeDAGNode = graph.nodes[node_id]
	_commit_node_completion(node_id, current_node, action_payload)

	var term_res := _try_handle_terminal(node_id, current_node)
	if not term_res.is_empty():
		return term_res

	var newly_activated := _derive_downstream_activations(node_id, current_node)
	if newly_activated.is_empty() and active_node_ids.is_empty() and not is_terminated:
		return {
			"success": false,
			"error_code": "HANGING_NO_EXIT",
			"completed_node": node_id,
			"message": "节点 %s 完成后无可用出边路径且未达终态（悬挂死路）" % node_id
		}

	return {
		"success": true,
		"completed_node": node_id,
		"newly_activated": newly_activated,
		"active_nodes": active_node_ids.duplicate(),
		"mutations": current_node.mutations_on_complete
	}

## 取节点全部出边（常数级从邻接表中获取）
func _get_outgoing_edges(from_id: String) -> Array[NarrativeDAGEdge]:
	var raw = _outgoing_edges_index.get(from_id, [])
	var res: Array[NarrativeDAGEdge] = []
	for e in raw:
		if e is NarrativeDAGEdge:
			res.append(e)
	return res

## 评估出边分支条件
func _evaluate_edge_condition(cond: Dictionary, ctx: Dictionary) -> bool:
	if cond.is_empty():
		return true
	var kind: String = str(cond.get("kind", ""))
	var target_val: Variant = cond.get("val", null)
	match kind:
		"CHOICE_MATCH":
			return ctx.get("selected_choice", "") == target_val
		"EQUALS":
			var key: String = str(cond.get("key", ""))
			return ctx.get(key, null) == target_val
	return true

## 汇聚前置依赖判定：基于哈希集合 O(1) 查找
func _are_prerequisites_satisfied(node: NarrativeDAGNode) -> bool:
	for pre in node.required_prerequisites:
		if not _completed_set.has(pre):
			return false
	return true

## 导出运行时会话状态快照（支持游戏存盘）
func export_session_dto() -> RefCounted:
	var dto = NarrativeDagSessionDTOClass.new()
	dto.graph_id = graph.graph_id if graph else ""
	dto.active_node_ids = active_node_ids.duplicate()
	dto.completed_node_ids = completed_node_ids.duplicate()
	dto.runtime_context = runtime_context.duplicate(true)
	dto.is_terminated = is_terminated
	dto.snapshot_timestamp_utc = int(Time.get_unix_time_from_system())
	return dto

## 从快照恢复运行时会话状态
func restore_session_dto(dto: RefCounted, p_graph: NarrativeDAGGraphDTO) -> Dictionary:
	if dto == null or p_graph == null or dto.graph_id != p_graph.graph_id:
		return { "success": false, "error_code": "INVALID_RESTORE_PAYLOAD" }
	graph = p_graph
	_build_graph_indices()
	active_node_ids.clear()
	for nid in dto.active_node_ids:
		active_node_ids.append(str(nid))
	completed_node_ids.clear()
	_completed_set.clear()
	for cid in dto.completed_node_ids:
		var scid := str(cid)
		completed_node_ids.append(scid)
		_completed_set[scid] = true
	runtime_context = dto.runtime_context.duplicate(true)
	is_terminated = dto.is_terminated
	return { "success": true, "restored_nodes": active_node_ids.size() }

## 域事件广播
func _notify_event(channel: String, payload: Dictionary) -> void:
	var bus := EventBusCore.get_instance()
	if bus != null:
		bus.emit_domain_event(channel, payload)

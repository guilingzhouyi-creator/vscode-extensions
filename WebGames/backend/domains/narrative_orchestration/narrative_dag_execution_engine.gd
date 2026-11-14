# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/narrative_orchestration/narrative_dag_execution_engine.gd
# 架构定位: Domain Logic Component
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/narrative_orchestration.json | 信号: EventBus 领域广播
# 职责说明: 运行时编排 DAG 节点流转，管理条件分支选择、并行激活与汇聚等待 优化: 预编译出边邻接表索引与前置依赖哈希集合，消除全图全边线性遍历；支持会话 DTO 存盘恢复
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## NarrativeDagExecutionEngine：Domain Logic Component
class_name NarrativeDagExecutionEngine
extends RefCounted

const NarrativeDagSessionDTOClass = preload("res://backend/domains/narrative_orchestration/narrative_dag_session_dto.gd")

var graph: NarrativeDAGGraphDTO = null
var active_node_ids: Array[String] = []
var completed_node_ids: Array[String] = []
var runtime_context: Dictionary = {}
var is_terminated: bool = false
var _hook_interceptor: Callable = Callable()

## 出边邻接索引: from_node_id -> Array[NarrativeDAGEdge] (常数级获取出边)
var _outgoing_edges_index: Dictionary = {}
## 前置依赖哈希集合: completed_node_id -> true (O(1) 汇聚依赖检查)
var _completed_set: Dictionary = {}

## 注册剧情节点拦截器（供 CG/视频播放等外部 Hook 挂接，解耦硬编码）
func set_hook_interceptor(interceptor: Callable) -> void:
	_hook_interceptor = interceptor

## 获取当前注册的剧情节点拦截器
func get_hook_interceptor() -> Callable:
	return _hook_interceptor

## 以图结构初始化运行时会话：DAG 合法性校验（环检测/可达性）通过后激活入口节点并广播激活事件
func initialize_with_graph(target_graph: NarrativeDAGGraphDTO, initial_context: Dictionary = {}) -> Dictionary:
	if target_graph == null:
		return { "success": false, "error_code": "NULL_GRAPH" }

	var validation_result := CausalityDagValidator.validate_graph(target_graph)
	if not validation_result.get("is_valid", false):
		return { "success": false, "error_code": validation_result.get("error_code", "INVALID_GRAPH"), "details": validation_result }

	graph = target_graph
	_build_graph_indices()
	runtime_context = initial_context.duplicate(true)
	active_node_ids = [graph.entry_node_id]
	completed_node_ids = []
	_completed_set.clear()
	is_terminated = false

	if _hook_interceptor.is_valid():
		_hook_interceptor.call(graph.graph_id, graph.entry_node_id, true)

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
		_append_outgoing_edge(edge.from_node_id, edge)

func _append_outgoing_edge(from_id: String, edge: Variant) -> void:
	if not _outgoing_edges_index.has(from_id):
		_outgoing_edges_index[from_id] = []
	(_outgoing_edges_index[from_id] as Array).append(edge)

## 校验指定活跃节点是否可执行
func _verify_node_executable(node_id: String) -> Dictionary:
	if is_terminated:
		return { "success": false, "error_code": "GRAPH_ALREADY_TERMINATED" }

	if not active_node_ids.has(node_id):
		return { "success": false, "error_code": "NODE_NOT_ACTIVE", "node_id": node_id }

	if graph == null or not graph.nodes.has(node_id):
		return { "success": false, "error_code": "NODE_NOT_FOUND" }

	var current_node: NarrativeDAGNode = graph.nodes[node_id]
	for prerequisite_id in current_node.required_prerequisites:
		if not _completed_set.has(prerequisite_id):
			return {
				"success": false,
				"error_code": "PREREQUISITES_NOT_MET",
				"missing_pre": prerequisite_id,
				"message": "汇聚前置节点 %s 尚未完成" % prerequisite_id
			}
	return { "success": true }

## 提交节点动作完成态、合并载荷并广播完成事件
func _commit_node_completion(node_id: String, current_node: NarrativeDAGNode, action_payload: Dictionary) -> void:
	active_node_ids.erase(node_id)
	if not completed_node_ids.has(node_id):
		completed_node_ids.append(node_id)
		_completed_set[node_id] = true

	for payload_key in action_payload.keys():
		runtime_context[payload_key] = action_payload[payload_key]

	if _hook_interceptor.is_valid():
		_hook_interceptor.call(graph.graph_id, node_id, false)

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
		for edge_index in range(1, matched_edges.size()):
			if matched_edges[edge_index].priority_weight > chosen.priority_weight:
				chosen = matched_edges[edge_index]
		matched_edges = [chosen]

	for edge in matched_edges:
		var next_id := edge.to_node_id
		var next_node: NarrativeDAGNode = graph.nodes.get(next_id)
		if next_node != null and _are_prerequisites_satisfied(next_node):
			if not active_node_ids.has(next_id):
				active_node_ids.append(next_id)
				newly_activated.append(next_id)
				if _hook_interceptor.is_valid():
					_hook_interceptor.call(graph.graph_id, next_id, true)
				_notify_event("narrative.dag.node_activated", {
					"dag_id": graph.graph_id,
					"node_id": next_id
				})
	return newly_activated

## 推进指定活跃节点的动作
func execute_node_action(node_id: String, action_payload: Dictionary = {}) -> Dictionary:
	var verification_result := _verify_node_executable(node_id)
	if not verification_result.get("success", false):
		return verification_result

	var current_node: NarrativeDAGNode = graph.nodes[node_id]
	_commit_node_completion(node_id, current_node, action_payload)

	var terminal_result := _try_handle_terminal(node_id, current_node)
	if not terminal_result.is_empty():
		return terminal_result

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
	var raw: Variant = _outgoing_edges_index.get(from_id, [])
	var typed_edges: Array[NarrativeDAGEdge] = []
	for edge_entry in raw:
		if edge_entry is NarrativeDAGEdge:
			typed_edges.append(edge_entry)
	return typed_edges

## 评估出边分支条件
func _evaluate_edge_condition(condition: Dictionary, context: Dictionary) -> bool:
	if condition.is_empty():
		return true
	var kind: String = str(condition.get("kind", ""))
	var target_value: Variant = condition.get("val", null)
	match kind:
		"CHOICE_MATCH":
			return context.get("selected_choice", "") == target_value
		"EQUALS":
			var key: String = str(condition.get("key", ""))
			return context.get(key, null) == target_value
	return true

## 汇聚前置依赖判定：基于哈希集合 O(1) 查找
func _are_prerequisites_satisfied(node: NarrativeDAGNode) -> bool:
	for prerequisite_id in node.required_prerequisites:
		if not _completed_set.has(prerequisite_id):
			return false
	return true

## 导出运行时会话状态快照（支持游戏存盘）
func export_session_dto() -> RefCounted:
	var session_snapshot: Variant = NarrativeDagSessionDTOClass.new()
	session_snapshot.graph_id = graph.graph_id if graph else ""
	session_snapshot.active_node_ids = active_node_ids.duplicate()
	session_snapshot.completed_node_ids = completed_node_ids.duplicate()
	session_snapshot.runtime_context = runtime_context.duplicate(true)
	session_snapshot.is_terminated = is_terminated
	session_snapshot.snapshot_timestamp_utc = int(Time.get_unix_time_from_system())
	return session_snapshot

## 从快照恢复运行时会话状态
func restore_session_dto(session_snapshot: RefCounted, target_graph: NarrativeDAGGraphDTO) -> Dictionary:
	if session_snapshot == null or target_graph == null or session_snapshot.graph_id != target_graph.graph_id:
		return { "success": false, "error_code": "INVALID_RESTORE_PAYLOAD" }
	graph = target_graph
	_build_graph_indices()
	active_node_ids.clear()
	for node_id in session_snapshot.active_node_ids:
		active_node_ids.append(str(node_id))
	completed_node_ids.clear()
	_completed_set.clear()
	for completed_id in session_snapshot.completed_node_ids:
		var completed_node_id := str(completed_id)
		completed_node_ids.append(completed_node_id)
		_completed_set[completed_node_id] = true
	runtime_context = session_snapshot.runtime_context.duplicate(true)
	is_terminated = session_snapshot.is_terminated
	return { "success": true, "restored_nodes": active_node_ids.size() }

## 域事件广播
func _notify_event(channel: String, payload: Dictionary) -> void:
	var bus := EventBusCore.get_instance()
	if bus != null:
		bus.emit_domain_event(channel, payload)

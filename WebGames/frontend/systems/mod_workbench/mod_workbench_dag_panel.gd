# ==============================================================================
# 模块归属: Frontend / Systems (模组工坊系统 Mod Workbench)
# 文件路径: res://frontend/systems/mod_workbench/mod_workbench_dag_panel.gd
# 架构定位: Presentation Component / Narrative DAG Visual GraphEdit Controller
# 依赖与触发: 上游: ModWorkbenchView | 下游: DesignTokens, UIIntermediary
# 职责说明: 基于 Godot GraphEdit 渲染与编辑 NarrativeDAGGraphDTO 拓扑节点与有向边，支持新增节点、连边及双向 DTO 导出。
# 退出语义与设计依据: 每次重建或销毁对称清理子节点防止 orphan 节点泄漏，色彩严守 DesignTokens 单源规范
# ==============================================================================

## ModWorkbenchDagPanel：基于 GraphEdit 的剧情因果 DAG 可视化节点编辑面板
class_name ModWorkbenchDagPanel
extends VBoxContainer

signal dag_modified(dag_payload: Dictionary)

const GRAPH_MIN_HEIGHT: float = 260.0
const LAYER_SPACING_X: float = 260.0
const ROW_SPACING_Y: float = 130.0
const NODE_MIN_WIDTH: float = 190.0

var _graph_id: String = "DAG_CUSTOM"
var _entry_node_id: String = ""
var _terminal_node_id: String = ""
var _node_records: Dictionary = {}
var _edge_records: Array[Dictionary] = []
var _graph_editor: GraphEdit = null
var _toolbar: HBoxContainer = null
var _add_node_button: Button = null
var _relayout_button: Button = null
var _status_label: Label = null
var _graph_nodes_by_id: Dictionary = {}


func _init() -> void:
	name = "ModWorkbenchDagPanel"
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	size_flags_vertical = Control.SIZE_EXPAND_FILL
	_build_controls()


func _exit_tree() -> void:
	_disconnect_editor_signals()
	clear_graph()


## 渲染标准 NarrativeDAGGraph 字典载荷到 GraphEdit 画布，并高亮当前推演活跃节点
func render_dag_payload(dag_payload: Dictionary, active_node_id: String = "") -> void:
	clear_graph()
	_graph_id = str(dag_payload.get("dag_id", dag_payload.get("graph_id", "DAG_CUSTOM")))
	_entry_node_id = str(dag_payload.get("entry_node_id", ""))
	_terminal_node_id = str(dag_payload.get("terminal_node_id", ""))

	var raw_nodes: Variant = dag_payload.get("nodes", {})
	if raw_nodes is Dictionary:
		_node_records = (raw_nodes as Dictionary).duplicate(true)
	var raw_edges: Variant = dag_payload.get("edges", [])
	if raw_edges is Array:
		_edge_records = ModWorkbenchDagLayoutHelper.clone_edge_array(raw_edges as Array)

	var depth_map: Dictionary = ModWorkbenchDagLayoutHelper.compute_layer_depths(_entry_node_id, _edge_records)
	var layer_row_counts: Dictionary = {}
	var sorted_ids: Array = _node_records.keys()
	sorted_ids.sort()
	for node_key in sorted_ids:
		var node_id: String = str(node_key)
		var layer_depth: int = int(depth_map.get(node_id, 0))
		var row_slot: int = int(layer_row_counts.get(layer_depth, 0))
		layer_row_counts[layer_depth] = row_slot + 1
		var created_node: GraphNode = _spawn_graph_node(node_id, layer_depth, row_slot)
		_graph_nodes_by_id[node_id] = created_node

	for edge_entry in _edge_records:
		var from_id: String = str(edge_entry.get("from_node_id", edge_entry.get("from", "")))
		var to_id: String = str(edge_entry.get("to_node_id", edge_entry.get("to", "")))
		if _graph_nodes_by_id.has(from_id) and _graph_nodes_by_id.has(to_id):
			_graph_editor.connect_node(StringName(from_id), 0, StringName(to_id), 0)

	highlight_active_node(active_node_id)
	_refresh_status_summary()


## 导出当前 GraphEdit 拓扑节点与有向边为标准 NarrativeDAGGraphDTO 兼容字典
func export_dag_payload() -> Dictionary:
	var exported_edges: Array[Dictionary] = []
	if _graph_editor != null:
		var connection_list: Array[Dictionary] = _graph_editor.get_connection_list()
		for connection_entry in connection_list:
			exported_edges.append(ModWorkbenchDagLayoutHelper.convert_connection_to_edge_dict(connection_entry))
	else:
		exported_edges = _edge_records.duplicate(true)

	return {
		"graph_id": _graph_id,
		"dag_id": _graph_id,
		"entry_node_id": _entry_node_id,
		"terminal_node_id": _terminal_node_id,
		"nodes": _node_records.duplicate(true),
		"edges": exported_edges,
	}


## 在当前 DAG 中新增一个受控节点并刷新视图渲染
func add_custom_node(node_id: String, node_type: int = 1, narrative_key: String = "") -> Dictionary:
	var clean_node_id: String = node_id.strip_edges()
	if clean_node_id.is_empty():
		clean_node_id = "NODE_CUSTOM_%02d" % (_node_records.size() + 1)
	if not _node_records.has(clean_node_id):
		var new_record: Dictionary = ModWorkbenchDagLayoutHelper.create_default_node_record(clean_node_id, node_type, narrative_key)
		_node_records[clean_node_id] = new_record
		if _entry_node_id.is_empty():
			_entry_node_id = clean_node_id
		render_dag_payload(export_dag_payload(), clean_node_id)
		dag_modified.emit(export_dag_payload())
	return (_node_records[clean_node_id] as Dictionary).duplicate(true)


## 在两个已存在的节点之间建立有向边连接并触发变更信号
func link_nodes(from_node_id: String, to_node_id: String) -> bool:
	if from_node_id == to_node_id:
		return false
	if not _graph_nodes_by_id.has(from_node_id) or not _graph_nodes_by_id.has(to_node_id):
		return false
	_edge_records.append(ModWorkbenchDagLayoutHelper.make_edge_record(from_node_id, to_node_id))
	_graph_editor.connect_node(StringName(from_node_id), 0, StringName(to_node_id), 0)
	_refresh_status_summary()
	dag_modified.emit(export_dag_payload())
	return true


## 根据当前活跃节点标识刷新画布节点高亮与状态摘要
func highlight_active_node(active_node_id: String) -> void:
	for node_key in _graph_nodes_by_id.keys():
		var graph_node: GraphNode = _graph_nodes_by_id[node_key] as GraphNode
		if graph_node == null or not is_instance_valid(graph_node):
			continue
		var is_active: bool = (str(node_key) == active_node_id) and not active_node_id.is_empty()
		graph_node.selected = is_active
		graph_node.modulate = DesignTokens.COLOR_ACCENT_DEFAULT if is_active else DesignTokens.COLOR_TEXT_PRIMARY


## 获取当前画布已挂载节点数量
func get_node_count() -> int:
	return _graph_nodes_by_id.size()


## 获取当前 GraphEdit 已建立的连接边数量
func get_connection_count() -> int:
	return _graph_editor.get_connection_list().size() if _graph_editor != null else _edge_records.size()


## 清空 GraphEdit 全部连线并即时销毁子节点以保持零孤儿泄漏
func clear_graph() -> void:
	if _graph_editor != null:
		_graph_editor.clear_connections()
		for node_key in _graph_nodes_by_id.keys():
			var node_widget: Node = _graph_nodes_by_id[node_key] as Node
			if node_widget != null and is_instance_valid(node_widget):
				_graph_editor.remove_child(node_widget)
				node_widget.free()
	_graph_nodes_by_id.clear()


func _build_controls() -> void:
	_toolbar = HBoxContainer.new()
	_toolbar.name = "DagToolbar"
	add_child(_toolbar)

	_add_node_button = Button.new()
	_add_node_button.name = "DagAddNodeButton"
	UIIntermediary.resolve(_add_node_button, "ui.mw.dag.add_node")
	_add_node_button.pressed.connect(_on_add_node_pressed)
	_toolbar.add_child(_add_node_button)

	_relayout_button = Button.new()
	_relayout_button.name = "DagRelayoutButton"
	UIIntermediary.resolve(_relayout_button, "ui.mw.dag.relayout")
	_relayout_button.pressed.connect(_on_relayout_pressed)
	_toolbar.add_child(_relayout_button)

	_status_label = Label.new()
	_status_label.name = "DagStatusLabel"
	_status_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	UIIntermediary.resolve(_status_label, "ui.mw.dag.empty")
	_toolbar.add_child(_status_label)

	_graph_editor = GraphEdit.new()
	_graph_editor.name = "NarrativeGraphEdit"
	_graph_editor.custom_minimum_size.y = GRAPH_MIN_HEIGHT
	_graph_editor.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_graph_editor.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_graph_editor.connection_request.connect(_on_connection_request)
	_graph_editor.disconnection_request.connect(_on_disconnection_request)
	add_child(_graph_editor)


func _disconnect_editor_signals() -> void:
	if _add_node_button != null and _add_node_button.pressed.is_connected(_on_add_node_pressed):
		_add_node_button.pressed.disconnect(_on_add_node_pressed)
	if _relayout_button != null and _relayout_button.pressed.is_connected(_on_relayout_pressed):
		_relayout_button.pressed.disconnect(_on_relayout_pressed)
	if _graph_editor != null and _graph_editor.connection_request.is_connected(_on_connection_request):
		_graph_editor.connection_request.disconnect(_on_connection_request)
	if _graph_editor != null and _graph_editor.disconnection_request.is_connected(_on_disconnection_request):
		_graph_editor.disconnection_request.disconnect(_on_disconnection_request)


func _on_add_node_pressed() -> void:
	add_custom_node("", 1, "")


func _on_relayout_pressed() -> void:
	render_dag_payload(export_dag_payload(), "")


func _on_connection_request(from_node: StringName, from_port: int, to_node: StringName, to_port: int) -> void:
	if from_node == to_node:
		return
	_graph_editor.connect_node(from_node, from_port, to_node, to_port)
	_edge_records.append(ModWorkbenchDagLayoutHelper.make_edge_record(str(from_node), str(to_node)))
	_refresh_status_summary()
	dag_modified.emit(export_dag_payload())


func _on_disconnection_request(from_node: StringName, from_port: int, to_node: StringName, to_port: int) -> void:
	_graph_editor.disconnect_node(from_node, from_port, to_node, to_port)
	ModWorkbenchDagLayoutHelper.remove_edge_records(_edge_records, str(from_node), str(to_node))
	_refresh_status_summary()
	dag_modified.emit(export_dag_payload())


func _spawn_graph_node(node_id: String, layer_depth: int, row_slot: int) -> GraphNode:
	var raw_node: Dictionary = _node_records.get(node_id, {}) as Dictionary
	var graph_node := GraphNode.new()
	graph_node.name = StringName(node_id)
	graph_node.title = "%s [%s]" % [node_id, str(raw_node.get("node_type", 1))]
	graph_node.custom_minimum_size.x = NODE_MIN_WIDTH
	graph_node.position_offset.x = float(layer_depth) * LAYER_SPACING_X + 24.0
	graph_node.position_offset.y = float(row_slot) * ROW_SPACING_Y + 24.0

	var summary_label := Label.new()
	summary_label.text = str(raw_node.get("narrative_key", raw_node.get("inline_text", node_id)))
	graph_node.add_child(summary_label)
	graph_node.set_slot(0, true, 0, DesignTokens.COLOR_ACCENT_DEFAULT, true, 0, DesignTokens.COLOR_SUCCESS_DEFAULT)
	_graph_editor.add_child(graph_node)
	return graph_node


func _refresh_status_summary() -> void:
	if _status_label != null:
		_status_label.text = UIIntermediary.text("ui.mw.dag.summary", {
			"graph_id": _graph_id,
			"nodes": _graph_nodes_by_id.size(),
			"edges": get_connection_count(),
		})

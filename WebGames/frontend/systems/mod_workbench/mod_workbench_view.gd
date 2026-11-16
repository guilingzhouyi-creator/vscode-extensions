# ==============================================================================
# 模块归属: Frontend / Systems (模组工坊系统 Mod Workbench)
# 文件路径: res://frontend/systems/mod_workbench/mod_workbench_view.gd
# 架构定位: UI Placeholder Contract / Lightweight Whitebox View
# 依赖与触发: 上游: 模组系统路由与前端主视口 | 下游: AgentPlaythroughSession
# 职责说明: 模组工坊前端轻量白模与契约预留接口（预留会话绑定与快照重放接口契约，暂不装配复杂控件树）
# 退出语义与设计依据: 保持表现层轻量化与高内聚解耦，仅维护只读快照副本与弱耦合会话引用
# ==============================================================================

## ModWorkbenchView：模组工坊全功能系统容器，集成 DAG 图编辑器、伴侣实时步进调试器与清单元数据编辑面板
class_name ModWorkbenchView
extends Control

const STUDIO_MIN_HEIGHT: float = 300.0
const DagPanelClass = preload("res://frontend/systems/mod_workbench/mod_workbench_dag_panel.gd")
const CompanionPanelClass = preload("res://frontend/systems/mod_workbench/mod_workbench_companion_panel.gd")
const ManifestPanelClass = preload("res://frontend/systems/mod_workbench/mod_workbench_manifest_panel.gd")

var _bound_session: RefCounted = null
var _tab_container: TabContainer = null
var _dag_panel: ModWorkbenchDagPanel = null
var _companion_panel: ModWorkbenchCompanionPanel = null
var _manifest_panel: ModWorkbenchManifestPanel = null
var _has_dag_edits: bool = false
var _workbench_state: Dictionary = {
	"is_bound": false,
	"session_id": "",
	"current_step": 0,
	"active_node_id": "",
	"cached_snapshot": {}
}

func _ready() -> void:
	ensure_studio_panels_mounted()

func _exit_tree() -> void:
	teardown()

# ==============================================================================
# 一、会话绑定与契约接口
# ==============================================================================

## 绑定长程交互式推演会话（轻量弱耦合存储，按需挂载伴侣调试面板）
func bind_session(session: AgentPlaythroughSession) -> void:
	_bound_session = session
	if session == null:
		_workbench_state["is_bound"] = false
		_workbench_state["session_id"] = ""
		if _companion_panel != null:
			_companion_panel.bind_session(null)
		return

	_workbench_state["is_bound"] = true
	_workbench_state["session_id"] = session.session_id
	_workbench_state["current_step"] = session.step_index
	if _companion_panel != null:
		_companion_panel.bind_session(session)

## 获取当前工坊状态字典（保持轻量白盒快照契约与会话投影一致）
func get_workbench_state() -> Dictionary:
	if _bound_session != null and _bound_session is AgentPlaythroughSession:
		var active_session: AgentPlaythroughSession = _bound_session
		_workbench_state["session_id"] = active_session.session_id
		_workbench_state["current_step"] = active_session.step_index
		_workbench_state["is_terminal"] = active_session.is_terminal
	_workbench_state["studio_mounted"] = _tab_container != null
	return _workbench_state.duplicate(true)

## 应用推演或工坊快照数据并同步刷新伴侣与 DAG 高亮
func apply_snapshot(snapshot: Dictionary) -> void:
	if snapshot.is_empty():
		return
	_workbench_state["cached_snapshot"] = snapshot.duplicate(true)
	if snapshot.has("session_id"):
		_workbench_state["session_id"] = str(snapshot.get("session_id", ""))
	if snapshot.has("step_index"):
		_workbench_state["current_step"] = int(snapshot.get("step_index", 0))
	if snapshot.has("current_node_id"):
		_workbench_state["active_node_id"] = str(snapshot.get("current_node_id", ""))
	if _companion_panel != null:
		_companion_panel.apply_observation_snapshot(snapshot)
	if _dag_panel != null and _dag_panel.get_node_count() > 0:
		_dag_panel.highlight_active_node(str(_workbench_state.get("active_node_id", "")))

# ==============================================================================
# 二、全功能工坊子面板挂载与协同方法
# ==============================================================================

## 惰性装配 DAG 编辑器、伴侣调试台与清单编辑标签页容器
func ensure_studio_panels_mounted() -> void:
	if _tab_container != null:
		return
	custom_minimum_size.y = STUDIO_MIN_HEIGHT
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	size_flags_vertical = Control.SIZE_EXPAND_FILL

	_tab_container = TabContainer.new()
	_tab_container.name = "StudioTabContainer"
	_tab_container.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_tab_container.size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_child(_tab_container)

	_manifest_panel = ManifestPanelClass.new()
	_tab_container.add_child(_manifest_panel)
	_tab_container.set_tab_title(0, UIIntermediary.text("ui.mw.tab.manifest"))

	_dag_panel = DagPanelClass.new()
	_dag_panel.dag_modified.connect(_on_dag_panel_modified)
	_tab_container.add_child(_dag_panel)
	_tab_container.set_tab_title(1, UIIntermediary.text("ui.mw.tab.dag"))

	_companion_panel = CompanionPanelClass.new()
	_companion_panel.session_step_executed.connect(_on_companion_step_executed)
	_tab_container.add_child(_companion_panel)
	_tab_container.set_tab_title(2, UIIntermediary.text("ui.mw.tab.companion"))

	if _bound_session != null and _bound_session is AgentPlaythroughSession:
		_companion_panel.bind_session(_bound_session as AgentPlaythroughSession)

## 加载 NarrativeDAGGraphDTO 或字典载荷进入 DAG 图画布
func load_dag_dto(dag_payload: Variant) -> void:
	ensure_studio_panels_mounted()
	var serialized: Dictionary = (dag_payload as Object).call("to_dto") if (dag_payload is Object and (dag_payload as Object).has_method("to_dto")) else (dag_payload as Dictionary if dag_payload is Dictionary else {})
	_has_dag_edits = false
	_dag_panel.render_dag_payload(serialized, str(_workbench_state.get("active_node_id", "")))

## 导出当前 DAG 图画布数据字典
func export_dag_dto() -> Dictionary:
	return _dag_panel.export_dag_payload() if _dag_panel != null else {}

## 根据右侧选中的 MOD 条目刷新元数据编辑表单与首个磁盘 DAG 图预览
func sync_focused_pack(pack_entry: Dictionary) -> void:
	ensure_studio_panels_mounted()
	_manifest_panel.load_pack_entry(pack_entry)
	var pack_root: String = str(pack_entry.get("root_path", "")).strip_edges()
	if not pack_root.is_empty():
		var first_dag: Dictionary = _read_first_pack_dag(pack_root)
		if not first_dag.is_empty():
			load_dag_dto(first_dag)
			return
	load_dag_dto({"dag_id": str(pack_entry.get("pack_id", "DAG_PREVIEW")), "nodes": {}, "edges": []})

## 触发绑定会话的单步决策并同步高亮 DAG 活跃节点
func step_companion_session(choice_id: String = "") -> Dictionary:
	ensure_studio_panels_mounted()
	var observation: Dictionary = _companion_panel.step_with_choice(choice_id)
	apply_snapshot(observation)
	return observation

## 触发绑定会话的快照回滚并同步刷新 DAG 活跃节点
func rollback_companion_session() -> Dictionary:
	ensure_studio_panels_mounted()
	var observation: Dictionary = _companion_panel.rollback_last_step()
	apply_snapshot(observation)
	return observation

## 向清单编辑子面板显示保存或删除操作的反馈提示
func show_manifest_feedback(feedback_text: String, is_failure: bool = false) -> void:
	if _manifest_panel != null:
		_manifest_panel.set_feedback(feedback_text, is_failure)

## 更新热重载求解器最近状态摘要到伴侣面板
func refresh_hot_reload_status(status_payload: Dictionary) -> void:
	if _companion_panel != null:
		_companion_panel.refresh_hot_reload_status(status_payload)

## 查询是否存在未保存的 DAG 图编辑改动
func has_dag_edits() -> bool:
	return _has_dag_edits

## 获取 DAG 编辑器子面板
func get_dag_panel() -> ModWorkbenchDagPanel:
	return _dag_panel

## 获取伴侣步进调试子面板
func get_companion_panel() -> ModWorkbenchCompanionPanel:
	return _companion_panel

## 获取清单元数据编辑子面板
func get_manifest_panel() -> ModWorkbenchManifestPanel:
	return _manifest_panel

## 对称清理全部子面板状态与伴侣观察订阅
func teardown() -> void:
	if _companion_panel != null and is_instance_valid(_companion_panel):
		_companion_panel.teardown()
	if _dag_panel != null and is_instance_valid(_dag_panel):
		_dag_panel.clear_graph()
	_bound_session = null

func _on_dag_panel_modified(_dag_payload: Dictionary) -> void:
	_has_dag_edits = true

func _on_companion_step_executed(observation: Dictionary) -> void:
	apply_snapshot(observation)

func _read_first_pack_dag(pack_root: String) -> Dictionary:
	var dag_directory_path: String = pack_root.path_join("dag_graphs")
	var directory_handle := DirAccess.open(dag_directory_path)
	if directory_handle == null:
		return {}
	directory_handle.list_dir_begin()
	var file_name: String = directory_handle.get_next()
	var selected_file: String = ""
	while file_name != "":
		if not directory_handle.current_is_dir() and file_name.ends_with(".json"):
			selected_file = dag_directory_path.path_join(file_name)
			break
		file_name = directory_handle.get_next()
	directory_handle.list_dir_end()
	if selected_file.is_empty() or not FileAccess.file_exists(selected_file):
		return {}
	var parsed_variant: Variant = JSON.parse_string(FileAccess.get_file_as_string(selected_file))
	return (parsed_variant as Dictionary) if parsed_variant is Dictionary else {}

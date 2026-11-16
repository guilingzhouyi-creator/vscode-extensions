# ==============================================================================
# 模块归属: 前端工作台系统集成测试 (Tests · Unit · Frontend · Mod Workbench Studio)
# 文件路径: res://tests/unit/frontend/test_fe_mod_workbench_studio.gd
# 架构定位: ModWorkbenchScreen 内嵌 GraphEdit DAG、伴侣步进黑匣子与清单编辑面板端到端测试
# 依赖与触发: 上游: test_fe_runner.gd / TestRegistry | 下游: ModWorkbenchScreen, ModWorkbenchView, AgentPlaythroughSession
# ==============================================================================

## MOD 工坊工作台内置编辑器面板与真场景生命周期端到端测试套件
class_name TestFEModWorkbenchStudio
extends RefCounted

const WORKBENCH_SCENE_PATH: String = "res://frontend/views/mod_workbench/mod_workbench_screen.tscn"


static func run_all_tests() -> Dictionary:
	var test_outcomes: Array[Dictionary] = [
		_test_dag_graphedit_dto_roundtrip(),
		_test_companion_panel_step_rollback_and_hot_reload(),
		_test_manifest_panel_metadata_signals_and_cleanup(),
	]
	var passed_count: int = 0
	for outcome_entry in test_outcomes:
		if bool(outcome_entry.get("passed", false)):
			passed_count += 1
	return {
		"domain": "FE Studio: MOD 工坊工作台 DAG 编辑器、伴侣调试与清单元数据面板",
		"passed_count": passed_count,
		"total_count": test_outcomes.size(),
		"all_passed": passed_count == test_outcomes.size(),
		"results": test_outcomes,
	}


static func _test_dag_graphedit_dto_roundtrip() -> Dictionary:
	var initial_orphans: int = int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT))
	var mount_handle: Dictionary = FeMountTestHelper.mount_scene(WORKBENCH_SCENE_PATH, "mock")
	var mounted_screen: ModWorkbenchScreen = mount_handle.get("view") as ModWorkbenchScreen
	var studio_ready: bool = bool(mount_handle.get("ok", false)) and mounted_screen != null
	if mounted_screen != null:
		mounted_screen.on_screen_enter({})
	var studio_view: ModWorkbenchView = mounted_screen.get_studio_view() as ModWorkbenchView if mounted_screen != null else null
	if studio_view == null:
		FeMountTestHelper.unmount_scene(mount_handle)
		return {"test": "TC-STUDIO-01: GraphEdit 画布加载与 NarrativeDAGGraphDTO 双向序列化", "passed": false}

	var sample_graph: Dictionary = {
		"dag_id": "DAG_STUDIO_VERIFY",
		"entry_node_id": "N_BEGIN",
		"terminal_node_id": "N_FINISH",
		"nodes": {
			"N_BEGIN": {"node_id": "N_BEGIN", "node_type": 0, "narrative_key": "ui.mw.panel.header", "outgoing_edges": ["N_FINISH"]},
			"N_FINISH": {"node_id": "N_FINISH", "node_type": 3, "narrative_key": "ui.mw.btn.pack", "outgoing_edges": []},
		},
		"edges": [{"from_node_id": "N_BEGIN", "to_node_id": "N_FINISH"}],
	}
	studio_view.load_dag_dto(sample_graph)
	var dag_panel: ModWorkbenchDagPanel = studio_view.get_dag_panel()
	var initial_counts_ok: bool = dag_panel != null and dag_panel.get_node_count() == 2 and dag_panel.get_connection_count() == 1
	var added_node: Dictionary = dag_panel.add_custom_node("N_BRANCH", 1, "ui.mw.dag.add_node") if dag_panel != null else {}
	var link_ok: bool = dag_panel != null and dag_panel.link_nodes("N_BEGIN", "N_BRANCH")
	var exported_payload: Dictionary = studio_view.export_dag_dto()
	var dto_roundtrip: NarrativeDAGGraphDTO = NarrativeDAGGraphDTO.from_dto(exported_payload)
	var edits_marked: bool = studio_view.has_dag_edits()

	studio_view.teardown()
	mounted_screen.on_screen_exit()
	FeMountTestHelper.unmount_scene(mount_handle)
	var orphan_delta: int = maxi(0, int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT)) - initial_orphans)
	var roundtrip_ok: bool = not added_node.is_empty() and link_ok and edits_marked and dto_roundtrip.nodes.has("N_BRANCH")
	return {"test": "TC-STUDIO-01: GraphEdit 画布加载与 NarrativeDAGGraphDTO 双向序列化", "passed": studio_ready and initial_counts_ok and roundtrip_ok and orphan_delta == 0}


static func _test_companion_panel_step_rollback_and_hot_reload() -> Dictionary:
	CompanionObserverBus.reset_for_tests()
	var initial_orphans: int = int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT))
	var mount_handle: Dictionary = FeMountTestHelper.mount_scene(WORKBENCH_SCENE_PATH, "mock")
	var mounted_screen: ModWorkbenchScreen = mount_handle.get("view") as ModWorkbenchScreen
	if mounted_screen != null:
		mounted_screen.on_screen_enter({})
	var studio_view: ModWorkbenchView = mounted_screen.get_studio_view() as ModWorkbenchView if mounted_screen != null else null
	if studio_view == null:
		FeMountTestHelper.unmount_scene(mount_handle)
		return {"test": "TC-STUDIO-02: 伴侣步进控制、ObserverBus 回放与热重载状态刷新", "passed": false}

	var session_instance := AgentPlaythroughSession.new()
	session_instance.start_session({
		"mod_dirs": ["res://mod_sdk/templates/starter_story"],
		"enabled_pack_ids": ["*"],
		"character_name": "工坊伴侣试玩员",
		"race_id": "HUMAN",
		"origin_id": "STARTER_ASTRAL_INITIATE",
		"seed": 77,
	})
	studio_view.bind_session(session_instance)
	var step_snapshot: Dictionary = studio_view.step_companion_session("NODE_STARTER_EXPLORE")
	var rollback_snapshot: Dictionary = studio_view.rollback_companion_session()
	studio_view.refresh_hot_reload_status({"watched_directories": ["user://mods"], "revision": 2, "tracked_file_count": 5})

	var companion_panel: ModWorkbenchCompanionPanel = studio_view.get_companion_panel()
	var panel_state: Dictionary = companion_panel.get_panel_state() if companion_panel != null else {}
	var bus_events: Array = CompanionObserverBus.get_instance().get_recent_events(8)

	studio_view.teardown()
	mounted_screen.on_screen_exit()
	FeMountTestHelper.unmount_scene(mount_handle)
	CompanionObserverBus.reset_for_tests()
	var orphan_delta: int = maxi(0, int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT)) - initial_orphans)

	var step_ok: bool = str(step_snapshot.get("current_node_id", "")) == "NODE_STARTER_EXPLORE" and int(rollback_snapshot.get("step_index", -1)) == 0
	var summary_ok: bool = bool(panel_state.get("has_session", false)) and str(panel_state.get("hot_reload_summary", "")).contains("rev=2")
	return {"test": "TC-STUDIO-02: 伴侣步进控制、ObserverBus 回放与热重载状态刷新", "passed": step_ok and summary_ok and not bus_events.is_empty() and orphan_delta == 0}


static func _test_manifest_panel_metadata_signals_and_cleanup() -> Dictionary:
	var initial_orphans: int = int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT))
	var mount_handle: Dictionary = FeMountTestHelper.mount_scene(WORKBENCH_SCENE_PATH, "mock")
	var mounted_screen: ModWorkbenchScreen = mount_handle.get("view") as ModWorkbenchScreen
	if mounted_screen != null:
		mounted_screen.on_screen_enter({})
	var studio_view: ModWorkbenchView = mounted_screen.get_studio_view() as ModWorkbenchView if mounted_screen != null else null
	if studio_view == null:
		FeMountTestHelper.unmount_scene(mount_handle)
		return {"test": "TC-STUDIO-03: 清单元数据编辑器装载、官方包保护与零孤立节点卸载", "passed": false}

	studio_view.sync_focused_pack({"pack_id": "core_demo", "is_official": true, "version": "1.0.0", "display_name": "Core Demo"})
	var manifest_panel: ModWorkbenchManifestPanel = studio_view.get_manifest_panel()
	var official_focused: bool = manifest_panel != null and manifest_panel.get_focused_pack_id() == "core_demo"

	studio_view.sync_focused_pack({
		"pack_id": "creator_story_mod",
		"is_official": false,
		"root_path": "user://mods/creator_story_mod",
		"display_name": "创作者故事包",
		"version": "2.1.0",
		"author": "Creator",
		"priority": 180,
		"description": "Studio metadata test",
	})
	var update_spec: Dictionary = manifest_panel.build_update_spec() if manifest_panel != null else {}
	var manifest_updates: Dictionary = update_spec.get("manifest_updates", {}) as Dictionary
	studio_view.show_manifest_feedback("Metadata ready", false)

	studio_view.teardown()
	mounted_screen.on_screen_exit()
	FeMountTestHelper.unmount_scene(mount_handle)
	var orphan_delta: int = maxi(0, int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT)) - initial_orphans)

	var update_ok: bool = str(update_spec.get("pack_id", "")) == "creator_story_mod" and str(manifest_updates.get("version", "")) == "2.1.0" and int(manifest_updates.get("priority", 0)) == 180
	return {"test": "TC-STUDIO-03: 清单元数据编辑器装载、官方包保护与零孤立节点卸载", "passed": official_focused and update_ok and orphan_delta == 0}

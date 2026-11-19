# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第7卷: 任务与因果系统白模测试
# 文件路径: res://tests/unit/frontend/test_fe_07_quest_causality.gd
# ==============================================================================
class_name TestFE07QuestCausality
extends RefCounted

const FeMountHelper = preload("res://tests/unit/frontend/fe_mount_test_helper.gd")

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "FE Vol 07: 任务与因果系统（任务列表/DAG有向图/悬赏）"

	results.append(_test_quest_list_loading())
	results.append(_test_quest_detail_selection())
	results.append(_test_causality_dag_nodes_loading())
	results.append(_test_mounted_real_quest_causality())

	var passed_cnt = 0
	for r in results:
		if r.get("passed", false):
			passed_cnt += 1

	return {
		"domain": domain_name,
		"passed_count": passed_cnt,
		"total_count": results.size(),
		"all_passed": (passed_cnt == results.size()),
		"results": results
	}

static func _test_quest_list_loading() -> Dictionary:
	var view = QuestCausalityView.new()
	view.apply_snapshot({"quests": [
		{"quest_id": "Q_MAIN_01", "title": "瓦尔兰的阴影", "is_completed": false},
		{"quest_id": "Q_COMM_02", "title": "讨伐哥布林营地", "is_completed": true}
	]})

	var passed = (view.quest_list.size() == 2)
	view.free()
	return {
		"test": "TC-FE07-01: 任务多类标签与任务条目列表加载",
		"passed": passed
	}

static func _test_quest_detail_selection() -> Dictionary:
	var view = QuestCausalityView.new()
	view.apply_snapshot({"quests": [
		{"quest_id": "Q_MAIN_01", "title": "主线任务", "branches": ["正面进攻", "密道潜入"]}
	]})
	var res = view.select_quest_detail("Q_MAIN_01")

	var passed = res.success and (view.active_quest_detail.branches.size() == 2)
	view.free()
	return {
		"test": "TC-FE07-02: 任务多手段目标分支详情面板展开",
		"passed": passed
	}

static func _test_causality_dag_nodes_loading() -> Dictionary:
	var view = QuestCausalityView.new()
	view.apply_snapshot({"dag_nodes": [
		{"node_id": "N1", "event": "拯救铁匠", "next": ["N2"]},
		{"node_id": "N2", "event": "开启神殿密室", "next": []}
	]})

	var passed = (view.causality_dag_nodes.size() == 2)
	view.free()
	return {
		"test": "TC-FE07-03: 因果DAG拓扑图节点与前置因果链接装载",
		"passed": passed
	}

static func _test_mounted_real_quest_causality() -> Dictionary:
	var orphan_before := int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT))
	var mount_handle := FeMountHelper.mount_scene("res://frontend/views/quest_causality/quest_causality_view.tscn", "real")
	var passed := bool(mount_handle.get("ok", false))
	var mounted_view: QuestCausalityView = mount_handle.get("view", null) as QuestCausalityView
	if mounted_view != null:
		mounted_view.apply_snapshot({"quests": [
			{"quest_id": "Q_REAL_01", "title": "边疆侦察", "category": "MAIN", "status": "AVAILABLE", "branches": ["强攻", "潜入"]}
		]})
		var select_outcome := mounted_view.select_quest_detail("Q_REAL_01")
		mounted_view._get_tabs().on_bounty_tier_changed(0)
		mounted_view._get_tabs().on_bounty_accept()
		passed = passed and mounted_view.is_mounted_in_tree() and mounted_view.get_child_count() > 0 and bool(select_outcome.get("success", false))
	FeMountHelper.unmount_scene(mount_handle)
	var orphan_after := int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT))
	return {
		"test": "TC-FE07-04: 真场景挂载 quest_causality_view.tscn（real 模式悬赏/分支与零残留）",
		"passed": passed and (orphan_after <= orphan_before)
	}

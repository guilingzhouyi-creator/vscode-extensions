# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第7卷: 任务与因果系统子页面委托
# 文件路径: res://frontend/views/quest_causality/quest_causality_tabs.gd
# 职责: 承担 QuestCausalityView 的因果环DAG、悬赏通缉页面逻辑与Mock数据
# ==============================================================================
class_name QuestCausalityTabs
extends BaseScreen

const KTabBar = preload("res://frontend/components/k_tab_bar.gd")
const KVirtualListClass = preload("res://frontend/components/k_virtual_list.gd")
const KPageHeaderClass = preload("res://frontend/components/k_page_header.gd")
const KSplitPanelClass = preload("res://frontend/components/k_split_panel.gd")
const KStatePanelClass = preload("res://frontend/components/k_state_panel.gd")

var quest_virtual_list: KVirtualList = null
var page_header: KPageHeader = null
var split_panel: KSplitPanel = null
var state_panel: KStatePanel = null

var _view = null

var mock_quests: Array = [
	{
		"quest_id": "Q_MAIN_01", "title": "ui.fe07.mock.quest.q_main_01.title", "category": "MAIN", "status": "ACTIVE",
		"giver": "ui.fe07.mock.quest.q_main_01.giver", "level_req": 20,
		"desc": "ui.fe07.mock.quest.q_main_01.desc",
		"objectives": ["ui.fe07.mock.quest.q_main_01.obj1", "ui.fe07.mock.quest.q_main_01.obj2"],
		"rewards": ["ui.fe07.mock.quest.q_main_01.rwd1", "ui.fe07.mock.quest.q_main_01.rwd2", "ui.fe07.mock.quest.q_main_01.rwd3"]
	},
	{
		"quest_id": "Q_MAIN_02", "title": "ui.fe07.mock.quest.q_main_02.title", "category": "MAIN", "status": "AVAILABLE",
		"giver": "ui.fe07.mock.quest.q_main_02.giver", "level_req": 15,
		"desc": "ui.fe07.mock.quest.q_main_02.desc",
		"objectives": ["ui.fe07.mock.quest.q_main_02.obj1", "ui.fe07.mock.quest.q_main_02.obj2"],
		"rewards": ["ui.fe07.mock.quest.q_main_02.rwd1", "ui.fe07.mock.quest.q_main_02.rwd2"]
	},
	{
		"quest_id": "Q_SIDE_01", "title": "ui.fe07.mock.quest.q_side_01.title", "category": "SIDE", "status": "ACTIVE",
		"giver": "ui.fe07.mock.quest.q_side_01.giver", "level_req": 5,
		"desc": "ui.fe07.mock.quest.q_side_01.desc",
		"objectives": ["ui.fe07.mock.quest.q_side_01.obj1"],
		"rewards": ["ui.fe07.mock.quest.q_side_01.rwd1", "ui.fe07.mock.quest.q_side_01.rwd2"]
	},
	{
		"quest_id": "Q_SIDE_02", "title": "ui.fe07.mock.quest.q_side_02.title", "category": "SIDE", "status": "AVAILABLE",
		"giver": "ui.fe07.mock.quest.q_side_02.giver", "level_req": 8,
		"desc": "ui.fe07.mock.quest.q_side_02.desc",
		"objectives": ["ui.fe07.mock.quest.q_side_02.obj1", "ui.fe07.mock.quest.q_side_02.obj2"],
		"rewards": ["ui.fe07.mock.quest.q_side_02.rwd1", "ui.fe07.mock.quest.q_side_02.rwd2"]
	},
	{
		"quest_id": "Q_COM_01", "title": "ui.fe07.mock.quest.q_com_01.title", "category": "COMMISSION", "status": "COMPLETED",
		"giver": "ui.fe07.mock.quest.q_com_01.giver", "level_req": 10,
		"desc": "ui.fe07.mock.quest.q_com_01.desc",
		"objectives": ["ui.fe07.mock.quest.q_com_01.obj1"],
		"rewards": ["ui.fe07.mock.quest.q_com_01.rwd1"]
	},
	{
		"quest_id": "Q_COM_02", "title": "ui.fe07.mock.quest.q_com_02.title", "category": "COMMISSION", "status": "ACTIVE",
		"giver": "ui.fe07.mock.quest.q_com_02.giver", "level_req": 12,
		"desc": "ui.fe07.mock.quest.q_com_02.desc",
		"objectives": ["ui.fe07.mock.quest.q_com_02.obj1"],
		"rewards": ["ui.fe07.mock.quest.q_com_02.rwd1", "ui.fe07.mock.quest.q_com_02.rwd2"]
	}
]

var mock_dag_nodes: Array = [
	{"node_id": "DAG_01", "name": "ui.fe07.mock.dag.dag_01.name", "status": "COMPLETED", "chain_desc": "ui.fe07.mock.dag.dag_01.chain_desc"},
	{"node_id": "DAG_02", "name": "ui.fe07.mock.dag.dag_02.name", "status": "COMPLETED", "chain_desc": "ui.fe07.mock.dag.dag_02.chain_desc"},
	{"node_id": "DAG_03", "name": "ui.fe07.mock.dag.dag_03.name", "status": "ACTIVE", "chain_desc": "ui.fe07.mock.dag.dag_03.chain_desc"},
	{"node_id": "DAG_04", "name": "ui.fe07.mock.dag.dag_04.name", "status": "ACTIVE", "chain_desc": "ui.fe07.mock.dag.dag_04.chain_desc"},
	{"node_id": "DAG_05", "name": "ui.fe07.mock.dag.dag_05.name", "status": "LOCKED", "chain_desc": "ui.fe07.mock.dag.dag_05.chain_desc"},
	{"node_id": "DAG_06", "name": "ui.fe07.mock.dag.dag_06.name", "status": "LOCKED", "chain_desc": "ui.fe07.mock.dag.dag_06.chain_desc"},
	{"node_id": "DAG_07", "name": "ui.fe07.mock.dag.dag_07.name", "status": "LOCKED", "chain_desc": "ui.fe07.mock.dag.dag_07.chain_desc"}
]

var mock_bounty_targets: Array = [
	{"target_id": "B_T1_01", "name": "ui.fe07.mock.bounty.b_t1_01.name", "tier": 1, "reward_gold": 500, "time_remain": "ui.fe07.mock.bounty.b_t1_01.time", "desc": "ui.fe07.mock.bounty.b_t1_01.desc"},
	{"target_id": "B_T2_01", "name": "ui.fe07.mock.bounty.b_t2_01.name", "tier": 2, "reward_gold": 1500, "time_remain": "ui.fe07.mock.bounty.b_t2_01.time", "desc": "ui.fe07.mock.bounty.b_t2_01.desc"},
	{"target_id": "B_T2_02", "name": "ui.fe07.mock.bounty.b_t2_02.name", "tier": 2, "reward_gold": 2000, "time_remain": "ui.fe07.mock.bounty.b_t2_02.time", "desc": "ui.fe07.mock.bounty.b_t2_02.desc"},
	{"target_id": "B_T3_01", "name": "ui.fe07.mock.bounty.b_t3_01.name", "tier": 3, "reward_gold": 5000, "time_remain": "ui.fe07.mock.bounty.b_t3_01.time", "desc": "ui.fe07.mock.bounty.b_t3_01.desc"},
	{"target_id": "B_T4_01", "name": "ui.fe07.mock.bounty.b_t4_01.name", "tier": 4, "reward_gold": 12000, "time_remain": "ui.fe07.mock.bounty.b_t4_01.time", "desc": "ui.fe07.mock.bounty.b_t4_01.desc"},
	{"target_id": "B_T5_01", "name": "ui.fe07.mock.bounty.b_t5_01.name", "tier": 5, "reward_gold": 50000, "time_remain": "ui.fe07.mock.bounty.b_t5_01.time", "desc": "ui.fe07.mock.bounty.b_t5_01.desc"},
	{"target_id": "B_T5_02", "name": "ui.fe07.mock.bounty.b_t5_02.name", "tier": 5, "reward_gold": 80000, "time_remain": "ui.fe07.mock.bounty.b_t5_02.time", "desc": "ui.fe07.mock.bounty.b_t5_02.desc"}
]

func setup(view: BaseScreen) -> void:
	_view = view

func load_mock_data() -> void:
	_view.quest_list = mock_quests.duplicate(true)
	_view.causality_dag_nodes = mock_dag_nodes.duplicate(true)
	_view.bounty_targets = mock_bounty_targets.duplicate(true)

func init_tab_titles() -> void:
	KTabBar.init_titles(_view._tab_container, PackedStringArray([
		"ui.fe07.tab.quest_list",
		"ui.fe07.tab.quest_detail",
		"ui.fe07.tab.causality_dag",
		"ui.fe07.tab.bounty",
	]))

func init_static_text() -> void:
	var v = _view
	var bindings := [
		[v._header_title_label, "ui.fe07.header.title"],
		[v._btn_back, "ui.fe07.header.back"],
		[v._quest_list_section_label, "ui.fe07.quest_list.section"],
		[v._quest_filter_label, "ui.fe07.quest_list.filter_label"],
		[v._label_quest_title, "ui.fe07.quest_detail.title_default"],
		[v._label_quest_desc, "ui.fe07.quest_detail.desc_default"],
		[v._objectives_label, "ui.fe07.quest_detail.objectives_label"],
		[v._rewards_label, "ui.fe07.quest_detail.rewards_label"],
		[v._btn_quest_accept, "ui.fe07.quest_detail.btn_accept"],
		[v._btn_quest_abandon, "ui.fe07.quest_detail.btn_abandon"],
		[v._btn_quest_submit, "ui.fe07.quest_detail.btn_submit"],
		[v._dag_section_label, "ui.fe07.dag.section"],
		[v._dag_placeholder_label, "ui.fe07.dag.placeholder"],
		[v._chk_show_completed, "ui.fe07.dag.show_completed"],
		[v._dag_node_list_label, "ui.fe07.dag.node_list_label"],
		[v._label_dag_node_name, "ui.fe07.dag.node_name_default"],
		[v._label_dag_node_status, "ui.fe07.dag.node_status_none"],
		[v._label_dag_chain_desc, "ui.fe07.dag.chain_desc_default"],
		[v._bounty_section_label, "ui.fe07.bounty.section"],
		[v._tier1_desc_label, "ui.fe07.bounty.tier1_desc"],
		[v._tier2_desc_label, "ui.fe07.bounty.tier2_desc"],
		[v._tier3_desc_label, "ui.fe07.bounty.tier3_desc"],
		[v._tier4_desc_label, "ui.fe07.bounty.tier4_desc"],
		[v._tier5_desc_label, "ui.fe07.bounty.tier5_desc"],
		[v._bounty_target_list_label, "ui.fe07.bounty.target_list_label"],
		[v._label_bounty_target, "ui.fe07.bounty.target_default"],
		[v._label_bounty_reward, "ui.fe07.bounty.reward_none"],
		[v._label_bounty_time, "ui.fe07.bounty.time_none"],
		[v._btn_bounty_accept, "ui.fe07.bounty.btn_accept"]
	]
	for b in bindings:
		if b[0] != null:
			UIIntermediary.resolve(b[0], b[1])

	if v._label_quest_giver != null:
		UIIntermediary.resolve(v._label_quest_giver, "ui.fe07.quest.giver", {"name": "-"})
	if v._label_quest_level != null:
		UIIntermediary.resolve(v._label_quest_level, "ui.fe07.quest.level", {"level": 0})

func init_causality_dag_tab() -> void:
	var v = _view
	v._chk_show_completed.button_pressed = v.show_completed_dag
	refresh_dag_node_list()

func refresh_dag_node_list() -> void:
	var v = _view
	v._dag_node_list.clear()
	for node in v.causality_dag_nodes:
		var status: String = str(node.get("status", ""))
		if not v.show_completed_dag and status == "COMPLETED":
			continue
		var status_name: String = dag_status_name(status)
		var name: String = str(node.get("name", ""))
		var display: String = UIIntermediary.text("ui.fe07.dag.node", {"name": UIIntermediary.text(name), "status": status_name})
		v._dag_node_list.add_item(display)

func dag_status_name(code: String) -> String:
	match code:
		"COMPLETED": return UIIntermediary.text("ui.fe07.dag.status.completed")
		"ACTIVE": return UIIntermediary.text("ui.fe07.dag.status.active")
		"LOCKED": return UIIntermediary.text("ui.fe07.dag.status.locked")
		_: return code

func on_show_completed_toggled(pressed: bool) -> void:
	var v = _view
	v.show_completed_dag = pressed
	refresh_dag_node_list()

func on_dag_node_selected(index: int) -> void:
	var v = _view
	var visible_nodes: Array = []
	for node in v.causality_dag_nodes:
		var status: String = str(node.get("status", ""))
		if not v.show_completed_dag and status == "COMPLETED":
			continue
		visible_nodes.append(node)
	if index >= 0 and index < visible_nodes.size():
		var node: Dictionary = visible_nodes[index]
		if v._label_dag_node_name != null:
			v._label_dag_node_name.text = UIIntermediary.text(str(node.get("name", "")))
		if v._label_dag_node_status != null:
			UIIntermediary.resolve(v._label_dag_node_status, "ui.fe07.dag.node_status", {"status": dag_status_name(str(node.get("status", "")))})
		if v._label_dag_chain_desc != null:
			v._label_dag_chain_desc.text = UIIntermediary.text(str(node.get("chain_desc", "")))

func init_bounty_tab() -> void:
	var v = _view
	for i in range(5):
		UIIntermediary.resolve_tab(v._bounty_tier_tab, i, "ui.fe07.bounty.tier", {"tier": i + 1})
	refresh_bounty_targets(1)

func refresh_bounty_targets(tier: int) -> void:
	var v = _view
	v._bounty_target_list.clear()
	for target in v.bounty_targets:
		if int(target.get("tier", 0)) == tier:
			v._bounty_target_list.add_item(UIIntermediary.text(str(target.get("name", ""))))
	if v._label_bounty_target != null:
		UIIntermediary.resolve(v._label_bounty_target, "ui.fe07.bounty.target_default")
	if v._label_bounty_reward != null:
		UIIntermediary.resolve(v._label_bounty_reward, "ui.fe07.bounty.reward_none")
	if v._label_bounty_time != null:
		UIIntermediary.resolve(v._label_bounty_time, "ui.fe07.bounty.time_none")
	v._btn_bounty_accept.disabled = true

func on_bounty_tier_changed(_tab: int) -> void:
	var v = _view
	var tier: int = v._bounty_tier_tab.current_tab + 1
	refresh_bounty_targets(tier)

func on_bounty_target_selected(index: int) -> void:
	var v = _view
	var tier: int = v._bounty_tier_tab.current_tab + 1
	var filtered: Array = []
	for target in v.bounty_targets:
		if int(target.get("tier", 0)) == tier:
			filtered.append(target)
	if index >= 0 and index < filtered.size():
		var target: Dictionary = filtered[index]
		if v._label_bounty_target != null:
			v._label_bounty_target.text = UIIntermediary.text(str(target.get("name", "")))
		if v._label_bounty_reward != null:
			UIIntermediary.resolve(v._label_bounty_reward, "ui.fe07.bounty.reward", {"gold": target.get("reward_gold", 0)})
		if v._label_bounty_time != null:
			UIIntermediary.resolve(v._label_bounty_time, "ui.fe07.bounty.time", {"time": UIIntermediary.text(str(target.get("time_remain", "-")))})
		v._btn_bounty_accept.disabled = false

func on_bounty_accept() -> void:
	var v = _view
	UIIntermediary.resolve(v._btn_bounty_accept, "ui.fe07.bounty.accepted")
	v._btn_bounty_accept.disabled = true

## 初始化虚拟列表并配置对象池 (ADV-POOL-001)
func init_quest_virtual_list(container: Control = null) -> KVirtualList:
	if quest_virtual_list == null:
		quest_virtual_list = KVirtualListClass.new()
		quest_virtual_list.name = "QuestVirtualList"
		quest_virtual_list.item_height = 52.0
		quest_virtual_list.buffer_count = 3
		quest_virtual_list.range_changed.connect(_on_quest_range_changed)
		if container != null:
			container.add_child(quest_virtual_list)
	return quest_virtual_list

## 刷新任务虚拟列表总数
func sync_quest_virtual_list(count: int) -> void:
	if quest_virtual_list == null:
		init_quest_virtual_list()
	quest_virtual_list.set_total_count(count)

func _on_quest_range_changed(start_idx: int, end_idx: int) -> void:
	if _view == null or quest_virtual_list == null or start_idx < 0:
		return
	var filtered: Array = _view._get_filtered_quests()
	for i in range(start_idx, end_idx + 1):
		if i < filtered.size():
			var row: Control = quest_virtual_list.acquire_row_for_index(i)
			var quest: Dictionary = filtered[i]
			if row is KVirtualList.KVirtualRow:
				var vrow := row as KVirtualList.KVirtualRow
				vrow.bound_key = str(quest.get("quest_id", ""))
				vrow.bound_data = quest

## 统一页面标题栏构建
func create_page_header(title_key: String) -> KPageHeader:
	if page_header == null:
		page_header = KPageHeaderClass.new()
		page_header.title_key = title_key
		page_header.back_pressed.connect(func(): if _view != null: _view.back())
	return page_header

## 统一分栏面板构建
func create_split_panel(ratio: float = 0.45) -> KSplitPanel:
	if split_panel == null:
		split_panel = KSplitPanelClass.new()
		split_panel.left_ratio = ratio
	return split_panel

## 统一状态面板构建 (四态切换)
func create_state_panel() -> KStatePanel:
	if state_panel == null:
		state_panel = KStatePanelClass.new()
	return state_panel

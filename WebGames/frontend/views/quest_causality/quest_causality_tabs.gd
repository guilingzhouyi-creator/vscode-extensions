# ==============================================================================
# 模块归属: 前端任务视图域 (fe07 任务与因果页签委托)
# 文件路径: res://frontend/views/quest_causality/quest_causality_tabs.gd
# 架构定位: BaseScreen 附属页签委托控制器；承接静态文案、因果环 DAG 与悬赏通缉
# 依赖与触发: 依赖 QuestCausalityView、UIIntermediary、KVirtualList 与基础通用组件
# 职责说明: 初始化任务预设数据与文案，维护因果节点筛选、悬赏接取与虚拟列表绑定
# 退出语义与设计依据: 随 QuestCausalityView 生命周期由 _register_owned_subcontroller 清理
# ==============================================================================
## 任务与因果页签委托控制器，负责因果环 DAG 过滤展示、悬赏接取与虚拟列表管理。
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

var _view: Variant = null

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

## 绑定宿主任务与因果视图实例。
func setup(host_view: BaseScreen) -> void:
	_view = host_view

## 将预设任务、因果环节点与悬赏目标列表深拷贝加载至宿主视图状态。
func load_mock_data() -> void:
	_view.quest_list = mock_quests.duplicate(true)
	_view.causality_dag_nodes = mock_dag_nodes.duplicate(true)
	_view.bounty_targets = mock_bounty_targets.duplicate(true)

## 初始化任务视图主 Tab 栏标题文案。
func init_tab_titles() -> void:
	KTabBar.init_titles(_view._tab_container, PackedStringArray([
		"ui.fe07.tab.quest_list",
		"ui.fe07.tab.quest_detail",
		"ui.fe07.tab.causality_dag",
		"ui.fe07.tab.bounty",
	]))

## 初始化任务列表、任务详情、因果环 DAG 与悬赏页签全部静态文案。
func init_static_text() -> void:
	var host_view: QuestCausalityView = _view
	var bindings := [
		[host_view._header_title_label, "ui.fe07.header.title"],
		[host_view._back_button, "ui.fe07.header.back"],
		[host_view._quest_list_section_label, "ui.fe07.quest_list.section"],
		[host_view._quest_filter_label, "ui.fe07.quest_list.filter_label"],
		[host_view._label_quest_title, "ui.fe07.quest_detail.title_default"],
		[host_view._label_quest_description, "ui.fe07.quest_detail.desc_default"],
		[host_view._objectives_label, "ui.fe07.quest_detail.objectives_label"],
		[host_view._rewards_label, "ui.fe07.quest_detail.rewards_label"],
		[host_view._quest_accept_button, "ui.fe07.quest_detail.btn_accept"],
		[host_view._quest_abandon_button, "ui.fe07.quest_detail.btn_abandon"],
		[host_view._quest_submit_button, "ui.fe07.quest_detail.btn_submit"],
		[host_view._dag_section_label, "ui.fe07.dag.section"],
		[host_view._dag_placeholder_label, "ui.fe07.dag.placeholder"],
		[host_view._show_completed_check_box, "ui.fe07.dag.show_completed"],
		[host_view._dag_node_list_label, "ui.fe07.dag.node_list_label"],
		[host_view._label_dag_node_name, "ui.fe07.dag.node_name_default"],
		[host_view._label_dag_node_status, "ui.fe07.dag.node_status_none"],
		[host_view._label_dag_chain_description, "ui.fe07.dag.chain_desc_default"],
		[host_view._bounty_section_label, "ui.fe07.bounty.section"],
		[host_view._tier1_description_label, "ui.fe07.bounty.tier1_desc"],
		[host_view._tier2_description_label, "ui.fe07.bounty.tier2_desc"],
		[host_view._tier3_description_label, "ui.fe07.bounty.tier3_desc"],
		[host_view._tier4_description_label, "ui.fe07.bounty.tier4_desc"],
		[host_view._tier5_description_label, "ui.fe07.bounty.tier5_desc"],
		[host_view._bounty_target_list_label, "ui.fe07.bounty.target_list_label"],
		[host_view._label_bounty_target, "ui.fe07.bounty.target_default"],
		[host_view._label_bounty_reward, "ui.fe07.bounty.reward_none"],
		[host_view._label_bounty_time, "ui.fe07.bounty.time_none"],
		[host_view._bounty_accept_button, "ui.fe07.bounty.btn_accept"]
	]
	for binding_entry in bindings:
		if binding_entry[0] != null:
			UIIntermediary.resolve(binding_entry[0], binding_entry[1])

	if host_view._label_quest_giver != null:
		UIIntermediary.resolve(host_view._label_quest_giver, "ui.fe07.quest.giver", {"name": "-"})
	if host_view._label_quest_level != null:
		UIIntermediary.resolve(host_view._label_quest_level, "ui.fe07.quest.level", {"level": 0})

## 初始化因果环 DAG 页签勾选框状态并刷新节点列表。
func init_causality_dag_tab() -> void:
	var host_view: QuestCausalityView = _view
	host_view._show_completed_check_box.button_pressed = host_view.show_completed_dag
	refresh_dag_node_list()

## 按已完成过滤开关重新渲染因果环 DAG 节点列表。
func refresh_dag_node_list() -> void:
	var host_view: QuestCausalityView = _view
	host_view._dag_node_list.clear()
	for dag_node in host_view.causality_dag_nodes:
		var node_status: String = str(dag_node.get("status", ""))
		if not host_view.show_completed_dag and node_status == "COMPLETED":
			continue
		var status_name: String = dag_status_name(node_status)
		var node_name: String = str(dag_node.get("name", ""))
		var display_text: String = UIIntermediary.text("ui.fe07.dag.node", {"name": UIIntermediary.text(node_name), "status": status_name})
		host_view._dag_node_list.add_item(display_text)

## 将因果节点状态码解析为本地化状态名称。
func dag_status_name(status_code: String) -> String:
	match status_code:
		"COMPLETED": return UIIntermediary.text("ui.fe07.dag.status.completed")
		"ACTIVE": return UIIntermediary.text("ui.fe07.dag.status.active")
		"LOCKED": return UIIntermediary.text("ui.fe07.dag.status.locked")
		_: return status_code

## 处理显示已完成节点复选框切换并刷新节点列表。
func on_show_completed_toggled(pressed: bool) -> void:
	var host_view: QuestCausalityView = _view
	host_view.show_completed_dag = pressed
	refresh_dag_node_list()

## 处理因果环节点选中事件并展示节点名称、状态及因果链路说明。
func on_dag_node_selected(node_index: int) -> void:
	var host_view: QuestCausalityView = _view
	var visible_nodes: Array = []
	for dag_node in host_view.causality_dag_nodes:
		var node_status: String = str(dag_node.get("status", ""))
		if not host_view.show_completed_dag and node_status == "COMPLETED":
			continue
		visible_nodes.append(dag_node)
	if node_index >= 0 and node_index < visible_nodes.size():
		var selected_node: Dictionary = visible_nodes[node_index]
		if host_view._label_dag_node_name != null:
			host_view._label_dag_node_name.text = UIIntermediary.text(str(selected_node.get("name", "")))
		if host_view._label_dag_node_status != null:
			UIIntermediary.resolve(host_view._label_dag_node_status, "ui.fe07.dag.node_status", {"status": dag_status_name(str(selected_node.get("status", "")))})
		if host_view._label_dag_chain_description != null:
			host_view._label_dag_chain_description.text = UIIntermediary.text(str(selected_node.get("chain_desc", "")))

## 初始化五档悬赏星级页签并默认加载一星悬赏目标列表。
func init_bounty_tab() -> void:
	var host_view: QuestCausalityView = _view
	for tier_index in range(5):
		UIIntermediary.resolve_tab(host_view._bounty_tier_tab, tier_index, "ui.fe07.bounty.tier", {"tier": tier_index + 1})
	refresh_bounty_targets(1)

## 按指定悬赏星级刷新目标列表并重置详情与接取按钮状态。
func refresh_bounty_targets(tier: int) -> void:
	var host_view: QuestCausalityView = _view
	host_view._bounty_target_list.clear()
	for target_entry in host_view.bounty_targets:
		if int(target_entry.get("tier", 0)) == tier:
			host_view._bounty_target_list.add_item(UIIntermediary.text(str(target_entry.get("name", ""))))
	if host_view._label_bounty_target != null:
		UIIntermediary.resolve(host_view._label_bounty_target, "ui.fe07.bounty.target_default")
	if host_view._label_bounty_reward != null:
		UIIntermediary.resolve(host_view._label_bounty_reward, "ui.fe07.bounty.reward_none")
	if host_view._label_bounty_time != null:
		UIIntermediary.resolve(host_view._label_bounty_time, "ui.fe07.bounty.time_none")
	host_view._bounty_accept_button.disabled = true

## 处理悬赏星级页签切换并刷新对应目标列表。
func on_bounty_tier_changed(_tab_index: int) -> void:
	var host_view: QuestCausalityView = _view
	var tier: int = host_view._bounty_tier_tab.current_tab + 1
	refresh_bounty_targets(tier)

## 处理悬赏目标选中事件并展示目标奖励、剩余时间与启用接取按钮。
func on_bounty_target_selected(target_index: int) -> void:
	var host_view: QuestCausalityView = _view
	var tier: int = host_view._bounty_tier_tab.current_tab + 1
	var filtered_targets: Array = []
	for target_entry in host_view.bounty_targets:
		if int(target_entry.get("tier", 0)) == tier:
			filtered_targets.append(target_entry)
	if target_index >= 0 and target_index < filtered_targets.size():
		var selected_target: Dictionary = filtered_targets[target_index]
		if host_view._label_bounty_target != null:
			host_view._label_bounty_target.text = UIIntermediary.text(str(selected_target.get("name", "")))
		if host_view._label_bounty_reward != null:
			UIIntermediary.resolve(host_view._label_bounty_reward, "ui.fe07.bounty.reward", {"gold": selected_target.get("reward_gold", 0)})
		if host_view._label_bounty_time != null:
			UIIntermediary.resolve(host_view._label_bounty_time, "ui.fe07.bounty.time", {"time": UIIntermediary.text(str(selected_target.get("time_remain", "-")))})
		host_view._bounty_accept_button.disabled = false

## 处理悬赏接取按钮点击并更新按钮已接取态。
func on_bounty_accept() -> void:
	var host_view: QuestCausalityView = _view
	UIIntermediary.resolve(host_view._bounty_accept_button, "ui.fe07.bounty.accepted")
	host_view._bounty_accept_button.disabled = true

## 初始化虚拟列表并配置对象池 (ADV-POOL-001)
func init_quest_virtual_list(container: Control = null) -> KVirtualList:
	if quest_virtual_list == null:
		quest_virtual_list = KVirtualListClass.new()
		quest_virtual_list.name = "QuestVirtualList"
		quest_virtual_list.item_height = 52.0
		quest_virtual_list.buffer_count = 3
		connect_managed(quest_virtual_list.range_changed, _on_quest_range_changed)
		if container != null:
			container.add_child(quest_virtual_list)
	return quest_virtual_list

## 刷新任务虚拟列表总数
func sync_quest_virtual_list(total_count: int) -> void:
	if quest_virtual_list == null:
		init_quest_virtual_list()
	quest_virtual_list.set_total_count(total_count)

func _on_quest_range_changed(start_index: int, end_index: int) -> void:
	if _view == null or quest_virtual_list == null or start_index < 0:
		return
	var filtered_quests: Array = _view._get_filtered_quests()
	for quest_index in range(start_index, end_index + 1):
		if quest_index < filtered_quests.size():
			var row: Control = quest_virtual_list.acquire_row_for_index(quest_index)
			var quest_entry: Dictionary = filtered_quests[quest_index]
			if row is KVirtualList.KVirtualRow:
				var virtual_row := row as KVirtualList.KVirtualRow
				virtual_row.bound_key = str(quest_entry.get("quest_id", ""))
				virtual_row.bound_data = quest_entry

## 统一页面标题栏构建
func create_page_header(title_key: String) -> KPageHeader:
	page_header = _ensure_page_header(page_header, KPageHeaderClass, title_key, _view) as KPageHeader
	return page_header

## 统一分栏面板构建
func create_split_panel(split_ratio: float = 0.45) -> KSplitPanel:
	split_panel = _ensure_split_panel(split_panel, KSplitPanelClass, split_ratio) as KSplitPanel
	return split_panel

## 统一状态面板构建 (四态切换)
func create_state_panel() -> KStatePanel:
	state_panel = _ensure_state_panel(state_panel, KStatePanelClass) as KStatePanel
	return state_panel

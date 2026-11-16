# ==============================================================================
# 模块归属: 前端任务视图域 (fe07 任务与因果系统)
# 文件路径: res://frontend/views/quest_causality/quest_causality_view.gd
# 架构定位: BaseScreen 视图控制器；承载任务列表、详情状态流转、因果环与悬赏通缉
# 依赖与触发: 依赖 ThemeManager、UIIntermediary、ServiceLocator 与 Tabs 委托
# 职责说明: 维护任务列表筛选与详情池化展示，委托因果环 DAG 与悬赏页签给 Tabs 管理
# 退出语义与设计依据: 返回操作调用 self.back()；任务与 DAG 快照由 apply_snapshot 同步
# ==============================================================================
## 任务与因果系统主视图控制器，负责任务筛选详情与因果环、悬赏页签协同。
class_name QuestCausalityView
extends BaseScreen

const QuestCausalityTabsClass = preload("res://frontend/views/quest_causality/quest_causality_tabs.gd")

# ==============================================================================
# 节点引用（场景树中以 unique_name_in_owner 标记）
# ==============================================================================

# --- 顶栏 ---
@onready var _back_button: Button = $%BtnBack

# --- 主 Tab 容器（4 个子界面） ---
@onready var _tab_container: TabContainer = $%TabContainer

# --- Tab 0: 任务列表 ---
@onready var _quest_status_filter: OptionButton = $%QuestStatusFilter
@onready var _label_quest_count: Label = $%LabelQuestCount
@onready var _quest_category_list: ItemList = $%QuestCategoryList
@onready var _quest_item_list: ItemList = $%QuestItemList

# --- Tab 1: 任务详情 ---
@onready var label_quest_title: Label = $%LabelQuestTitle
@onready var label_quest_giver: Label = $%LabelQuestGiver
@onready var label_quest_level: Label = $%LabelQuestLevel
@onready var label_quest_description: Label = $%LabelQuestDesc
@onready var objectives_box: VBoxContainer = $%ObjectivesVBox
@onready var rewards_box: VBoxContainer = $%RewardsVBox
@onready var _quest_accept_button: Button = $%BtnQuestAccept
@onready var _quest_abandon_button: Button = $%BtnQuestAbandon
@onready var _quest_submit_button: Button = $%BtnQuestSubmit

# --- Tab 2: 因果环 DAG ---
@onready var _show_completed_check_box: CheckBox = $%ChkShowCompleted
@onready var _dag_node_list: ItemList = $%DagNodeList
@onready var label_dag_node_name: Label = $%LabelDagNodeName
@onready var label_dag_node_status: Label = $%LabelDagNodeStatus
@onready var label_dag_chain_description: Label = $%LabelDagChainDesc

# --- Tab 3: 悬赏通缉 ---
@onready var _bounty_tier_tab: TabContainer = $%BountyTierTab
@onready var _bounty_target_list: ItemList = $%BountyTargetList
@onready var label_bounty_target: Label = $%LabelBountyTarget
@onready var label_bounty_reward: Label = $%LabelBountyReward
@onready var label_bounty_time: Label = $%LabelBountyTime
@onready var _bounty_accept_button: Button = $%BtnBountyAccept

# --- 非唯一静态标签（i18n 迁移新增，共 15 个） ---
@onready var header_title_label: Label = %HeaderTitleLabel
@onready var quest_list_section_label: Label = %QuestListSectionLabel
@onready var quest_filter_label: Label = %FilterLabel
@onready var objectives_label: Label = %ObjectivesLabel
@onready var rewards_label: Label = %RewardsLabel
@onready var dag_section_label: Label = %DagSectionLabel
@onready var dag_placeholder_label: Label = %DagPlaceholderLabel
@onready var dag_node_list_label: Label = %NodeListLabel
@onready var bounty_section_label: Label = %BountySectionLabel
@onready var tier1_description_label: Label = %Tier1Desc
@onready var tier2_description_label: Label = %Tier2Desc
@onready var tier3_description_label: Label = %Tier3Desc
@onready var tier4_description_label: Label = %Tier4Desc
@onready var tier5_description_label: Label = %Tier5Desc
@onready var bounty_target_list_label: Label = %BountyTargetListLabel

# ==============================================================================
# 状态与预设数据
# ==============================================================================

enum QuestFilter {ALL, AVAILABLE, ACTIVE, COMPLETED}
var current_filter: int = QuestFilter.ALL

var quest_list: Array = []
var active_quest_detail: Dictionary = {}
var causality_dag_nodes: Array = []
var bounty_targets: Array = []
var _tabs: Variant = null
var show_completed_dag: bool = true

# ==============================================================================
# 外部视图契约兼容方法（映射到视图状态，不触碰 @onready 节点）
# ==============================================================================

## 兼容快照注入入口：更新任务列表。
func set_quest_list_snapshot(quests: Array) -> void:
	apply_snapshot({"quests": quests})

## 按任务编号选中任务详情并写入 active_quest_detail。
func select_quest_detail(quest_id: String) -> Dictionary:
	for quest_entry in quest_list:
		if str(quest_entry.get("quest_id", "")) == quest_id or str(quest_entry.get("id", "")) == quest_id:
			active_quest_detail = quest_entry
			return {"success": true, "quest": quest_entry}
	return {"success": false, "quest_id": quest_id}

## 兼容快照注入入口：更新因果环 DAG 节点列表。
func set_causality_dag_snapshot(nodes: Array) -> void:
	apply_snapshot({"causality_dag": nodes})

## 统一快照渲染映射：任务列表与因果 DAG → 视图状态
func _render_from_snapshot() -> void:
	if snapshot.has("quests"):
		quest_list = FrontendSnapshot.read_array(snapshot, "quests")
	if snapshot.has("causality_dag"):
		causality_dag_nodes = FrontendSnapshot.read_array(snapshot, "causality_dag")

func _get_tabs():
	if _tabs == null:
		_tabs = _register_owned_subcontroller(QuestCausalityTabsClass.new())
		_tabs.setup(self)
	return _tabs

## 生命周期初始化：应用主题、加载数据、装配四页签并绑定交互信号。
func _ready() -> void:
	# 1. 应用主题
	_apply_theme()

	# 2. 加载预设数据
	_load_mock_data()

	# 3. 初始化 Tab 标题
	_init_tab_titles()

	# 4. 初始化静态文案
	_init_static_text()

	# 5. 初始化各子界面
	_init_quest_list_tab()
	_get_tabs().init_quest_detail_tab()
	_init_causality_dag_tab()
	_init_bounty_tab()

	# 6. 绑定信号（仅本地 UI 交互反馈）
	_connect_signals()

	# 7. 批量视觉适配
	UIIntermediary.adapt_view(self)

## 应用 ThemeManager 单例主题（null 安全）
func _apply_theme() -> void:
	var theme_manager := ThemeManager.get_instance()
	if theme_manager.theme != null:
		theme = theme_manager.theme

# ==============================================================================
# Tab 标题初始化
# ==============================================================================

## 初始化四 Tab 标题（i18n 键驱动）
func _init_tab_titles() -> void:
	var tab_keys := [
		"ui.fe07.tab.quest_list",
		"ui.fe07.tab.quest_detail",
		"ui.fe07.tab.causality_dag",
		"ui.fe07.tab.bounty",
	]
	for tab_index in range(tab_keys.size()):
		if tab_index < _tab_container.get_tab_count():
			UIIntermediary.resolve_tab(_tab_container, tab_index, tab_keys[tab_index])

# ==============================================================================
# 静态文案初始化（非动态数据节点，i18n 绑定）
# ==============================================================================

## 初始化全部静态文案（15 个非唯一标签 + 各 Tab 动态默认值，i18n 全驱动）
func _init_static_text() -> void:
	_get_tabs().init_static_text()

func _load_mock_data() -> void:
	_get_tabs().load_mock_data()

# ==============================================================================

## 初始化任务列表 Tab：状态筛选器/分类列表填充 + 任务列表首刷
func _init_quest_list_tab() -> void:
	# 填充状态筛选器
	_quest_status_filter.clear()
	_quest_status_filter.add_item(UIIntermediary.text("ui.fe07.quest_list.filter.all"))
	_quest_status_filter.add_item(UIIntermediary.text("ui.fe07.quest_list.filter.available"))
	_quest_status_filter.add_item(UIIntermediary.text("ui.fe07.quest_list.filter.active"))
	_quest_status_filter.add_item(UIIntermediary.text("ui.fe07.quest_list.filter.completed"))
	_quest_status_filter.select(0)

	# 填充分类列表
	_quest_category_list.clear()
	_quest_category_list.add_item(UIIntermediary.text("ui.fe07.quest_list.category.main"))
	_quest_category_list.add_item(UIIntermediary.text("ui.fe07.quest_list.category.side"))
	_quest_category_list.add_item(UIIntermediary.text("ui.fe07.quest_list.category.commission"))
	_quest_category_list.select(0)

	# 填充任务列表
	_refresh_quest_list()

var current_category_filter: String = ""

## 刷新任务列表：按状态与分类双重筛选过滤并渲染条目与计数
func _refresh_quest_list() -> void:
	_quest_item_list.clear()
	var visible_count := 0
	for quest_entry in quest_list:
		var quest_status: String = quest_entry.get("status", "")
		if not _match_filter(quest_status):
			continue
		if not current_category_filter.is_empty() and str(quest_entry.get("category", "")) != current_category_filter:
			continue
		var category_name := _category_name(quest_entry.get("category", ""))
		var quest_title: String = quest_entry.get("title", "")
		var item_display_text := UIIntermediary.text("ui.fe07.quest_list.item_display", {"category": category_name, "title": UIIntermediary.text(quest_title)})
		_quest_item_list.add_item(item_display_text)
		visible_count += 1
	if _label_quest_count:
		UIIntermediary.resolve(_label_quest_count, "ui.fe07.quest_list.count", {"count": visible_count})
	if _tabs != null:
		_tabs.sync_quest_virtual_list(visible_count)

## 状态筛选匹配（ALL 恒真，其余按任务状态精确比对）
func _match_filter(status: String) -> bool:
	match current_filter:
		QuestFilter.ALL: return true
		QuestFilter.AVAILABLE: return status == "AVAILABLE"
		QuestFilter.ACTIVE: return status == "ACTIVE"
		QuestFilter.COMPLETED: return status == "COMPLETED"
	return true

## 分类码 → i18n 分类名（MAIN/SIDE/COMMISSION，未命中回传原码）
func _category_name(category_code: String) -> String:
	match category_code:
		"MAIN": return UIIntermediary.text("ui.fe07.quest_list.category.main")
		"SIDE": return UIIntermediary.text("ui.fe07.quest_list.category.side")
		"COMMISSION": return UIIntermediary.text("ui.fe07.quest_list.category.commission")
		_: return category_code

## 状态码 → i18n 状态名（AVAILABLE/ACTIVE/COMPLETED，未命中回传原码）
func _status_name(status_code: String) -> String:
	match status_code:
		"AVAILABLE": return UIIntermediary.text("ui.fe07.quest_list.filter.available")
		"ACTIVE": return UIIntermediary.text("ui.fe07.quest_list.filter.active")
		"COMPLETED": return UIIntermediary.text("ui.fe07.quest_list.filter.completed")
		_: return status_code

# ==============================================================================
# ==============================================================================
# Tab 1~3 委托给 QuestCausalityTabs
# ==============================================================================

func _init_causality_dag_tab() -> void:
	_get_tabs().init_causality_dag_tab()

func _refresh_dag_node_list() -> void:
	_get_tabs().refresh_dag_node_list()

func _dag_status_name(status_code: String) -> String:
	return _get_tabs().dag_status_name(status_code)

func _init_bounty_tab() -> void:
	_get_tabs().init_bounty_tab()

func _refresh_bounty_targets(tier: int) -> void:
	_get_tabs().refresh_bounty_targets(tier)

# ==============================================================================

## 绑定本地 UI 交互信号（四 Tab 全部控件在本地脚本闭环）
func _connect_signals() -> void:
	# 返回按钮
	connect_managed(_back_button.pressed, _on_back_pressed)

	# 任务列表
	connect_managed(_quest_status_filter.item_selected, _on_quest_filter_changed)
	connect_managed(_quest_category_list.item_selected, _on_quest_category_selected)
	connect_managed(_quest_item_list.item_selected, _on_quest_item_selected)

	# 任务详情
	connect_managed(_quest_accept_button.pressed, _on_quest_accept)
	connect_managed(_quest_abandon_button.pressed, _on_quest_abandon)
	connect_managed(_quest_submit_button.pressed, _on_quest_submit)

	# 因果环 DAG
	connect_managed(_show_completed_check_box.toggled, _on_show_completed_toggled)
	connect_managed(_dag_node_list.item_selected, _on_dag_node_selected)

	# 悬赏
	connect_managed(_bounty_tier_tab.tab_changed, _on_bounty_tier_changed)
	connect_managed(_bounty_target_list.item_selected, _on_bounty_target_selected)
	connect_managed(_bounty_accept_button.pressed, _on_bounty_accept)

# ==============================================================================
# 返回按钮
# ==============================================================================

## 返回按钮：经 BaseScreen.back 弹出视图回退上一级
func _on_back_pressed() -> void:
	self.back()

# ==============================================================================
# 任务列表交互
# ==============================================================================

## 任务状态筛选切换：更新筛选值并刷新列表
func _on_quest_filter_changed(index: int) -> void:
	current_filter = index
	_refresh_quest_list()

## 任务分类选择：按 MAIN/SIDE/COMMISSION 更新分类筛选并刷新列表
func _on_quest_category_selected(category_index: int) -> void:
	var category_codes := ["MAIN", "SIDE", "COMMISSION"]
	if category_index >= 0 and category_index < category_codes.size():
		var next_code: String = category_codes[category_index]
		current_category_filter = "" if current_category_filter == next_code else next_code
	else:
		current_category_filter = ""
	_refresh_quest_list()

## 任务条目选中：定位筛选后任务并展示详情，切换到详情 Tab
func _on_quest_item_selected(index: int) -> void:
	# 查找当前筛选后对应的任务
	var filtered_quests: Array = []
	for quest_entry in quest_list:
		if _match_filter(quest_entry.get("status", "")) and (current_category_filter.is_empty() or str(quest_entry.get("category", "")) == current_category_filter):
			filtered_quests.append(quest_entry)
	if index >= 0 and index < filtered_quests.size():
		_get_tabs().show_quest_detail(filtered_quests[index])
		# 切换到详情 Tab
		_tab_container.current_tab = 1

# ==============================================================================
# 任务详情交互
# ==============================================================================

## 接取任务：状态跃迁经服务守卫，成功后同步主列表、刷新详情
func _on_quest_accept() -> void:
	_transition_quest_status("accept")

## 放弃任务：状态跃迁经服务守卫，成功后同步主列表、刷新详情
func _on_quest_abandon() -> void:
	_transition_quest_status("abandon")

## 提交任务：状态跃迁经服务守卫，成功后同步主列表、刷新详情
func _on_quest_submit() -> void:
	_transition_quest_status("submit")

## 任务状态跃迁统一出口（状态机与守卫在 domain_boundary 服务）
func _transition_quest_status(action: String) -> void:
	if active_quest_detail.is_empty():
		return
	var transition_result := ServiceLocator.get_instance().quest().transition_status(active_quest_detail, action)
	if not bool(transition_result.get("success", false)):
		return
	active_quest_detail = transition_result.get("quest", active_quest_detail)
	# 同步回主列表
	_sync_quest_status(active_quest_detail)
	_get_tabs().show_quest_detail(active_quest_detail)

## 任务状态变更同步回主列表（按 quest_id 匹配并在循环外深拷贝写入）
func _sync_quest_status(quest_entry: Dictionary) -> void:
	var quest_id: String = quest_entry.get("quest_id", "")
	var matched_index: int = -1
	for quest_index in quest_list.size():
		if quest_list[quest_index].get("quest_id", "") == quest_id:
			matched_index = quest_index
			break
	if matched_index >= 0:
		quest_list[matched_index] = quest_entry.duplicate(true)

# ==============================================================================
# 因果环 DAG 交互
# ==============================================================================
# Tab 2 & 3 交互回调委托
# ==============================================================================

func _on_show_completed_toggled(pressed: bool) -> void:
	_get_tabs().on_show_completed_toggled(pressed)

func _on_dag_node_selected(index: int) -> void:
	_get_tabs().on_dag_node_selected(index)

func _on_bounty_tier_changed(tab: int) -> void:
	_get_tabs().on_bounty_tier_changed(tab)

func _on_bounty_target_selected(index: int) -> void:
	_get_tabs().on_bounty_target_selected(index)

func _on_bounty_accept() -> void:
	_get_tabs().on_bounty_accept()

# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第7卷: 任务与因果系统视图控制器
# 文件路径: res://frontend/views/quest_causality/quest_causality_view.gd
# 职责: 任务列表筛选、任务详情呈现、因果环 DAG 拓扑图、悬赏委托接取；
#       4 个子界面 Tab：任务列表/任务详情/因果环DAG/悬赏通缉。
# 骨架阶段: 零接线、不接 EventBus，仅本地 Mock 数据驱动 + 按钮点击反馈。
# ==============================================================================
class_name QuestCausalityView
extends BaseScreen

const QuestCausalityTabsClass = preload("res://frontend/views/quest_causality/quest_causality_tabs.gd")
const KTabBar = preload("res://frontend/components/k_tab_bar.gd")

# ==============================================================================
# 节点引用（场景树中以 unique_name_in_owner 标记）
# ==============================================================================

# --- 顶栏 ---
@onready var _btn_back: Button = $%BtnBack

# --- 主 Tab 容器（4 个子界面） ---
@onready var _tab_container: TabContainer = $%TabContainer

# --- Tab 0: 任务列表 ---
@onready var _quest_status_filter: OptionButton = $%QuestStatusFilter
@onready var _label_quest_count: Label = $%LabelQuestCount
@onready var _quest_category_list: ItemList = $%QuestCategoryList
@onready var _quest_item_list: ItemList = $%QuestItemList

# --- Tab 1: 任务详情 ---
@onready var _label_quest_title: Label = $%LabelQuestTitle
@onready var _label_quest_giver: Label = $%LabelQuestGiver
@onready var _label_quest_level: Label = $%LabelQuestLevel
@onready var _label_quest_desc: Label = $%LabelQuestDesc
@onready var _objectives_vbox: VBoxContainer = $%ObjectivesVBox
@onready var _rewards_vbox: VBoxContainer = $%RewardsVBox
@onready var _btn_quest_accept: Button = $%BtnQuestAccept
@onready var _btn_quest_abandon: Button = $%BtnQuestAbandon
@onready var _btn_quest_submit: Button = $%BtnQuestSubmit

# --- Tab 2: 因果环 DAG ---
@onready var _dag_visual_panel: PanelContainer = $%DagVisualPanel
@onready var _chk_show_completed: CheckBox = $%ChkShowCompleted
@onready var _dag_node_list: ItemList = $%DagNodeList
@onready var _label_dag_node_name: Label = $%LabelDagNodeName
@onready var _label_dag_node_status: Label = $%LabelDagNodeStatus
@onready var _label_dag_chain_desc: Label = $%LabelDagChainDesc

# --- Tab 3: 悬赏通缉 ---
@onready var _bounty_tier_tab: TabContainer = $%BountyTierTab
@onready var _bounty_target_list: ItemList = $%BountyTargetList
@onready var _label_bounty_target: Label = $%LabelBountyTarget
@onready var _label_bounty_reward: Label = $%LabelBountyReward
@onready var _label_bounty_time: Label = $%LabelBountyTime
@onready var _btn_bounty_accept: Button = $%BtnBountyAccept

# --- 非唯一静态标签（i18n 迁移新增，共 15 个） ---
@onready var _header_title_label: Label = %HeaderTitleLabel
@onready var _quest_list_section_label: Label = %QuestListSectionLabel
@onready var _quest_filter_label: Label = %QuestFilterLabel
@onready var _objectives_label: Label = %ObjectivesLabel
@onready var _rewards_label: Label = %RewardsLabel
@onready var _dag_section_label: Label = %DagSectionLabel
@onready var _dag_placeholder_label: Label = %DagPlaceholderLabel
@onready var _dag_node_list_label: Label = %DagNodeListLabel
@onready var _bounty_section_label: Label = %BountySectionLabel
@onready var _tier1_desc_label: Label = %Tier1Desc
@onready var _tier2_desc_label: Label = %Tier2Desc
@onready var _tier3_desc_label: Label = %Tier3Desc
@onready var _tier4_desc_label: Label = %Tier4Desc
@onready var _tier5_desc_label: Label = %Tier5Desc
@onready var _bounty_target_list_label: Label = %BountyTargetListLabel

# ==============================================================================
# 状态与 Mock 数据
# ==============================================================================

enum QuestFilter {ALL, AVAILABLE, ACTIVE, COMPLETED}
var current_filter: int = QuestFilter.ALL

var quest_list: Array = []
var active_quest_detail: Dictionary = {}
var causality_dag_nodes: Array = []
var bounty_targets: Array = []
var _tabs = null
var show_completed_dag: bool = true

# ==============================================================================
# 生命周期
# ==============================================================================

# ==============================================================================
# 白模测试契约兼容桩（映射到新状态，不触碰 @onready 节点）
# ==============================================================================

## 白模测试契约桩：注入任务列表快照（经统一快照入口，不触碰 @onready 节点）
func set_quest_list_snapshot(quests: Array) -> void:
	apply_snapshot({"quests": quests})

## 白模测试契约桩：按 quest_id 选中任务详情（命中写 active_quest_detail）
func select_quest_detail(quest_id: String) -> Dictionary:
	for q in quest_list:
		if str(q.get("quest_id", "")) == quest_id or str(q.get("id", "")) == quest_id:
			active_quest_detail = q
			return {"success": true, "quest": q}
	return {"success": false, "quest_id": quest_id}

## 白模测试契约桩：注入因果 DAG 节点快照（经统一快照入口）
func set_causality_dag_snapshot(nodes: Array) -> void:
	apply_snapshot({"causality_dag": nodes})

## 统一快照渲染映射：任务列表与因果 DAG → 视图状态
func _render_from_snapshot() -> void:
	if snapshot.has("quests"):
		quest_list = FrontendSnapshot.read_array(snapshot, "quests")
	if snapshot.has("causality_dag"):
		causality_dag_nodes = FrontendSnapshot.read_array(snapshot, "causality_dag")

## 生命周期初始化：主题/Mock 数据/四 Tab 装配/信号绑定/视觉适配（骨架零接线）
func _get_tabs():
	if _tabs == null:
		_tabs = QuestCausalityTabsClass.new()
		_tabs.setup(self)
	return _tabs

func _ready() -> void:
	# 1. 应用主题
	_apply_theme()

	# 2. 加载 Mock 数据
	_load_mock_data()

	# 3. 初始化 Tab 标题
	_init_tab_titles()

	# 4. 初始化静态文案
	_init_static_text()

	# 5. 初始化各子界面
	_init_quest_list_tab()
	_init_quest_detail_tab()
	_init_causality_dag_tab()
	_init_bounty_tab()

	# 6. 绑定信号（零接线：仅本地 UI 交互反馈）
	_connect_signals()

	# 7. 批量视觉适配
	UIIntermediary.adapt_view(self)

## 视图销毁钩子：清理 UIIntermediary 视图绑定（防悬挂引用）
func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		UIIntermediary.clear_view_bindings(self)

## 应用 ThemeManager 单例主题（null 安全）
func _apply_theme() -> void:
	var tm := ThemeManager.get_instance()
	if tm.theme != null:
		theme = tm.theme

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
	for i in range(tab_keys.size()):
		if i < _tab_container.get_tab_count():
			UIIntermediary.resolve_tab(_tab_container, i, tab_keys[i])

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

## 刷新任务列表：按状态筛选过滤并渲染条目与计数
func _refresh_quest_list() -> void:
	_quest_item_list.clear()
	var count := 0
	for q in quest_list:
		var status: String = q.get("status", "")
		if not _match_filter(status):
			continue
		var cat_name := _category_name(q.get("category", ""))
		var title: String = q.get("title", "")
		var display := UIIntermediary.text("ui.fe07.quest_list.item_display", {"category": cat_name, "title": UIIntermediary.text(title)})
		_quest_item_list.add_item(display)
		count += 1
	if _label_quest_count:
		UIIntermediary.resolve(_label_quest_count, "ui.fe07.quest_list.count", {"count": count})
	if _tabs != null:
		_tabs.sync_quest_virtual_list(count)

## 状态筛选匹配（ALL 恒真，其余按任务状态精确比对）
func _match_filter(status: String) -> bool:
	match current_filter:
		QuestFilter.ALL: return true
		QuestFilter.AVAILABLE: return status == "AVAILABLE"
		QuestFilter.ACTIVE: return status == "ACTIVE"
		QuestFilter.COMPLETED: return status == "COMPLETED"
	return true

## 分类码 → i18n 分类名（MAIN/SIDE/COMMISSION，未命中回传原码）
func _category_name(code: String) -> String:
	match code:
		"MAIN": return UIIntermediary.text("ui.fe07.quest_list.category.main")
		"SIDE": return UIIntermediary.text("ui.fe07.quest_list.category.side")
		"COMMISSION": return UIIntermediary.text("ui.fe07.quest_list.category.commission")
		_: return code

## 状态码 → i18n 状态名（AVAILABLE/ACTIVE/COMPLETED，未命中回传原码）
func _status_name(code: String) -> String:
	match code:
		"AVAILABLE": return UIIntermediary.text("ui.fe07.quest_list.filter.available")
		"ACTIVE": return UIIntermediary.text("ui.fe07.quest_list.filter.active")
		"COMPLETED": return UIIntermediary.text("ui.fe07.quest_list.filter.completed")
		_: return code

# ==============================================================================
# Tab 1: 任务详情 - 初始化
# ==============================================================================

## 初始化任务详情 Tab：默认展示首个任务，空列表置占位并禁用操作按钮
func _init_quest_detail_tab() -> void:
	# 默认显示第一个任务
	if quest_list.size() > 0:
		_show_quest_detail(quest_list[0])
	else:
		UIIntermediary.resolve(_label_quest_title, "ui.fe07.quest_detail.no_quest")
		_btn_quest_accept.disabled = true
		_btn_quest_abandon.disabled = true
		_btn_quest_submit.disabled = true

## 展示任务详情：标题/发布者/等级/描述/目标列表/奖励列表，按状态启停接取/放弃/提交按钮
func _show_quest_detail(quest: Dictionary) -> void:
	active_quest_detail = quest
	if _label_quest_title:
		_label_quest_title.text = UIIntermediary.text(quest.get("title", "ui.fe07.quest_detail.title_default"))
	if _label_quest_giver:
		UIIntermediary.resolve(_label_quest_giver, "ui.fe07.quest.giver", {"name": UIIntermediary.text(quest.get("giver", "-"))})
	if _label_quest_level:
		UIIntermediary.resolve(_label_quest_level, "ui.fe07.quest.level", {"level": quest.get("level_req", 0)})
	if _label_quest_desc:
		_label_quest_desc.text = UIIntermediary.text(quest.get("desc", ""))
	# 填充目标列表
	_clear_container_children(_objectives_vbox)
	for obj in quest.get("objectives", []):
		var lbl := Label.new()
		lbl.text = UIIntermediary.text("ui.fe07.quest_detail.objective_item", {"text": UIIntermediary.text(str(obj))})
		_objectives_vbox.add_child(lbl)
	# 填充奖励列表
	_clear_container_children(_rewards_vbox)
	for reward in quest.get("rewards", []):
		var lbl := Label.new()
		lbl.text = UIIntermediary.text("ui.fe07.quest_detail.reward_item", {"text": UIIntermediary.text(str(reward))})
		_rewards_vbox.add_child(lbl)
	# 根据状态设置按钮可用性
	var status: String = quest.get("status", "")
	_btn_quest_accept.disabled = (status != "AVAILABLE")
	_btn_quest_abandon.disabled = (status != "ACTIVE")
	_btn_quest_submit.disabled = (status != "ACTIVE")

## 清空容器全部子节点（目标/奖励动态列表重建用）
func _clear_container_children(container: Node) -> void:
	for child in container.get_children():
		child.queue_free()

# ==============================================================================
# Tab 2: 因果环 DAG - 初始化
# ==============================================================================
# Tab 2 & 3 委托给 QuestCausalityTabs
# ==============================================================================

func _init_causality_dag_tab() -> void:
	_get_tabs().init_causality_dag_tab()

func _refresh_dag_node_list() -> void:
	_get_tabs().refresh_dag_node_list()

func _dag_status_name(code: String) -> String:
	return _get_tabs().dag_status_name(code)

func _init_bounty_tab() -> void:
	_get_tabs().init_bounty_tab()

func _refresh_bounty_targets(tier: int) -> void:
	_get_tabs().refresh_bounty_targets(tier)

# ==============================================================================

## 绑定本地 UI 交互信号（零接线：四 Tab 全部控件在本地脚本闭环）
func _connect_signals() -> void:
	# 返回按钮
	_btn_back.pressed.connect(_on_back_pressed)

	# 任务列表
	_quest_status_filter.item_selected.connect(_on_quest_filter_changed)
	_quest_category_list.item_selected.connect(_on_quest_category_selected)
	_quest_item_list.item_selected.connect(_on_quest_item_selected)

	# 任务详情
	_btn_quest_accept.pressed.connect(_on_quest_accept)
	_btn_quest_abandon.pressed.connect(_on_quest_abandon)
	_btn_quest_submit.pressed.connect(_on_quest_submit)

	# 因果环 DAG
	_chk_show_completed.toggled.connect(_on_show_completed_toggled)
	_dag_node_list.item_selected.connect(_on_dag_node_selected)

	# 悬赏
	_bounty_tier_tab.tab_changed.connect(_on_bounty_tier_changed)
	_bounty_target_list.item_selected.connect(_on_bounty_target_selected)
	_btn_bounty_accept.pressed.connect(_on_bounty_accept)

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

## 任务分类选择：骨架阶段仅刷新列表（不做额外过滤）
func _on_quest_category_selected(_index: int) -> void:
	# 骨架阶段：分类选择仅刷新列表（不额外过滤）
	_refresh_quest_list()

## 任务条目选中：定位筛选后任务并展示详情，切换到详情 Tab
func _on_quest_item_selected(index: int) -> void:
	# 查找当前筛选后对应的任务
	var filtered: Array = []
	for q in quest_list:
		if _match_filter(q.get("status", "")):
			filtered.append(q)
	if index >= 0 and index < filtered.size():
		_show_quest_detail(filtered[index])
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
	var result := MockServiceContainer.get_instance().quest().transition_status(active_quest_detail, action)
	if not bool(result.get("success", false)):
		return
	active_quest_detail = result.get("quest", active_quest_detail)
	# 同步回主列表
	_sync_quest_status(active_quest_detail)
	_show_quest_detail(active_quest_detail)

## 任务状态变更同步回主列表（按 quest_id 匹配替换副本）
func _sync_quest_status(quest: Dictionary) -> void:
	var qid: String = quest.get("quest_id", "")
	for i in quest_list.size():
		if quest_list[i].get("quest_id", "") == qid:
			quest_list[i] = quest.duplicate(true)
			break

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

# ==============================================================================
# 模块归属: 前端生态视图域 (fe11 怪物与生态页签委托)
# 文件路径: res://frontend/views/monster_ecology/monster_ecology_tabs.gd
# 架构定位: BaseScreen 附属页签委托控制器；承接世界头目与兽潮调度子面板
# 依赖与触发: 依赖 MonsterEcologyView、UIIntermediary、DesignTokens 与 NavManager
# 职责说明: 装配世界头目与兽潮预设数据，管理池化卡片按钮、倒计时格式化与参战状态
# 退出语义与设计依据: 随 MonsterEcologyView 生命周期由 _register_owned_subcontroller 清理
# ==============================================================================
## 怪物与生态页签委托控制器，负责世界头目卡片详情与兽潮防守波次交互。
class_name MonsterEcologyTabs
extends BaseScreen

const KButtonClass = preload("res://frontend/components/k_button.gd")
const KPageHeaderClass = preload("res://frontend/components/k_page_header.gd")
const KSplitPanelClass = preload("res://frontend/components/k_split_panel.gd")
const BOSS_CARD_MIN_EXTENTS := Vector2(DesignTokens.SPACING_ZERO, 60)

var page_header: KPageHeader = null
var split_panel: KSplitPanel = null

var _view: Variant = null

# --- 选中与交互状态 ---
var _selected_boss_index: int = -1
var _tide_joined: bool = false

# --- 世界头目预设数据（3） ---
var _world_bosses: Array = [
	{
		"name_key": "ui.fe11.world_boss.boss.boss01_name",
		"level": 50,
		"status_key": "ui.fe11.world_boss.boss.boss01_status_alive",
		"respawn_key": "ui.fe11.world_boss.boss.boss01_respawn",
		"map_key": "ui.fe11.world_boss.boss.boss01_map",
		"reward_keys": [
			"ui.fe11.world_boss.reward.dragon_heart_stone",
			"ui.fe11.world_boss.reward.epic_chest",
			"ui.fe11.world_boss.reward.magic_crystal_50",
		],
		"participants": 128,
		"countdown_sec": 14400
	},
	{
		"name_key": "ui.fe11.world_boss.boss.boss02_name",
		"level": 55,
		"status_key": "ui.fe11.world_boss.boss.boss02_status_dead",
		"respawn_key": "ui.fe11.world_boss.boss.boss02_respawn",
		"map_key": "ui.fe11.world_boss.boss.boss02_map",
		"reward_keys": [
			"ui.fe11.world_boss.reward.abyss_scepter",
			"ui.fe11.world_boss.reward.legendary_scroll",
			"ui.fe11.world_boss.reward.magic_crystal_80",
		],
		"participants": 256,
		"countdown_sec": 86400
	},
	{
		"name_key": "ui.fe11.world_boss.boss.boss03_name",
		"level": 48,
		"status_key": "ui.fe11.world_boss.boss.boss03_status_alive",
		"respawn_key": "ui.fe11.world_boss.boss.boss03_respawn",
		"map_key": "ui.fe11.world_boss.boss.boss03_map",
		"reward_keys": [
			"ui.fe11.world_boss.reward.life_seed",
			"ui.fe11.world_boss.reward.rare_chest",
			"ui.fe11.world_boss.reward.magic_crystal_40",
		],
		"participants": 96,
		"countdown_sec": 7200
	},
]

# --- 兽潮波次预设数据（2） ---
var _beast_tide_waves: Array = [
	{
		"wave": 1,
		"status_key": "ui.fe11.beast_tide.status.ongoing",
		"countdown_sec": 1800,
		"defense_pct": 65.0,
		"reward_keys": [
			"ui.fe11.beast_tide.reward.magic_crystal_20",
			"ui.fe11.beast_tide.reward.defense_medal",
			"ui.fe11.beast_tide.reward.exp_bonus_10",
		]
	},
	{
		"wave": 2,
		"status_key": "ui.fe11.beast_tide.status.pending",
		"countdown_sec": 5400,
		"defense_pct": 0.0,
		"reward_keys": [
			"ui.fe11.beast_tide.reward.magic_crystal_30",
			"ui.fe11.beast_tide.reward.elite_medal",
			"ui.fe11.beast_tide.reward.exp_bonus_15",
		]
	},
]

## 绑定宿主怪物生态视图引用。
func setup(host_view: BaseScreen) -> void:
	_view = host_view

# ==============================================================================
# Tab 标题与文案初始化
# ==============================================================================

## 初始化 Tab 标题
func _init_tab_titles() -> void:
	if _view == null or _view.tab_container == null:
		return
	KTabBar.init_titles(_view.tab_container, PackedStringArray([
		"ui.fe11.bestiary.tab_title",
		"ui.fe11.world_boss.tab_title",
		"ui.fe11.beast_tide.tab_title",
	]))

## 初始化世界头目与兽潮静态文案
func _init_subpanel_text() -> void:
	if _view == null:
		return
	# --- Tab 1: WORLD_BOSS 世界BOSS ---
	var boss_section: Label = _view.get_node_or_null("MainLayout/TabContainer/世界BOSS/LeftPanel/SectionLabel")
	if boss_section != null:
		UIIntermediary.resolve(boss_section, "ui.fe11.world_boss.section_title")
	var boss_detail_section: Label = _view.get_node_or_null("MainLayout/TabContainer/世界BOSS/RightPanel/DetailSectionLabel")
	if boss_detail_section != null:
		UIIntermediary.resolve(boss_detail_section, "ui.fe11.world_boss.detail_title")

	var boss_rewards_label: Label = _view.get_node_or_null("MainLayout/TabContainer/世界BOSS/RightPanel/RewardsLabel")
	if boss_rewards_label != null:
		UIIntermediary.resolve(boss_rewards_label, "ui.fe11.world_boss.detail.rewards_label")
	UIIntermediary.resolve(_view.boss_challenge_button, "ui.fe11.world_boss.detail.challenge_btn")

	# --- Tab 2: BEAST_TIDE 兽潮 ---
	var tide_defense_label: Label = _view.get_node_or_null("MainLayout/TabContainer/兽潮调度/StatusPanel/StatusVBox/DefenseRow/DefenseLabel")
	if tide_defense_label != null:
		UIIntermediary.resolve(tide_defense_label, "ui.fe11.beast_tide.defense_label")

	var wave_section_label: Label = _view.get_node_or_null("MainLayout/TabContainer/兽潮调度/WaveSectionLabel")
	if wave_section_label != null:
		UIIntermediary.resolve(wave_section_label, "ui.fe11.beast_tide.wave_section_title")

	var rewards_section_label: Label = _view.get_node_or_null("MainLayout/TabContainer/兽潮调度/BottomSection/RewardsPanel/RewardsSectionLabel")
	if rewards_section_label != null:
		UIIntermediary.resolve(rewards_section_label, "ui.fe11.beast_tide.rewards_section_title")

	UIIntermediary.resolve(_view.tide_join_button, "ui.fe11.beast_tide.join_btn")
	UIIntermediary.resolve(_view._tide_leave_button, "ui.fe11.beast_tide.leave_btn")

	_refresh_boss_detail()

# ==============================================================================
# Tab 1: WORLD_BOSS 世界BOSS
# ==============================================================================

## 刷新世界头目卡片列表（池化复用卡片按钮，循环零堆分配）
func _populate_boss_cards() -> void:
	if _view == null or _view.boss_card_list == null:
		return
	for boss_index in _world_bosses.size():
		var boss_entry: Dictionary = _world_bosses[boss_index]
		var card_button: Button = _acquire_boss_card_button(boss_index)
		card_button.visible = true
		var boss_name := UIIntermediary.text(str(boss_entry.get("name_key", "")))
		var boss_status := UIIntermediary.text(str(boss_entry.get("status_key", "")))
		card_button.text = UIIntermediary.text("ui.fe11.world_boss.card_template", {
			"name": boss_name,
			"level": int(boss_entry.get("level", 0)),
			"status": boss_status,
		})
	for child_index in range(_world_bosses.size(), _view.boss_card_list.get_child_count()):
		_view.boss_card_list.get_child(child_index).visible = false

## 获取或创建世界头目卡片按钮（循环外分配）
func _acquire_boss_card_button(boss_index: int) -> Button:
	if boss_index < _view.boss_card_list.get_child_count():
		return _view.boss_card_list.get_child(boss_index) as Button
	var card_button := KButtonClass.new()
	card_button.variant = KButtonClass.StyleVariant.SECONDARY
	card_button.custom_minimum_size = BOSS_CARD_MIN_EXTENTS
	connect_managed(card_button.pressed, func(): _on_boss_card_pressed(boss_index))
	_view.boss_card_list.add_child(card_button)
	return card_button

## 头目卡片点击：记录选中索引并刷新详情
func _on_boss_card_pressed(boss_index: int) -> void:
	_selected_boss_index = boss_index
	_refresh_boss_detail()

## 刷新头目详情：未选中空态或完整字段（名称/等级/状态/重生/地图/倒计时/奖励/参战数）
func _refresh_boss_detail() -> void:
	if _view == null:
		return
	if _selected_boss_index < 0 or _selected_boss_index >= _world_bosses.size():
		UIIntermediary.resolve(_view.label_boss_name, "ui.fe11.world_boss.detail.prompt_select")
		UIIntermediary.resolve(_view.label_boss_level, "ui.fe11.world_boss.detail.level", {"level": "--"})
		UIIntermediary.resolve(_view.label_boss_status, "ui.fe11.world_boss.detail.status", {"status": "--"})
		UIIntermediary.resolve(_view.label_boss_respawn_time, "ui.fe11.world_boss.detail.respawn_time", {"time": "--"})
		UIIntermediary.resolve(_view.label_boss_map, "ui.fe11.world_boss.detail.map", {"map": "--"})
		UIIntermediary.resolve(_view.label_boss_countdown, "ui.fe11.world_boss.detail.countdown", {"time": "--:--:--"})
		_view.boss_reward_list.clear()
		UIIntermediary.resolve(_view.label_boss_participants, "ui.fe11.world_boss.detail.participants", {"count": 0})
		return
	var boss_entry: Dictionary = _world_bosses[_selected_boss_index]
	UIIntermediary.resolve(_view.label_boss_name, str(boss_entry.get("name_key", "")))
	UIIntermediary.resolve(_view.label_boss_level, "ui.fe11.world_boss.detail.level", {
		"level": int(boss_entry.get("level", 0)),
	})
	var status_text: String = UIIntermediary.text(str(boss_entry.get("status_key", "-")))
	UIIntermediary.resolve(_view.label_boss_status, "ui.fe11.world_boss.detail.status", {"status": status_text})
	var respawn_text: String = UIIntermediary.text(str(boss_entry.get("respawn_key", "-")))
	UIIntermediary.resolve(_view.label_boss_respawn_time, "ui.fe11.world_boss.detail.respawn_time", {"time": respawn_text})
	var map_text: String = UIIntermediary.text(str(boss_entry.get("map_key", "-")))
	UIIntermediary.resolve(_view.label_boss_map, "ui.fe11.world_boss.detail.map", {"map": map_text})
	UIIntermediary.resolve(_view.label_boss_countdown, "ui.fe11.world_boss.detail.countdown", {
		"time": _format_countdown(int(boss_entry.get("countdown_sec", 0))),
	})
	_view.boss_reward_list.clear()
	for reward_key in boss_entry.get("reward_keys", []):
		UIIntermediary.resolve_item(_view.boss_reward_list, str(reward_key))
	UIIntermediary.resolve(_view.label_boss_participants, "ui.fe11.world_boss.detail.participants", {
		"count": int(boss_entry.get("participants", 0)),
	})

## 挑战按钮回调：派发世界头目挑战协议动作并反馈提示
func _on_boss_challenge_pressed() -> void:
	if _selected_boss_index < 0:
		NavManager.get_instance().show_toast(
			UIIntermediary.text("ui.fe11.world_boss.detail.prompt_select"),
			NavTypes.ToastLevel.WARNING
		)
		return
	var boss_entry: Dictionary = _world_bosses[_selected_boss_index]
	var boss_name := UIIntermediary.text(str(boss_entry.get("name_key", "")))
	ServiceLocator.get_instance().world().dispatch_world_directive("monster_ecology", "CHALLENGE_WORLD_BOSS", {"boss_name": boss_name})
	NavManager.get_instance().show_toast(
		UIIntermediary.text("ui.fe11.world_boss.challenge_toast", {"name": boss_name}),
		NavTypes.ToastLevel.INFO
	)

# ==============================================================================
# Tab 2: BEAST_TIDE 兽潮
# ==============================================================================

## 刷新兽潮状态面板：取第一波（进行中）渲染状态/倒计时/防线进度
func _refresh_beast_tide_status() -> void:
	if _view == null:
		return
	if _beast_tide_waves.is_empty():
		UIIntermediary.resolve(_view.label_tide_status, "ui.fe11.beast_tide.status_label", {"status": "--"})
		UIIntermediary.resolve(_view.label_tide_countdown, "ui.fe11.beast_tide.countdown_label", {"time": "--:--:--"})
		_view.tide_defense_bar.value = 0.0
		UIIntermediary.resolve(_view.label_tide_defense, "ui.fe11.beast_tide.defense_pct", {"pct": "0.0"})
		return
	var wave_entry: Dictionary = _beast_tide_waves[0]
	var status_text: String = UIIntermediary.text(str(wave_entry.get("status_key", "-")))
	UIIntermediary.resolve(_view.label_tide_status, "ui.fe11.beast_tide.status_label", {"status": status_text})
	UIIntermediary.resolve(_view.label_tide_countdown, "ui.fe11.beast_tide.countdown_label", {
		"time": _format_countdown(int(wave_entry.get("countdown_sec", 0))),
	})
	var defense_percentage: float = float(wave_entry.get("defense_pct", 0.0))
	_view.tide_defense_bar.value = defense_percentage
	UIIntermediary.resolve(_view.label_tide_defense, "ui.fe11.beast_tide.defense_pct", {"pct": "%.1f" % defense_percentage})

## 刷新兽潮波次列表（池化复用 PanelContainer，循环零堆分配）
func _populate_wave_list() -> void:
	if _view == null or _view.tide_wave_list == null:
		return
	for wave_index in range(_beast_tide_waves.size()):
		var wave_entry: Dictionary = _beast_tide_waves[wave_index]
		var wave_panel: PanelContainer = _acquire_wave_panel(wave_index)
		wave_panel.visible = true
		var content_box := wave_panel.get_child(0) as VBoxContainer
		var title_label := content_box.get_child(0) as Label
		var status_text: String = UIIntermediary.text(str(wave_entry.get("status_key", "-")))
		title_label.text = UIIntermediary.text("ui.fe11.beast_tide.wave_title", {
			"wave": int(wave_entry.get("wave", 0)),
			"status": status_text,
		})
		var detail_label := content_box.get_child(1) as Label
		detail_label.text = UIIntermediary.text("ui.fe11.beast_tide.wave_detail", {
			"countdown": _format_countdown(int(wave_entry.get("countdown_sec", 0))),
			"pct": "%.1f" % float(wave_entry.get("defense_pct", 0.0)),
		})
	for child_index in range(_beast_tide_waves.size(), _view.tide_wave_list.get_child_count()):
		_view.tide_wave_list.get_child(child_index).visible = false

## 获取或创建兽潮波次面板节点（循环外分配）
func _acquire_wave_panel(index: int) -> PanelContainer:
	if index < _view.tide_wave_list.get_child_count():
		return _view.tide_wave_list.get_child(index) as PanelContainer
	var wave_panel := PanelContainer.new()
	var content_box := VBoxContainer.new()
	content_box.set("theme_override_constants/separation", 4)
	var title_label := Label.new()
	content_box.add_child(title_label)
	var detail_label := Label.new()
	detail_label.set("theme_override_colors/font_color", DesignTokens.COLOR_TEXT_MUTED_DEFAULT)
	content_box.add_child(detail_label)
	wave_panel.add_child(content_box)
	_view.tide_wave_list.add_child(wave_panel)
	return wave_panel

## 刷新兽潮奖励列表（第一波奖励）
func _refresh_tide_rewards() -> void:
	if _view == null or _view.tide_reward_list == null:
		return
	_view.tide_reward_list.clear()
	if _beast_tide_waves.is_empty():
		return
	var wave_entry: Dictionary = _beast_tide_waves[0]
	for reward_key in wave_entry.get("reward_keys", []):
		UIIntermediary.resolve_item(_view.tide_reward_list, str(reward_key))

## 报名兽潮防守：切换加入/撤离按钮显隐并派发协议通知
func _on_tide_join_pressed() -> void:
	_tide_joined = true
	_view.tide_join_button.visible = false
	_view._tide_leave_button.visible = true
	var reply := ServiceLocator.get_instance().world().dispatch_world_directive("monster_ecology", "JOIN_BEAST_TIDE", {})
	var reply_table: Dictionary = reply.get("data", reply) as Dictionary
	if reply_table.has("swarm_risk"):
		_view.update_beast_tide_risk(float(reply_table.get("swarm_risk", 0.0)))
	NavManager.get_instance().show_toast(
		UIIntermediary.text("ui.fe11.beast_tide.joined_toast"),
		NavTypes.ToastLevel.SUCCESS
	)

## 撤离兽潮战场：切换加入/撤离按钮显隐并派发协议通知
func _on_tide_leave_pressed() -> void:
	_tide_joined = false
	_view.tide_join_button.visible = true
	_view._tide_leave_button.visible = false
	ServiceLocator.get_instance().world().dispatch_world_directive("monster_ecology", "LEAVE_BEAST_TIDE", {})
	NavManager.get_instance().show_toast(
		UIIntermediary.text("ui.fe11.beast_tide.left_toast"),
		NavTypes.ToastLevel.INFO
	)

# ==============================================================================
# 信号绑定与工具方法
# ==============================================================================

## 绑定 Tab 1 & Tab 2 交互信号
func _connect_signals() -> void:
	if _view == null:
		return
	connect_managed(_view.boss_challenge_button.pressed, _on_boss_challenge_pressed)
	connect_managed(_view.tide_join_button.pressed, _on_tide_join_pressed)
	connect_managed(_view._tide_leave_button.pressed, _on_tide_leave_pressed)

## 秒数格式化：HH:MM:SS（倒计时展示）
func _format_countdown(seconds: int) -> String:
	@warning_ignore("integer_division")
	var hours_value: int = seconds / 3600
	@warning_ignore("integer_division")
	var minutes_value: int = (seconds % 3600) / 60
	var seconds_value: int = seconds % 60
	return "%02d:%02d:%02d" % [hours_value, minutes_value, seconds_value]

## 统一页面标题栏构建
func create_page_header(title_key: String) -> KPageHeader:
	page_header = _ensure_page_header(page_header, KPageHeaderClass, title_key, _view) as KPageHeader
	return page_header

## 统一分栏面板构建
func create_split_panel(split_ratio: float = 0.35) -> KSplitPanel:
	split_panel = _ensure_split_panel(split_panel, KSplitPanelClass, split_ratio) as KSplitPanel
	return split_panel

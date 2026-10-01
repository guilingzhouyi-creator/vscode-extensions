# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第11卷: 怪物与生态 Tab 子面板控制器
# 文件路径: res://frontend/views/monster_ecology/monster_ecology_tabs.gd
# 职责: 承接世界BOSS（Tab 1）与兽潮调度（Tab 2）的装配、渲染、倒计时与交互事件
#       由 MonsterEcologyView 持有，经 setup(view) 绑定视图引用后委托调用
#       节点引用与全局状态经 _view 访问，保证行为与拆分前完全一致
# ==============================================================================
class_name MonsterEcologyTabs
extends BaseScreen

const KButtonClass = preload("res://frontend/components/k_button.gd")
const KTabBar = preload("res://frontend/components/k_tab_bar.gd")
const KPageHeaderClass = preload("res://frontend/components/k_page_header.gd")
const KSplitPanelClass = preload("res://frontend/components/k_split_panel.gd")

var page_header: KPageHeader = null
var split_panel: KSplitPanel = null

var _view = null

# --- 选中与交互状态 ---
var _selected_boss_idx: int = -1
var _tide_joined: bool = false

# --- 世界BOSS Mock 数据（3） ---
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

# --- 兽潮波次 Mock 数据（2） ---
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

## 绑定视图引用
func setup(view: BaseScreen) -> void:
	_view = view

# ==============================================================================
# Tab 标题与文案初始化
# ==============================================================================

## 初始化 Tab 标题
func _init_tab_titles() -> void:
	if _view == null or _view._tab_container == null:
		return
	KTabBar.init_titles(_view._tab_container, PackedStringArray([
		"ui.fe11.bestiary.tab_title",
		"ui.fe11.world_boss.tab_title",
		"ui.fe11.beast_tide.tab_title",
	]))

## 初始化世界BOSS与兽潮文案
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
	UIIntermediary.resolve(_view._btn_boss_challenge, "ui.fe11.world_boss.detail.challenge_btn")

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

	UIIntermediary.resolve(_view._btn_tide_join, "ui.fe11.beast_tide.join_btn")
	UIIntermediary.resolve(_view._btn_tide_leave, "ui.fe11.beast_tide.leave_btn")

	_refresh_boss_detail()

# ==============================================================================
# Tab 1: WORLD_BOSS 世界BOSS
# ==============================================================================

## 重建世界 BOSS 卡片列表（名称/等级/状态模板，点击回调详情切换）
func _populate_boss_cards() -> void:
	if _view == null or _view._boss_card_list == null:
		return
	for child in _view._boss_card_list.get_children():
		child.queue_free()
	for i in _world_bosses.size():
		var boss: Dictionary = _world_bosses[i]
		var btn := KButtonClass.new()
		btn.variant = KButtonClass.StyleVariant.SECONDARY
		var boss_name := UIIntermediary.text(str(boss.get("name_key", "")))
		var boss_status := UIIntermediary.text(str(boss.get("status_key", "")))
		btn.text = UIIntermediary.text("ui.fe11.world_boss.card_template", {
			"name": boss_name,
			"level": int(boss.get("level", 0)),
			"status": boss_status,
		})
		btn.custom_minimum_size = Vector2(0, 60)
		var idx := i
		btn.pressed.connect(func(): _on_boss_card_pressed(idx))
		_view._boss_card_list.add_child(btn)

## BOSS 卡片点击：记录选中索引并刷新详情
func _on_boss_card_pressed(idx: int) -> void:
	_selected_boss_idx = idx
	_refresh_boss_detail()

## 刷新 BOSS 详情：未选中占位或完整字段（名称/等级/状态/重生/地图/倒计时/奖励/参战数）
func _refresh_boss_detail() -> void:
	if _view == null:
		return
	if _selected_boss_idx < 0 or _selected_boss_idx >= _world_bosses.size():
		UIIntermediary.resolve(_view._label_boss_name, "ui.fe11.world_boss.detail.prompt_select")
		UIIntermediary.resolve(_view._label_boss_level, "ui.fe11.world_boss.detail.level", {"level": "--"})
		UIIntermediary.resolve(_view._label_boss_status, "ui.fe11.world_boss.detail.status", {"status": "--"})
		UIIntermediary.resolve(_view._label_boss_respawn_time, "ui.fe11.world_boss.detail.respawn_time", {"time": "--"})
		UIIntermediary.resolve(_view._label_boss_map, "ui.fe11.world_boss.detail.map", {"map": "--"})
		UIIntermediary.resolve(_view._label_boss_countdown, "ui.fe11.world_boss.detail.countdown", {"time": "--:--:--"})
		_view._boss_reward_list.clear()
		UIIntermediary.resolve(_view._label_boss_participants, "ui.fe11.world_boss.detail.participants", {"count": 0})
		return
	var boss: Dictionary = _world_bosses[_selected_boss_idx]
	UIIntermediary.resolve(_view._label_boss_name, str(boss.get("name_key", "")))
	UIIntermediary.resolve(_view._label_boss_level, "ui.fe11.world_boss.detail.level", {
		"level": int(boss.get("level", 0)),
	})
	var status_text: String = UIIntermediary.text(str(boss.get("status_key", "-")))
	UIIntermediary.resolve(_view._label_boss_status, "ui.fe11.world_boss.detail.status", {"status": status_text})
	var respawn_text: String = UIIntermediary.text(str(boss.get("respawn_key", "-")))
	UIIntermediary.resolve(_view._label_boss_respawn_time, "ui.fe11.world_boss.detail.respawn_time", {"time": respawn_text})
	var map_text: String = UIIntermediary.text(str(boss.get("map_key", "-")))
	UIIntermediary.resolve(_view._label_boss_map, "ui.fe11.world_boss.detail.map", {"map": map_text})
	UIIntermediary.resolve(_view._label_boss_countdown, "ui.fe11.world_boss.detail.countdown", {
		"time": _format_countdown(int(boss.get("countdown_sec", 0))),
	})
	_view._boss_reward_list.clear()
	for reward_key in boss.get("reward_keys", []):
		UIIntermediary.resolve_item(_view._boss_reward_list, str(reward_key))
	UIIntermediary.resolve(_view._label_boss_participants, "ui.fe11.world_boss.detail.participants", {
		"count": int(boss.get("participants", 0)),
	})

## 挑战按钮回调：骨架阶段仅 print 占位
func _on_boss_challenge_pressed() -> void:
	if _selected_boss_idx < 0:
		print("[MonsterEcology] 请先选择BOSS")
		return
	var boss: Dictionary = _world_bosses[_selected_boss_idx]
	var boss_name := UIIntermediary.text(str(boss.get("name_key", "")))
	print("[MonsterEcology] 前往挑战: %s（骨架阶段：未接线）" % boss_name)

# ==============================================================================
# Tab 2: BEAST_TIDE 兽潮
# ==============================================================================

## 刷新兽潮状态面板：取第一波（进行中）渲染状态/倒计时/防线进度
func _refresh_beast_tide_status() -> void:
	if _view == null:
		return
	if _beast_tide_waves.is_empty():
		UIIntermediary.resolve(_view._label_tide_status, "ui.fe11.beast_tide.status_label", {"status": "--"})
		UIIntermediary.resolve(_view._label_tide_countdown, "ui.fe11.beast_tide.countdown_label", {"time": "--:--:--"})
		_view._tide_defense_bar.value = 0.0
		UIIntermediary.resolve(_view._label_tide_defense, "ui.fe11.beast_tide.defense_pct", {"pct": "0.0"})
		return
	var wave: Dictionary = _beast_tide_waves[0]
	var status_text: String = UIIntermediary.text(str(wave.get("status_key", "-")))
	UIIntermediary.resolve(_view._label_tide_status, "ui.fe11.beast_tide.status_label", {"status": status_text})
	UIIntermediary.resolve(_view._label_tide_countdown, "ui.fe11.beast_tide.countdown_label", {
		"time": _format_countdown(int(wave.get("countdown_sec", 0))),
	})
	var defense_pct: float = float(wave.get("defense_pct", 0.0))
	_view._tide_defense_bar.value = defense_pct
	UIIntermediary.resolve(_view._label_tide_defense, "ui.fe11.beast_tide.defense_pct", {"pct": "%.1f" % defense_pct})

## 重建兽潮波次列表（波次号/状态/倒计时/防线百分比）
func _populate_wave_list() -> void:
	if _view == null or _view._tide_wave_list == null:
		return
	for child in _view._tide_wave_list.get_children():
		child.queue_free()
	for wave in _beast_tide_waves:
		var panel := PanelContainer.new()
		var vbox := VBoxContainer.new()
		vbox.set("theme_override_constants/separation", 4)

		var title_label := Label.new()
		var status_text: String = UIIntermediary.text(str(wave.get("status_key", "-")))
		title_label.text = UIIntermediary.text("ui.fe11.beast_tide.wave_title", {
			"wave": int(wave.get("wave", 0)),
			"status": status_text,
		})
		vbox.add_child(title_label)

		var detail_label := Label.new()
		detail_label.text = UIIntermediary.text("ui.fe11.beast_tide.wave_detail", {
			"countdown": _format_countdown(int(wave.get("countdown_sec", 0))),
			"pct": "%.1f" % float(wave.get("defense_pct", 0.0)),
		})
		detail_label.set("theme_override_colors/font_color", DesignTokens.COLOR_TEXT_MUTED_DEFAULT)
		vbox.add_child(detail_label)

		panel.add_child(vbox)
		_view._tide_wave_list.add_child(panel)

## 刷新兽潮奖励列表（第一波奖励）
func _refresh_tide_rewards() -> void:
	if _view == null or _view._tide_reward_list == null:
		return
	_view._tide_reward_list.clear()
	if _beast_tide_waves.is_empty():
		return
	var wave: Dictionary = _beast_tide_waves[0]
	for reward_key in wave.get("reward_keys", []):
		UIIntermediary.resolve_item(_view._tide_reward_list, str(reward_key))

## 报名兽潮防守：切换加入/撤离按钮显隐并 print 反馈（骨架桩）
func _on_tide_join_pressed() -> void:
	_tide_joined = true
	_view._btn_tide_join.visible = false
	_view._btn_tide_leave.visible = true
	print("[MonsterEcology] 已报名兽潮防守")

## 撤离兽潮战场：切换加入/撤离按钮显隐并 print 反馈（骨架桩）
func _on_tide_leave_pressed() -> void:
	_tide_joined = false
	_view._btn_tide_join.visible = true
	_view._btn_tide_leave.visible = false
	print("[MonsterEcology] 已撤离兽潮战场")

# ==============================================================================
# 信号绑定与工具方法
# ==============================================================================

## 绑定 Tab 1 & Tab 2 交互信号
func _connect_signals() -> void:
	if _view == null:
		return
	_view._btn_boss_challenge.pressed.connect(_on_boss_challenge_pressed)
	_view._btn_tide_join.pressed.connect(_on_tide_join_pressed)
	_view._btn_tide_leave.pressed.connect(_on_tide_leave_pressed)

## 秒数格式化：HH:MM:SS（倒计时展示）
func _format_countdown(seconds: int) -> String:
	var h: int = seconds / 3600
	var m: int = (seconds % 3600) / 60
	var s: int = seconds % 60
	return "%02d:%02d:%02d" % [h, m, s]

## 统一页面标题栏构建
func create_page_header(title_key: String) -> KPageHeader:
	if page_header == null:
		page_header = KPageHeaderClass.new()
		page_header.title_key = title_key
		page_header.back_pressed.connect(func(): if _view != null: _view.back())
	return page_header

## 统一分栏面板构建
func create_split_panel(ratio: float = 0.35) -> KSplitPanel:
	if split_panel == null:
		split_panel = KSplitPanelClass.new()
		split_panel.left_ratio = ratio
	return split_panel

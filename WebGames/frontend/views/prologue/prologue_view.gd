# ==============================================================================
# 模块归属: 前端表现层 (Frontend · MOD 驱动 DAG 序章交互视图)
# 文件路径: res://frontend/views/prologue/prologue_view.gd
# 架构定位: Presentation View Controller / Interactive DAG Prologue Screen
# 依赖与触发: 上游: AccountEntryView, WorldGatewayView | 下游: PrologueTabs, ServiceLocator
# 职责说明: 展示当前激活 MOD 包驱动的序章 DAG 节点正文、过场钩子提示、分支选项按钮，
#           通过 IPrologueService 推进并交接至主页 HUD。
# 退出语义与设计依据: 序章完结后销毁交接至 main_hud，退回网关先归档清理会话
# ==============================================================================
## PrologueView：通用 MOD 序章有向无环图交互界面宿主
class_name PrologueView
extends BaseScreen

const TabsClass = preload("res://frontend/views/prologue/prologue_tabs.gd")

var current_account_id: String = ""
var current_session_token: String = ""
var current_world_id: String = ""
var current_dag_id: String = ""
var current_node_id: String = ""
var current_node_type: String = ""
var current_step_index: int = 0
var is_completed: bool = false
var current_cutscene_trigger: String = ""
var current_choices: Array = []
var narrative_history: Array = []

var _tabs: TabsClass = null

@onready var title_label: Label = %TitleLabel
@onready var node_badge_label: Label = %NodeBadgeLabel
@onready var skip_prologue_btn: Button = %SkipPrologueBtn
@onready var exit_gateway_btn: Button = %ExitGatewayBtn
@onready var cutscene_banner_label: Label = %CutsceneBannerLabel
@onready var narrative_rich_label: RichTextLabel = %NarrativeRichLabel
@onready var choices_container: VBoxContainer = %ChoicesContainer
@onready var status_hint_label: Label = %StatusHintLabel
@onready var enter_world_hud_btn: Button = %EnterWorldHudBtn

func _get_tabs() -> TabsClass:
	if _tabs == null:
		_tabs = _register_owned_subcontroller(TabsClass.new()) as TabsClass
		_tabs.setup(self)
	return _tabs

func _ready() -> void:
	var theme_manager := ThemeManager.get_instance()
	if theme_manager.theme != null:
		theme = theme_manager.theme
	_get_tabs().init_static_text()
	_connect_signals()
	UIIntermediary.adapt_view(self)

## 进入序章交互视图时绑定世界上下文并启动或恢复当前 DAG 节点
func on_screen_enter(screen_parameters: Dictionary = {}) -> void:
	super.on_screen_enter(screen_parameters)
	_sync_navigation_context_properties(screen_parameters, {"world_id": "current_world_id"})
	if screen_parameters.has("initial_prologue_state") and screen_parameters.get("initial_prologue_state") is Dictionary:
		apply_snapshot(screen_parameters.get("initial_prologue_state") as Dictionary)
	else:
		load_prologue_node({})

## 向序章服务请求启动或读取当前 DAG 节点状态
func load_prologue_node(request_payload: Dictionary = {}) -> Dictionary:
	return _get_tabs().load_or_start_prologue(request_payload)

## 触发选中一个序章分支选择 ID 并推进 DAG
func choose_branch(choice_id: String) -> Dictionary:
	return _get_tabs().advance_choice(choice_id)

## 完结或跳过序章并交接到主页 HUD
func complete_and_enter_hud(should_skip: bool = false) -> Dictionary:
	return _get_tabs().complete_and_enter_hud(should_skip)

## 统一快照渲染映射：只将节点状态、台词与可用选项映射到 UI
func _render_from_snapshot() -> void:
	if snapshot.has("dag_id"):
		current_dag_id = FrontendSnapshot.read_string(snapshot, "dag_id", current_dag_id)
	if snapshot.has("node_id"):
		current_node_id = FrontendSnapshot.read_string(snapshot, "node_id", current_node_id)
	if snapshot.has("node_type"):
		current_node_type = FrontendSnapshot.read_string(snapshot, "node_type", current_node_type)
	if snapshot.has("step_index"):
		current_step_index = FrontendSnapshot.read_int(snapshot, "step_index", current_step_index)
	elif snapshot.has("current_stage"):
		current_step_index = FrontendSnapshot.read_int(snapshot, "current_stage", current_step_index)
	if snapshot.has("is_completed"):
		is_completed = FrontendSnapshot.read_bool(snapshot, "is_completed", is_completed)
	if snapshot.has("cutscene_trigger"):
		current_cutscene_trigger = FrontendSnapshot.read_string(snapshot, "cutscene_trigger", "")
	if snapshot.has("choices"):
		current_choices = FrontendSnapshot.read_array(snapshot, "choices")
	var line_text := FrontendSnapshot.read_string(snapshot, "narrative_text", FrontendSnapshot.read_string(snapshot, "text", ""))
	if not line_text.is_empty():
		narrative_history.append(line_text)
		if narrative_history.size() > 64:
			narrative_history.pop_front()
	_get_tabs().render_all()

func _connect_signals() -> void:
	if skip_prologue_btn != null:
		connect_managed(skip_prologue_btn.pressed, _on_skip_debounced)
	if exit_gateway_btn != null:
		connect_managed(exit_gateway_btn.pressed, _on_exit_gateway_debounced)
	if enter_world_hud_btn != null:
		connect_managed(enter_world_hud_btn.pressed, _on_enter_hud_debounced)

func _on_skip_debounced() -> void:
	if try_consume_action_cooldown("prologue_skip", 250):
		complete_and_enter_hud(true)

func _on_exit_gateway_debounced() -> void:
	if try_consume_action_cooldown("prologue_exit", 250):
		_get_tabs().exit_to_world_gateway()

func _on_enter_hud_debounced() -> void:
	if try_consume_action_cooldown("prologue_enter_hud", 250):
		complete_and_enter_hud(false)

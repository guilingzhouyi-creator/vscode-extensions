# ==============================================================================
# 模块归属: 前端视图层 (Frontend · 表现层控制器)
# 文件路径: WebGames/frontend/views/example/example_tab_view_controller.gd
# 架构定位: 强类型 Tabs 视图控制器 (Godot 4.7 Control 节点树)
# 依赖与触发: 触发方: 上层页面容器 | 上游: apply_snapshot 强类型数据注入 | 下游: 子视图节点
# 职责说明: 协调管理选项卡切换，单向将快照分发至各强类型子视图，严格执行表现层零业务计算
# 退出语义与设计依据: 退出语义: 纯展现控制器无退出码 | 设计依据: GD老练风格硬性规范第九章
# ==============================================================================
class_name ExampleTabViewController
extends Control

## 强类型子视图节点引用 (严禁弱类型与动态穿透)
@onready var _overview_tab: Control = %OverviewTab
@onready var _details_tab: Control = %DetailsTab
@onready var _tab_bar: TabBar = %TabBar

## 当前选中的标签索引
var _current_tab_index: int = 0

func _ready() -> void:
	if _tab_bar == null:
		push_error("TabBar node not found")
		return
	_tab_bar.tab_changed.connect(_on_tab_changed)
	_update_tab_visibility()

## 唯一数据注入入口: 纯快照单向传递 (零业务计算)
func apply_snapshot(snapshot: Dictionary) -> void:
	if snapshot.is_empty():
		return
	
	if snapshot.has("overview") and _overview_tab != null:
		if _overview_tab.has_method("apply_snapshot"):
			_overview_tab.apply_snapshot(snapshot.get("overview", {}))
	
	if snapshot.has("details") and _details_tab != null:
		if _details_tab.has_method("apply_snapshot"):
			_details_tab.apply_snapshot(snapshot.get("details", {}))

func _on_tab_changed(index: int) -> void:
	if index == _current_tab_index:
		return
	_current_tab_index = index
	_update_tab_visibility()

func _update_tab_visibility() -> void:
	if _overview_tab != null:
		_overview_tab.visible = (_current_tab_index == 0)
	if _details_tab != null:
		_details_tab.visible = (_current_tab_index == 1)

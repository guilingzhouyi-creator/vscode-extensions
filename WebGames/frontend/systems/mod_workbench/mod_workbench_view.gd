# ==============================================================================
# 模块归属: 表现层 / 界面系统 (Frontend · 模组工坊系统 (Mod Workbench))
# 文件路径: res://frontend/systems/mod_workbench/mod_workbench_view.gd
# 架构定位: UI Placeholder Contract / Lightweight Whitebox View
# 跨域依赖: 上游: 模组系统路由, 前端主视口 | 下游: AgentPlaythroughSession | 配置: 无 | 信号: 无
# 职责说明: 模组工坊前端轻量白模与契约占位接口（遵循工程渐进原则：当前阶段严禁复杂 UI 渲染接线，预留会话绑定与快照重放接口契约，待核心系统成熟度达 80% 后再深度装配控件树）。
# 设计依据: 表现层轻量化与高内聚解耦契约
# ==============================================================================

class_name ModWorkbenchView
extends Control

var _bound_session: RefCounted = null
var _workbench_state: Dictionary = {
	"is_bound": false,
	"session_id": "",
	"current_step": 0,
	"active_node_id": "",
	"cached_snapshot": {}
}

# ==============================================================================
# 一、会话绑定与契约接口
# ==============================================================================

## 绑定长程交互式推演会话（轻量弱耦合存储，不挂载子节点）
func bind_session(session: AgentPlaythroughSession) -> void:
	_bound_session = session
	if session == null:
		_workbench_state["is_bound"] = false
		_workbench_state["session_id"] = ""
		return

	_workbench_state["is_bound"] = true
	_workbench_state["session_id"] = session.session_id
	_workbench_state["current_step"] = session.step_index

## 获取当前工坊轻量占位状态字典
func get_workbench_state() -> Dictionary:
	if _bound_session != null and _bound_session is AgentPlaythroughSession:
		var sess: AgentPlaythroughSession = _bound_session
		_workbench_state["session_id"] = sess.session_id
		_workbench_state["current_step"] = sess.step_index
		_workbench_state["is_terminal"] = sess.is_terminal
	return _workbench_state.duplicate(true)

## 应用推演或工坊快照数据
func apply_snapshot(snapshot: Dictionary) -> void:
	if snapshot.is_empty():
		return
	_workbench_state["cached_snapshot"] = snapshot.duplicate(true)
	if snapshot.has("session_id"):
		_workbench_state["session_id"] = str(snapshot.get("session_id", ""))
	if snapshot.has("step_index"):
		_workbench_state["current_step"] = int(snapshot.get("step_index", 0))
	if snapshot.has("current_node_id"):
		_workbench_state["active_node_id"] = str(snapshot.get("current_node_id", ""))

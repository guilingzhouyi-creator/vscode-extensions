# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/narrative_orchestration/narrative_dag_session_dto.gd
# 架构定位: Domain FSM / Lifecycle Session Engine
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/narrative_orchestration.json | 信号: EventBus 领域广播
# 职责说明: 序列化并承载 DAG 执行引擎的运行时活跃状态、已完成集合与上下文，支持存盘恢复
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name NarrativeDagSessionDTO
extends RefCounted

var graph_id: String = ""
var active_node_ids: Array[String] = []
var completed_node_ids: Array[String] = []
var runtime_context: Dictionary = {}
var is_terminated: bool = false
var snapshot_timestamp_utc: int = 0

func _init(p_graph_id: String = "") -> void:
	graph_id = p_graph_id
	active_node_ids = []
	completed_node_ids = []
	runtime_context = {}
	is_terminated = false
	snapshot_timestamp_utc = 0

func to_dto() -> Dictionary:
	return {
		"graph_id": graph_id,
		"active_node_ids": active_node_ids.duplicate(),
		"completed_node_ids": completed_node_ids.duplicate(),
		"runtime_context": runtime_context.duplicate(true),
		"is_terminated": is_terminated,
		"snapshot_timestamp_utc": snapshot_timestamp_utc
	}

static func from_dto(data: Dictionary) -> RefCounted:
	var dto = load("res://backend/domains/narrative_orchestration/narrative_dag_session_dto.gd").new()
	if data.is_empty():
		return dto
	dto.graph_id = str(data.get("graph_id", ""))
	dto.active_node_ids.assign(data.get("active_node_ids", []))
	dto.completed_node_ids.assign(data.get("completed_node_ids", []))
	dto.runtime_context = (data.get("runtime_context", {}) as Dictionary).duplicate(true)
	dto.is_terminated = bool(data.get("is_terminated", false))
	dto.snapshot_timestamp_utc = int(data.get("snapshot_timestamp_utc", 0))
	return dto

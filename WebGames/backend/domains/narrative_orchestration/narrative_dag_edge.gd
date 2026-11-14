# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/narrative_orchestration/narrative_dag_edge.gd
# 架构定位: Domain Logic Component
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/narrative_orchestration.json | 信号: EventBus 领域广播
# 职责说明: 表达剧情节点之间的单向流转关系、分支条件与仲裁权重
# 退出语义与设计依据: 业务域第一性原理 / 架构设计规范
# ==============================================================================

## NarrativeDAGEdge：Domain Logic Component
class_name NarrativeDAGEdge
extends RefCounted

var from_node_id: String = ""
var to_node_id: String = ""
var branch_condition: Dictionary = {}
var priority_weight: int = 100

## 边构造（起止节点/分支条件/仲裁权重）
func _init(
	initial_from_node_id: String = "",
	initial_to_node_id: String = "",
	initial_branch_condition: Dictionary = {},
	initial_priority_weight: int = 100
) -> void:
	from_node_id = initial_from_node_id
	to_node_id = initial_to_node_id
	branch_condition = initial_branch_condition
	priority_weight = initial_priority_weight

## 序列化边为字典（条件深拷贝）
func to_dto() -> Dictionary:
	return {
		"from_node_id": from_node_id,
		"to_node_id": to_node_id,
		"branch_condition": branch_condition.duplicate(true),
		"priority_weight": priority_weight
	}

## 从字典重建边（空字典回退默认权重 100）
static func from_dto(serialized_payload: Dictionary) -> NarrativeDAGEdge:
	var edge := NarrativeDAGEdge.new()
	if serialized_payload.is_empty():
		return edge
	edge.from_node_id = str(serialized_payload.get("from_node_id", serialized_payload.get("from", "")))
	edge.to_node_id = str(serialized_payload.get("to_node_id", serialized_payload.get("to", "")))
	edge.branch_condition = (serialized_payload.get("branch_condition", {}) as Dictionary).duplicate(true)
	edge.priority_weight = int(serialized_payload.get("priority_weight", 100))
	return edge

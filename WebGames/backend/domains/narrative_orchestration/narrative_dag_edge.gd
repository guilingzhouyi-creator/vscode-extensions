# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/narrative_orchestration/narrative_dag_edge.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/narrative_orchestration.json | 信号: EventBus 领域广播
# 职责说明: 表达剧情节点之间的单向流转关系、分支条件与仲裁权重
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name NarrativeDAGEdge
extends RefCounted

var from_node_id: String = ""
var to_node_id: String = ""
var branch_condition: Dictionary = {}
var priority_weight: int = 100

## 边构造（起止节点/分支条件/仲裁权重）
func _init(p_from: String = "", p_to: String = "", p_cond: Dictionary = {}, p_prio: int = 100) -> void:
	from_node_id = p_from
	to_node_id = p_to
	branch_condition = p_cond
	priority_weight = p_prio

## 序列化边为字典（条件深拷贝）
func to_dto() -> Dictionary:
	return {
		"from_node_id": from_node_id,
		"to_node_id": to_node_id,
		"branch_condition": branch_condition.duplicate(true),
		"priority_weight": priority_weight
	}

## 从字典重建边（空字典回退默认权重 100）
static func from_dto(d: Dictionary) -> NarrativeDAGEdge:
	var edge := NarrativeDAGEdge.new()
	if d.is_empty():
		return edge
	edge.from_node_id = str(d.get("from_node_id", ""))
	edge.to_node_id = str(d.get("to_node_id", ""))
	edge.branch_condition = (d.get("branch_condition", {}) as Dictionary).duplicate(true)
	edge.priority_weight = int(d.get("priority_weight", 100))
	return edge

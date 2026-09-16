# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/narrative_orchestration/narrative_dag_node.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/narrative_orchestration.json | 信号: EventBus 领域广播
# 职责说明: 剧情因果有向无环图节点实体，表达标准步进、条件分支、并行与汇聚
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name NarrativeDAGNode
extends RefCounted

enum NodeType {
	START_ENTRY = 0,      ## 起始入口节点 (入度为 0)
	STANDARD_STEP = 1,    ## 普通剧情步进节点 (单入单出)
	BRANCH_CHOICE = 2,    ## 条件分支选择节点 (根据运行时条件选择出边)
	PARALLEL_FORK = 3,    ## 并行分流节点 (同时激活多条下游分支)
	CONVERGENCE_JOIN = 4, ## 汇聚同步节点 (等待必要前置全部完成)
	TERMINAL_EXIT = 5     ## 终态退出节点 (出度为 0，标志剧情完结)
}

var node_id: String = ""
var node_type: int = NodeType.STANDARD_STEP
var narrative_key: String = ""
var required_prerequisites: Array[String] = []
## 预留演进位：节点完成条件的结构化 AST（当前无求值器消费，仅供配置透传与未来
## 条件汇聚/动态解锁引擎使用——勿将运行逻辑依赖于此字段的求值结果）
var completion_condition_ast: Dictionary = {}
var mutations_on_complete: Array[Dictionary] = []
var is_optional: bool = false

## 构造节点（ID/类型/叙事键默认装配）
func _init(p_id: String = "", p_type: int = NodeType.STANDARD_STEP, p_narrative_key: String = "") -> void:
	node_id = p_id
	node_type = p_type
	narrative_key = p_narrative_key


## 将配置字符串节点类型解析为枚举（R3 修复：registry 改全字段 from_dto 装配的配套）
static func parse_node_type(type_str: String) -> int:
	match type_str:
		"START_ENTRY":
			return NodeType.START_ENTRY
		"BRANCH_CHOICE":
			return NodeType.BRANCH_CHOICE
		"PARALLEL_FORK":
			return NodeType.PARALLEL_FORK
		"CONVERGENCE_JOIN":
			return NodeType.CONVERGENCE_JOIN
		"TERMINAL_EXIT":
			return NodeType.TERMINAL_EXIT
		_:
			return NodeType.STANDARD_STEP

## 序列化节点为字典（前置/条件 AST/mutations 深拷贝）
func to_dto() -> Dictionary:
	return {
		"node_id": node_id,
		"node_type": node_type,
		"narrative_key": narrative_key,
		"required_prerequisites": required_prerequisites.duplicate(),
		"completion_condition_ast": completion_condition_ast.duplicate(true),
		"mutations_on_complete": mutations_on_complete.duplicate(true),
		"is_optional": is_optional
	}

## 从字典重建节点（node_type 支持字符串枚举或整型，空字典回退默认）
static func from_dto(d: Dictionary) -> NarrativeDAGNode:
	var node := NarrativeDAGNode.new()
	if d.is_empty():
		return node
	node.node_id = str(d.get("node_id", ""))
	var raw_type: Variant = d.get("node_type", NodeType.STANDARD_STEP)
	node.node_type = parse_node_type(str(raw_type)) if raw_type is String else int(raw_type)
	node.narrative_key = str(d.get("narrative_key", ""))
	node.required_prerequisites.clear()
	for pre in (d.get("required_prerequisites", []) as Array):
		node.required_prerequisites.append(str(pre))
	node.completion_condition_ast = (d.get("completion_condition_ast", {}) as Dictionary).duplicate(true)
	node.mutations_on_complete.clear()
	for m in (d.get("mutations_on_complete", []) as Array):
		node.mutations_on_complete.append((m as Dictionary).duplicate(true))
	node.is_optional = bool(d.get("is_optional", false))
	return node

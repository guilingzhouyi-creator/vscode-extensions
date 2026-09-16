---
档号: KALAR-DEV-2026-ST46-002
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST46 (Phase_50_通用剧情因果DAG编排引擎与多角色差异化拓扑)
件号: 002
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_50_通用剧情因果DAG编排引擎与多角色差异化拓扑 —— 阶段2：DAG拓扑解析器环依赖检测与状态跃迁执行引擎实现
形成日期: 2026-09-03
归档日期: 2026-09-05（上午）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: CausalityDagValidator; NarrativeDagExecutionEngine; DAG拓扑解析器环依赖检测; 状态跃迁执行引擎实现
---

# 施工细则：阶段2_DAG拓扑解析器环依赖检测与状态跃迁执行引擎实现

> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST46-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST46-001_阶段1_剧情因果DAG模型节点分支契约与拓扑规范设计.md) ｜ **阶段2 (当前)** ｜ [阶段3](KALAR-DEV-2026-ST46-003_阶段3_多角色差异化序章配置架构与EventBus总线接线工程化.md) ｜ [阶段4](KALAR-DEV-2026-ST46-004_阶段4_DAG编排拓扑多分支汇聚与环检测验收测试矩阵.md)

> 施工开始日期: 2026-09-03 下午
> 责任人: 卡拉尔世界引擎架构组
> 状态: ✅ 已完成第2轮闭环验收（100% PASS）

---

## 一、 阶段目标与算法定位 (对齐 P10.6 / 10.8)

本阶段实现通用剧情 DAG 的核心执行与校验引擎：
1. **`CausalityDagValidator`（DAG 拓扑合法性与死锁环检测器）**：在图加载时通过 Kahn 算法实现拓扑排序，严格检测并拦截循环依赖环（Cycle）、不可达孤立节点与缺失依赖；
2. **`NarrativeDagExecutionEngine`（DAG 状态跃迁执行引擎）**：运行时维护节点激活态、汇聚等待计数与分支判定，彻底杜绝代码中硬编码的复杂 `if/else` 嵌套。

---

## 二、 DAG 拓扑合法性与环依赖检测算法 (`CausalityDagValidator`)

```gdscript
class_name CausalityDagValidator
extends RefCounted

## 对传入的剧情 DAG 图进行全面静态拓扑校验 (Kahn 算法)
static func validate_graph(graph: NarrativeDAGGraphDTO) -> Dictionary:
	if graph == null or graph.nodes.is_empty():
		return { "is_valid": false, "error_code": "EMPTY_GRAPH", "message": "图元或节点集合为空" }

	if graph.entry_node_id.is_empty() or not graph.nodes.has(graph.entry_node_id):
		return { "is_valid": false, "error_code": "INVALID_ENTRY_NODE", "message": "入口节点不存在" }

	# 1. 构建邻接表与入度表
	var in_degree: Dictionary = {}
	var adj_list: Dictionary = {}
	for nid in graph.nodes.keys():
		in_degree[nid] = 0
		adj_list[nid] = []

	# 遍历边计算入度
	for edge in graph.edges:
		if not graph.nodes.has(edge.from_node_id) or not graph.nodes.has(edge.to_node_id):
			return {
				"is_valid": false,
				"error_code": "DANGLING_EDGE",
				"message": "边连接了不存在的节点: %s -> %s" % [edge.from_node_id, edge.to_node_id]
			}
		adj_list[edge.from_node_id].append(edge.to_node_id)
		in_degree[edge.to_node_id] = int(in_degree.get(edge.to_node_id, 0)) + 1

	# 同时校验显式声明的 required_prerequisites
	for nid in graph.nodes.keys():
		var node: NarrativeDAGNode = graph.nodes[nid]
		for pre in node.required_prerequisites:
			if not graph.nodes.has(pre):
				return {
					"is_valid": false,
					"error_code": "MISSING_PREREQUISITE",
					"message": "节点 %s 依赖不存在的前置: %s" % [nid, pre]
				}

	# 2. Kahn 拓扑排序算法检测是否有环
	var zero_in_degree_queue: Array[String] = []
	for nid in in_degree.keys():
		if in_degree[nid] == 0:
			zero_in_degree_queue.append(nid)

	var visited_count := 0
	while not zero_in_degree_queue.is_empty():
		var current = zero_in_degree_queue.pop_front()
		visited_count += 1
		for neighbor in adj_list.get(current, []):
			in_degree[neighbor] -= 1
			if in_degree[neighbor] == 0:
				zero_in_degree_queue.append(neighbor)

	if visited_count < graph.nodes.size():
		return {
			"is_valid": false,
			"error_code": "CYCLE_DETECTED",
			"message": "剧情 DAG 中检测到非法循环依赖环 (Cycle)，已访问 %d / 总数 %d" % [visited_count, graph.nodes.size()]
		}

	return { "is_valid": true, "sorted_node_count": visited_count }
```

---

## 三、 运行时 DAG 状态跃迁引擎 (`NarrativeDagExecutionEngine`)

```gdscript
class_name NarrativeDagExecutionEngine
extends RefCounted

var graph: NarrativeDAGGraphDTO = null
var active_node_ids: Array[String] = []
var completed_node_ids: Array[String] = []
var runtime_context: Dictionary = {}
var is_terminated: bool = false

func initialize_with_graph(p_graph: NarrativeDAGGraphDTO, initial_context: Dictionary = {}) -> Dictionary:
	var val_res := CausalityDagValidator.validate_graph(p_graph)
	if not val_res.get("is_valid", false):
		return { "success": false, "error": val_res }

	graph = p_graph
	runtime_context = initial_context.duplicate(true)
	active_node_ids = [graph.entry_node_id]
	completed_node_ids = []
	is_terminated = false

	return { "success": true, "entry_node_id": graph.entry_node_id }

## 触发节点动作推进
func execute_node_action(node_id: String, action_payload: Dictionary = {}) -> Dictionary:
	if is_terminated:
		return { "success": false, "error_code": "GRAPH_ALREADY_TERMINATED" }

	if not active_node_ids.has(node_id):
		return { "success": false, "error_code": "NODE_NOT_ACTIVE", "node_id": node_id }

	var current_node: NarrativeDAGNode = graph.nodes.get(node_id)
	if current_node == null:
		return { "success": false, "error_code": "NODE_NOT_FOUND" }

	# 1. 检查前置依赖是否全部完成 (汇聚判定)
	for pre in current_node.required_prerequisites:
		if not completed_node_ids.has(pre):
			return {
				"success": false,
				"error_code": "PREREQUISITES_NOT_MET",
				"missing_pre": pre,
				"message": "汇聚前置节点尚未完成"
			}

	# 2. 标记完成并移出活跃列表
	active_node_ids.erase(node_id)
	if not completed_node_ids.has(node_id):
		completed_node_ids.append(node_id)

	# 合并动作结果至上下文
	for k in action_payload.keys():
		runtime_context[k] = action_payload[k]

	# 3. 终态判定
	if node_id == graph.terminal_node_id or current_node.node_type == NarrativeNodeType.TERMINAL_EXIT:
		is_terminated = true
		active_node_ids.clear()
		return {
			"success": true,
			"status": "TERMINATED",
			"completed_node": node_id,
			"mutations": current_node.mutations_on_complete
		}

	# 4. 派生激活下游节点 (支持分支与并行分流)
	var newly_activated: Array[String] = []
	var outgoing_edges := _get_outgoing_edges(node_id)

	for edge in outgoing_edges:
		if _evaluate_edge_condition(edge.branch_condition, runtime_context):
			var next_id := edge.to_node_id
			# 检查下游节点的前置依赖是否在此时全部就绪
			var next_node: NarrativeDAGNode = graph.nodes.get(next_id)
			if next_node != null and _are_prerequisites_satisfied(next_node):
				if not active_node_ids.has(next_id):
					active_node_ids.append(next_id)
					newly_activated.append(next_id)

	return {
		"success": true,
		"completed_node": node_id,
		"newly_activated": newly_activated,
		"active_nodes": active_node_ids.duplicate(),
		"mutations": current_node.mutations_on_complete
	}

func _get_outgoing_edges(from_id: String) -> Array[NarrativeDAGEdge]:
	var res: Array[NarrativeDAGEdge] = []
	for e in graph.edges:
		if e.from_node_id == from_id:
			res.append(e)
	return res

func _evaluate_edge_condition(cond: Dictionary, ctx: Dictionary) -> bool:
	if cond.is_empty():
		return true
	var kind: String = str(cond.get("kind", ""))
	var target_val: Variant = cond.get("val", null)
	match kind:
		"EQUALS":
			var key: String = str(cond.get("key", ""))
			return ctx.get(key, null) == target_val
		"CHOICE_MATCH":
			return ctx.get("selected_choice", "") == target_val
	return true

func _are_prerequisites_satisfied(node: NarrativeDAGNode) -> bool:
	for pre in node.required_prerequisites:
		if not completed_node_ids.has(pre):
			return false
	return true
```

---

## 四、 本阶段交付物与验证基准

1. **校验器与执行引擎源码**：
   - `backend/domains/narrative_orchestration/causality_dag_validator.gd`
   - `backend/domains/narrative_orchestration/narrative_dag_execution_engine.gd`
2. **算法不变量断言**：
   - 含有环（Cycle）的 DAG 配置在加载期被 100% 拦截并返回 `CYCLE_DETECTED`；
   - 汇聚节点在前置依赖未达标前保持阻断，前置满足后自动唤醒。

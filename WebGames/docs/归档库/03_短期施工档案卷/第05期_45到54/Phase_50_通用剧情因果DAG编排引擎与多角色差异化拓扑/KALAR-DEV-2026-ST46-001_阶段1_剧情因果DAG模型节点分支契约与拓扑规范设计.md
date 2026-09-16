---
档号: KALAR-DEV-2026-ST46-001
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST46 (Phase_50_通用剧情因果DAG编排引擎与多角色差异化拓扑)
件号: 001
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_50_通用剧情因果DAG编排引擎与多角色差异化拓扑 —— 阶段1：剧情因果DAG模型节点分支契约与拓扑规范设计
形成日期: 2026-09-03
归档日期: 2026-09-05（上午）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: NarrativeDAGNode; NarrativeDAGEdge; 节点类型枚举; DAG 节点数据契约; DAG 有向边数据契约
---

# 施工细则：阶段1_剧情因果DAG模型节点分支契约与拓扑规范设计

> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST46-ATT_附件_案卷共享契约与上下文.md) ｜ **阶段1 (当前)** ｜ [阶段2](KALAR-DEV-2026-ST46-002_阶段2_DAG拓扑解析器环依赖检测与状态跃迁执行引擎实现.md) ｜ [阶段3](KALAR-DEV-2026-ST46-003_阶段3_多角色差异化序章配置架构与EventBus总线接线工程化.md) ｜ [阶段4](KALAR-DEV-2026-ST46-004_阶段4_DAG编排拓扑多分支汇聚与环检测验收测试矩阵.md)

> 施工开始日期: 2026-09-03 下午
> 责任人: 卡拉尔世界引擎架构组
> 状态: ✅ 已完成第2轮闭环验收（100% PASS）

---

## 一、 阶段目标与拓扑定位 (对齐 P10.6 / 10.7)

本阶段为卡拉尔世界引擎设计通用剧情因果 DAG（有向无环图）编排数据模型与节点契约。

打破传统简单的线性单向推进（$A \to B \to C$），构建支持**条件分支、多路径并行、汇聚等待、前置依赖、失败路径、可选路径与状态解耦触发**的高阶事件网络：

```
                           【剧情因果 DAG 拓扑编排示意】

                      ┌─── [Event B: 探索广场喷泉] ───┐ (可选/并行)
                      │                               │
  [Event A: 角色苏醒] ──┼─── [Event C: 聆听方尖碑吟唱] ──┼───> [Event E: 汇聚-卫兵现身]
                      │                               │
                      └─── [Event D: 调查行囊痕迹] ───┘
```

---

## 二、 DAG 节点与依赖边数据模型 (`NarrativeDAGNode` / `NarrativeDAGEdge`)

### 1. 节点类型枚举 (`NodeType`)
```gdscript
enum NarrativeNodeType {
	START_ENTRY,     # 起始入口节点 (入度为 0)
	STANDARD_STEP,   # 普通剧情步进节点 (单入单出)
	BRANCH_CHOICE,   # 条件分支选择节点 (根据运行时条件选择出边)
	PARALLEL_FORK,   # 并行分流节点 (同时激活多条下游分支)
	CONVERGENCE_JOIN,# 汇聚同步节点 (等待指定入边前置条件全部/部分就绪)
	TERMINAL_EXIT    # 终态退出节点 (出度为 0，标志本段剧情完结)
}
```

### 2. DAG 节点数据契约 (`NarrativeDAGNode`)
```gdscript
class_name NarrativeDAGNode
extends RefCounted

var node_id: String = ""                           # 节点唯一标识，如 "NODE_AWAKEN_01"
var node_type: int = NarrativeNodeType.STANDARD_STEP
var narrative_key: String = ""                     # 后端剧情 i18n 资源 Key
var required_prerequisites: Array[String] = []     # 前置依赖节点 ID 集合 (汇聚判定)
var completion_condition_ast: Dictionary = {}      # 节点完成或分支成立的 AST 条件树
var mutations_on_complete: Array[Dictionary] = []  # 节点完成后派发的结构化突变动作列表
var is_optional: bool = false                      # 是否为可选节点 (失败或跳过不阻断主线)

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

static func from_dto(d: Dictionary) -> NarrativeDAGNode:
	var node := NarrativeDAGNode.new()
	if d.is_empty():
		return node
	node.node_id = str(d.get("node_id", ""))
	node.node_type = int(d.get("node_type", NarrativeNodeType.STANDARD_STEP))
	node.narrative_key = str(d.get("narrative_key", ""))
	node.required_prerequisites.clear()
	for pre in (d.get("required_prerequisites", []) as Array):
		node.required_prerequisites.append(str(pre))
	node.completion_condition_ast = (d.get("completion_condition_ast", {}) as Dictionary).duplicate(true)
	node.mutations_on_complete = (d.get("mutations_on_complete", []) as Array).duplicate(true)
	node.is_optional = bool(d.get("is_optional", false))
	return node
```

### 3. DAG 有向边数据契约 (`NarrativeDAGEdge`)
```gdscript
class_name NarrativeDAGEdge
extends RefCounted

var from_node_id: String = ""
var to_node_id: String = ""
var branch_condition: Dictionary = {}    # 分支流转条件 (例如 {"kind": "CHOICE_EQUALS", "val": "EXPLORE"})
var priority_weight: int = 100           # 多分支仲裁权重

func to_dto() -> Dictionary:
	return {
		"from_node_id": from_node_id,
		"to_node_id": to_node_id,
		"branch_condition": branch_condition.duplicate(true),
		"priority_weight": priority_weight
	}

static func from_dto(d: Dictionary) -> NarrativeDAGEdge:
	var edge := NarrativeDAGEdge.new()
	if d.is_empty():
		return edge
	edge.from_node_id = str(d.get("from_node_id", ""))
	edge.to_node_id = str(d.get("to_node_id", ""))
	edge.branch_condition = (d.get("branch_condition", {}) as Dictionary).duplicate(true)
	edge.priority_weight = int(d.get("priority_weight", 100))
	return edge
```

---

## 三、 图图元聚合根模型 (`NarrativeDAGGraphDTO`)

```gdscript
class_name NarrativeDAGGraphDTO
extends RefCounted

var graph_id: String = ""                   # 图唯一编号，如 "DAG_PROLOGUE_HUMAN_NOBLE"
var entry_node_id: String = ""              # 入口节点 ID
var terminal_node_id: String = ""           # 终态节点 ID
var nodes: Dictionary = {}                  # node_id -> NarrativeDAGNode
var edges: Array[NarrativeDAGEdge] = []     # 有向边集合

func add_node(node: NarrativeDAGNode) -> void:
	if node != null and not node.node_id.is_empty():
		nodes[node.node_id] = node

func add_edge(edge: NarrativeDAGEdge) -> void:
	if edge != null:
		edges.append(edge)
```

---

## 四、 事件与状态彻底解耦契约 (对齐 P10.7)

节点完成或状态流转触发时，只抛出中立、正交的结构化领域突变，严禁绑定具体表现层页面：

| 结构化事件类型 | 载荷参数示例 | 消费方系统 |
| :--- | :--- | :--- |
| `StoryBranchChanged` | `{"dag_id": "...", "from_node": "A", "to_node": "B"}` | 剧情执行器、表现层日志 |
| `CausalityNodeCompleted` | `{"node_id": "...", "completed_at_utc": 1756900000}` | 任务系统、状态机 |
| `StateVariableMutated` | `{"key": "REPUTATION_TOWN", "delta": 10}` | 势力声望、经济系统 |
| `DialogueReady` | `{"dialogue_key": "narrative.prologue.guard_01"}` | 前端对白组件消费 |

---

## 五、 本阶段交付物与验证基准

1. **实体与 DTO 定义**：
   - `backend/domains/narrative_orchestration/narrative_dag_node.gd`
   - `backend/domains/narrative_orchestration/narrative_dag_edge.gd`
   - `backend/domains/narrative_orchestration/narrative_dag_graph_dto.gd`
2. **验证基准**：
   - 节点与边 DTO 往返反序列化 100% 结构无损；
   - 契约全面覆盖条件分支、并行、汇聚与终态标记。

---
档号: KALAR-DEV-2026-ST46-003
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST46 (Phase_50_通用剧情因果DAG编排引擎与多角色差异化拓扑)
件号: 003
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_50_通用剧情因果DAG编排引擎与多角色差异化拓扑 —— 阶段3：多角色差异化序章配置架构与EventBus总线接线工程化
形成日期: 2026-09-03
归档日期: 2026-09-05（上午）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: PrologueDagRegistry; 多角色差异化序章配置架构; EventBus总线接线工程化; prologue_dag_catalog.json
---

# 施工细则：阶段3_多角色差异化序章配置架构与EventBus总线接线工程化

> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST46-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST46-001_阶段1_剧情因果DAG模型节点分支契约与拓扑规范设计.md) ｜ [阶段2](KALAR-DEV-2026-ST46-002_阶段2_DAG拓扑解析器环依赖检测与状态跃迁执行引擎实现.md) ｜ **阶段3 (当前)** ｜ [阶段4](KALAR-DEV-2026-ST46-004_阶段4_DAG编排拓扑多分支汇聚与环检测验收测试矩阵.md)

> 施工开始日期: 2026-09-03 下午
> 责任人: 卡拉尔世界引擎架构组
> 状态: ✅ 已完成第2轮闭环验收（100% PASS）

---

## 一、 阶段目标与配置作用范围 (对齐 P10.8 / 10.9)

本阶段实现多角色差异化序章的纯配置化装配体系：
1. **配置作用范围（P10.8）**：配置文件全面承接事件定义、节点关系、分支条件、文案 Key、初始化参数及分支规则；代码引擎仅负责通用解析、校验与状态裁定；
2. **极高扩展性边界（P10.9）**：未来新增不同种族、不同出生背景、不同起始地点与角色经历时，仅需**“新增配置 + 新增剧情资源”**，严禁修改剧情执行内核代码；
3. **`EventBus` 全域事件流贯通**：每次 DAG 节点激活与分支流转均向 `EventBus` 广播标准结构化事件，供前端对白系统与世界状态机订阅。

---

## 二、 差异化序章 DAG 目录配置架构 (`config/narratives/prologue_dag_catalog.json`)

```json
{
  "prologue_routing_rules": [
    {
      "match_condition": { "race_id": "ELF" },
      "target_dag_id": "DAG_PROLOGUE_ELF_SANCTUARY"
    },
    {
      "match_condition": { "race_id": "HUMAN" },
      "target_dag_id": "DAG_PROLOGUE_HUMAN_CAPITAL"
    },
    {
      "match_condition": { "is_default": true },
      "target_dag_id": "DAG_PROLOGUE_HUMAN_CAPITAL"
    }
  ],
  "dag_graphs": {
    "DAG_PROLOGUE_HUMAN_CAPITAL": {
      "entry_node_id": "NODE_AWAKEN_PLAZA",
      "terminal_node_id": "NODE_DEPART_WORLD",
      "nodes": {
        "NODE_AWAKEN_PLAZA": {
          "node_type": "STANDARD_STEP",
          "narrative_key": "narrative.prologue.awakening",
          "required_prerequisites": []
        },
        "NODE_BRANCH_EXPLORE": {
          "node_type": "BRANCH_CHOICE",
          "narrative_key": "narrative.prologue.environment",
          "required_prerequisites": ["NODE_AWAKEN_PLAZA"]
        },
        "NODE_TALK_GUARD": {
          "node_type": "STANDARD_STEP",
          "narrative_key": "narrative.prologue.first_encounter",
          "required_prerequisites": ["NODE_BRANCH_EXPLORE"]
        },
        "NODE_DEPART_WORLD": {
          "node_type": "TERMINAL_EXIT",
          "narrative_key": "narrative.prologue.completed",
          "required_prerequisites": ["NODE_TALK_GUARD"]
        }
      },
      "edges": [
        { "from": "NODE_AWAKEN_PLAZA", "to": "NODE_BRANCH_EXPLORE" },
        { "from": "NODE_BRANCH_EXPLORE", "to": "NODE_TALK_GUARD" },
        { "from": "NODE_TALK_GUARD", "to": "NODE_DEPART_WORLD" }
      ]
    },
    "DAG_PROLOGUE_ELF_SANCTUARY": {
      "entry_node_id": "NODE_AWAKEN_GROVE",
      "terminal_node_id": "NODE_DEPART_SANCTUARY",
      "nodes": {
        "NODE_AWAKEN_GROVE": {
          "node_type": "STANDARD_STEP",
          "narrative_key": "narrative.prologue.elf_grove_awaken",
          "required_prerequisites": []
        },
        "NODE_DEPART_SANCTUARY": {
          "node_type": "TERMINAL_EXIT",
          "narrative_key": "narrative.prologue.elf_grove_depart",
          "required_prerequisites": ["NODE_AWAKEN_GROVE"]
        }
      },
      "edges": [
        { "from": "NODE_AWAKEN_GROVE", "to": "NODE_DEPART_SANCTUARY" }
      ]
    }
  }
}
```

---

## 三、 序章 DAG 注册表与装配工厂 (`PrologueDagRegistry`)

```gdscript
class_name PrologueDagRegistry
extends RefCounted

static var _cached_graphs: Dictionary = {}

## 依据角色序章上下文动态匹配并解析专属 DAG
static func resolve_prologue_dag_for_character(ctx: CharacterPrologueContext) -> NarrativeDAGGraphDTO:
	var catalog := GameConfig.get_dict("narratives.prologue_dag_catalog", "dag_graphs", {})
	var routing_rules: Array = GameConfig.get_array("narratives.prologue_dag_catalog", "prologue_routing_rules", [])

	var selected_dag_id: String = ""
	for r in routing_rules:
		var rule := r as Dictionary
		var cond: Dictionary = rule.get("match_condition", {})
		if cond.get("is_default", false):
			if selected_dag_id.is_empty():
				selected_dag_id = str(rule.get("target_dag_id", ""))
		elif cond.has("race_id") and cond["race_id"] == ctx.race_id:
			selected_dag_id = str(rule.get("target_dag_id", ""))
			break

	if selected_dag_id.is_empty() or not catalog.has(selected_dag_id):
		selected_dag_id = "DAG_PROLOGUE_HUMAN_CAPITAL"

	var raw_graph: Dictionary = catalog.get(selected_dag_id, {})
	return _build_graph_from_raw(selected_dag_id, raw_graph)

static func _build_graph_from_raw(dag_id: String, raw: Dictionary) -> NarrativeDAGGraphDTO:
	var g := NarrativeDAGGraphDTO.new()
	g.graph_id = dag_id
	g.entry_node_id = str(raw.get("entry_node_id", ""))
	g.terminal_node_id = str(raw.get("terminal_node_id", ""))

	var raw_nodes: Dictionary = raw.get("nodes", {})
	for nid in raw_nodes.keys():
		var nd_dict: Dictionary = raw_nodes[nid]
		var node := NarrativeDAGNode.new()
		node.node_id = nid
		node.narrative_key = str(nd_dict.get("narrative_key", ""))
		for pre in (nd_dict.get("required_prerequisites", []) as Array):
			node.required_prerequisites.append(str(pre))
		g.add_node(node)

	var raw_edges: Array = raw.get("edges", [])
	for ed in raw_edges:
		var ed_dict := ed as Dictionary
		var edge := NarrativeDAGEdge.new()
		edge.from_node_id = str(ed_dict.get("from", ""))
		edge.to_node_id = str(ed_dict.get("to", ""))
		g.add_edge(edge)

	return g
```

---

## 四、 事件总线广播协同

通过 `NarrativeDagExecutionEngine` 与 `EventBus` 深度互锁：
* 当激活新节点时广播：`EventBus.emit_domain_event("narrative.dag.node_activated", { "dag_id": g.graph_id, "node_id": nid })`；
* 当完成终态退出时广播：`EventBus.emit_domain_event("narrative.dag.completed", { "dag_id": g.graph_id })`，并无缝触发回挂世界网关的 `enter_world()`。

---

## 五、 本阶段交付清单

1. **配置表**：
   - `config/narratives/prologue_dag_catalog.json`
2. **注册表服务**：
   - `backend/domains/narrative_orchestration/prologue_dag_registry.gd`
3. **门禁保障**：
   - 运行 `python scripts/py/audit_config.py --fix` 原位规范化。

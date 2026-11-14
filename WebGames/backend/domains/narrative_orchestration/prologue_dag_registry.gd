# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/narrative_orchestration/prologue_dag_registry.gd
# 架构定位: Domain Registry / Specification Catalog
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/narrative_orchestration.json | 信号: EventBus 领域广播
# 职责说明: 依据角色种族、身世标识及已适配的单机命途 MOD 路由规则，从配置或 MOD 清单加载并装配专属序章剧情 DAG。
# 退出语义与设计依据: 业务域第一性原理 / 架构设计规范
# ==============================================================================

## PrologueDagRegistry：Domain Registry / Specification Catalog
class_name PrologueDagRegistry
extends RefCounted

# ==============================================================================
# 一、序章剧情 DAG 动态路由解析 (Race + Origin + MOD Routing)
# ==============================================================================

## 依据角色种族、身世标识与适配后的 MOD 清单动态匹配并解析专属序章 DAG（无内置默认合成，缺失返回 null）
static func resolve_prologue_dag(
    race_id: String,
    origin_id: String = "",
    adapted_mod_manifest: Dictionary = {}
) -> NarrativeDAGGraphDTO:
    var catalog: Dictionary = GameConfig.get_dict("narratives.prologue_dag_catalog", "dag_graphs", {})
    var manifest: Dictionary = DestinyModManifestDTO.unwrap_adapted_manifest(adapted_mod_manifest)

    var mod_dag_id: String = _resolve_mod_prologue_dag_id(race_id, origin_id, manifest)
    if not mod_dag_id.is_empty():
        return _resolve_declared_dag_graph(mod_dag_id, catalog, manifest)

    var selected_dag_id: String = _resolve_builtin_routing_dag_id(race_id, origin_id)
    if selected_dag_id.is_empty():
        return null
    return _resolve_declared_dag_graph(selected_dag_id, catalog, manifest)

## 按图编号获取已装配的 DAG 实体（复用模型 from_dto 全字段装配）
static func get_graph_by_id(dag_id: String) -> NarrativeDAGGraphDTO:
    var catalog: Dictionary = GameConfig.get_dict("narratives.prologue_dag_catalog", "dag_graphs", {})
    if not catalog.has(dag_id):
        return null

    var raw: Dictionary = catalog.get(dag_id, {})
    return assemble_graph_from_raw(dag_id, raw)

# ==============================================================================
# 二、MOD 路由优先级匹配与内置路由回退内部方法 (CC <= 15, Depth <= 3)
# ==============================================================================

static func _resolve_mod_prologue_dag_id(
    race_id: String,
    origin_id: String,
    manifest: Dictionary
) -> String:
    var clean_origin: String = origin_id.strip_edges()
    var clean_race: String = race_id.strip_edges()

    if manifest.is_empty():
        if not clean_origin.is_empty():
            var builtin_origin: Dictionary = GameConfig.get_dict("domains.character_creation", "origins/" + clean_origin, {})
            return str(builtin_origin.get("prologue_dag_id", "")).strip_edges()
        return ""

    var custom_rules: Array = manifest.get("custom_routing_rules", [])

    # 1. 优先匹配 custom_routing_rules 中的 origin_id 精确规则
    if not clean_origin.is_empty():
        var by_rule_origin: String = _match_rules_by_origin(custom_rules, clean_origin, clean_race)
        if not by_rule_origin.is_empty():
            return by_rule_origin

        # 2. 次取 origins_catalog[origin_id].prologue_dag_id 或 origin_dag_map
        var by_origin_config: String = _lookup_origin_bound_dag_id(clean_origin, manifest)
        if not by_origin_config.is_empty():
            return by_origin_config

    # 3. 再次匹配 custom_routing_rules 中的 race_id 规则或默认规则
    var by_rule_race: String = _match_rules_by_race_or_default(custom_rules, clean_race)
    return by_rule_race

static func _evaluate_routing_rule(
    raw_rule: Variant,
    empty_condition: Dictionary,
    origin_id: String,
    race_id: String,
    should_match_origin_only: bool
) -> Dictionary:
    if not (raw_rule is Dictionary):
        return {}
    var rule: Dictionary = raw_rule
    var condition: Dictionary = rule.get("match_condition", empty_condition)
    var target: String = str(rule.get("target_dag_id", "")).strip_edges()
    if target.is_empty():
        return {}
    if should_match_origin_only:
        var is_origin_matched: bool = condition.has("origin_id") and str(condition.get("origin_id", "")).strip_edges() == origin_id
        var is_race_matched: bool = not condition.has("race_id") or str(condition.get("race_id", "")).strip_edges() == race_id
        return {"kind": "ORIGIN", "target": target} if (is_origin_matched and is_race_matched) else {}
    if condition.has("origin_id"):
        return {}
    if condition.has("race_id") and str(condition.get("race_id", "")).strip_edges() == race_id:
        return {"kind": "RACE", "target": target}
    if bool(condition.get("is_default", false)):
        return {"kind": "DEFAULT", "target": target}
    return {}

static func _match_rules_by_origin(
    rules: Array,
    origin_id: String,
    race_id: String
) -> String:
    var empty_condition: Dictionary = {}
    for rule_entry in rules:
        var matched: Dictionary = _evaluate_routing_rule(rule_entry, empty_condition, origin_id, race_id, true)
        if not matched.is_empty():
            return str(matched["target"])
    return ""

static func _lookup_origin_bound_dag_id(origin_id: String, manifest: Dictionary) -> String:
    var origin_dag_map: Dictionary = manifest.get("origin_dag_map", {})
    if origin_dag_map.has(origin_id):
        var mapped: String = str(origin_dag_map.get(origin_id, "")).strip_edges()
        if not mapped.is_empty():
            return mapped

    var origins_catalog: Dictionary = manifest.get("origins_catalog", manifest.get("origins", {}))
    if origins_catalog.has(origin_id):
        var origin_entry: Variant = origins_catalog.get(origin_id)
        if origin_entry is Dictionary:
            var bound_dag: String = str((origin_entry as Dictionary).get("prologue_dag_id", "")).strip_edges()
            if not bound_dag.is_empty():
                return bound_dag

    var custom_origins: Variant = manifest.get("custom_origins", [])
    if custom_origins is Array:
        for origin_entry in custom_origins as Array:
            if origin_entry is Dictionary and str((origin_entry as Dictionary).get("origin_id", "")).strip_edges() == origin_id:
                return str((origin_entry as Dictionary).get("prologue_dag_id", "")).strip_edges()

    return ""

static func _match_rules_by_race_or_default(rules: Array, race_id: String) -> String:
    var default_dag_id: String = ""
    var empty_condition: Dictionary = {}
    for rule_entry in rules:
        var matched: Dictionary = _evaluate_routing_rule(rule_entry, empty_condition, "", race_id, false)
        if matched.is_empty():
            continue
        if str(matched["kind"]) == "RACE":
            return str(matched["target"])
        if default_dag_id.is_empty():
            default_dag_id = str(matched["target"])
    return default_dag_id

static func _resolve_builtin_routing_dag_id(race_id: String, origin_id: String) -> String:
    var routing_rules: Array = GameConfig.get_array("narratives.prologue_dag_catalog", "prologue_routing_rules", [])
    var selected_dag_id: String = ""
    var empty_condition: Dictionary = {}

    for rule_entry in routing_rules:
        if not (rule_entry is Dictionary):
            continue
        var rule: Dictionary = rule_entry
        var condition: Dictionary = rule.get("match_condition", empty_condition)
        if not origin_id.is_empty() and condition.has("origin_id") and str(condition["origin_id"]) == origin_id:
            return str(rule.get("target_dag_id", ""))
        if bool(condition.get("is_default", false)):
            if selected_dag_id.is_empty():
                selected_dag_id = str(rule.get("target_dag_id", ""))
        elif condition.has("race_id") and str(condition["race_id"]) == race_id:
            selected_dag_id = str(rule.get("target_dag_id", ""))
            break

    return selected_dag_id

static func _resolve_declared_dag_graph(
    dag_id: String,
    catalog: Dictionary,
    manifest: Dictionary
) -> NarrativeDAGGraphDTO:
    var mod_graphs: Dictionary = manifest.get("dag_graphs", manifest.get("custom_dag_graphs", {}))
    if mod_graphs.has(dag_id) and mod_graphs[dag_id] is Dictionary:
        return assemble_graph_from_raw(dag_id, mod_graphs[dag_id] as Dictionary)

    if catalog.has(dag_id) and catalog[dag_id] is Dictionary:
        return assemble_graph_from_raw(dag_id, catalog[dag_id] as Dictionary)

    # Fail-Closed：禁止从模板目录合成未知 DAG，缺失时返回 null 交由上层阻断 (MOD_ERR_MISSING_PROLOGUE_DAG)
    return null

## 从原始叙事配置装配编排事件因果图谱
static func assemble_graph_from_raw(dag_id: String, raw: Dictionary) -> NarrativeDAGGraphDTO:
    var graph := NarrativeDAGGraphDTO.new(dag_id)
    graph.entry_node_id = str(raw.get("entry_node_id", ""))
    graph.terminal_node_id = str(raw.get("terminal_node_id", ""))

    var raw_nodes: Dictionary = raw.get("nodes", {})
    for node_id in raw_nodes.keys():
        _add_single_raw_node(graph, str(node_id), raw_nodes[node_id])

    var raw_edges: Array = raw.get("edges", [])
    for raw_edge in raw_edges:
        _add_single_raw_edge(graph, raw_edge)

    return graph

static func _add_single_raw_node(
    graph: NarrativeDAGGraphDTO,
    node_id: String,
    raw_node: Variant
) -> void:
    if not (raw_node is Dictionary):
        return
    var node := NarrativeDAGNode.from_dto(raw_node as Dictionary)
    if node.node_id.is_empty():
        node.node_id = node_id
    graph.add_node(node)

static func _add_single_raw_edge(graph: NarrativeDAGGraphDTO, raw_edge: Variant) -> void:
    if not (raw_edge is Dictionary):
        return
    var edge := NarrativeDAGEdge.from_dto(raw_edge as Dictionary)
    graph.add_edge(edge)

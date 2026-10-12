# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/narrative_orchestration/prologue_dag_registry.gd
# 架构定位: Domain Registry / Specification Catalog
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/narrative_orchestration.json | 信号: EventBus 领域广播
# 职责说明: 依据角色种族、身世标识及已适配的单机命途 MOD 路由规则，从配置或 MOD 清单加载并装配专属序章剧情 DAG。
# 设计依据: 业务域第一性原理 / 架构设计规范
# ==============================================================================

class_name PrologueDagRegistry
extends RefCounted

# ==============================================================================
# 一、序章剧情 DAG 动态路由解析 (Race + Origin + MOD Routing)
# ==============================================================================

## 依据角色种族、身世标识与适配后的 MOD 清单动态匹配并解析专属序章 DAG
static func resolve_prologue_dag(
    race_id: String,
    origin_id: String = "",
    adapted_mod_manifest: Dictionary = {}
) -> NarrativeDAGGraphDTO:
    var catalog: Dictionary = GameConfig.get_dict("narratives.prologue_dag_catalog", "dag_graphs", {})
    var manifest: Dictionary = _unwrap_adapted_manifest(adapted_mod_manifest)

    var mod_dag_id: String = _resolve_mod_prologue_dag_id(race_id, origin_id, manifest)
    if not mod_dag_id.is_empty():
        return _resolve_or_synthesize_mod_graph(mod_dag_id, catalog, manifest)

    var selected_dag_id: String = _resolve_builtin_routing_dag_id(race_id, origin_id)

    # R4 审查修复：默认 DAG 单一事实源收敛为纯配置 is_default 规则驱动，
    # 移除代码内硬编码 fallback 字面量（配置缺失时返回 null 由上层防御）。
    if selected_dag_id.is_empty() or not catalog.has(selected_dag_id):
        return null

    return get_graph_by_id(selected_dag_id)

## 按图编号获取已装配的 DAG 实体（R3 审查修复：复用模型 from_dto 全字段装配）
static func get_graph_by_id(dag_id: String) -> NarrativeDAGGraphDTO:
    var catalog: Dictionary = GameConfig.get_dict("narratives.prologue_dag_catalog", "dag_graphs", {})
    if not catalog.has(dag_id):
        return null

    var raw: Dictionary = catalog.get(dag_id, {})
    return _assemble_graph_from_raw(dag_id, raw)

# ==============================================================================
# 二、MOD 路由优先级匹配与内置路由回退内部方法 (CC <= 15, Depth <= 3)
# ==============================================================================

static func _unwrap_adapted_manifest(raw_manifest: Dictionary) -> Dictionary:
    if raw_manifest.is_empty():
        return {}
    var inner: Variant = raw_manifest.get("adapted_manifest", null)
    if inner is Dictionary:
        return inner as Dictionary
    return raw_manifest

static func _resolve_mod_prologue_dag_id(
    race_id: String,
    origin_id: String,
    manifest: Dictionary
) -> String:
    var clean_origin: String = origin_id.strip_edges()
    var clean_race: String = race_id.strip_edges()

    if manifest.is_empty():
        if not clean_origin.is_empty():
            var builtin_orig: Dictionary = GameConfig.get_dict("domains.character_creation", "origins/" + clean_origin, {})
            return str(builtin_orig.get("prologue_dag_id", "")).strip_edges()
        return ""

    var custom_rules: Array = manifest.get("custom_routing_rules", [])

    # 1. 优先匹配 custom_routing_rules 中的 origin_id 精确规则
    if not clean_origin.is_empty():
        var by_rule_origin: String = _match_rules_by_origin(custom_rules, clean_origin, clean_race)
        if not by_rule_origin.is_empty():
            return by_rule_origin

        # 2. 次取 origins_catalog[origin_id].prologue_dag_id 或 origin_dag_map
        var by_origin_cfg: String = _lookup_origin_bound_dag_id(clean_origin, manifest)
        if not by_origin_cfg.is_empty():
            return by_origin_cfg

    # 3. 再次匹配 custom_routing_rules 中的 race_id 规则或默认规则
    var by_rule_race: String = _match_rules_by_race_or_default(custom_rules, clean_race)
    return by_rule_race

static func _match_rules_by_origin(
    rules: Array,
    origin_id: String,
    race_id: String
) -> String:
    for r in rules:
        if not (r is Dictionary):
            continue
        var rule: Dictionary = r
        var cond: Dictionary = rule.get("match_condition", {})
        if cond.has("origin_id") and str(cond.get("origin_id", "")).strip_edges() == origin_id:
            if not cond.has("race_id") or str(cond.get("race_id", "")).strip_edges() == race_id:
                var target: String = str(rule.get("target_dag_id", "")).strip_edges()
                if not target.is_empty():
                    return target
    return ""

static func _lookup_origin_bound_dag_id(origin_id: String, manifest: Dictionary) -> String:
    var origin_dag_map: Dictionary = manifest.get("origin_dag_map", {})
    if origin_dag_map.has(origin_id):
        var mapped: String = str(origin_dag_map.get(origin_id, "")).strip_edges()
        if not mapped.is_empty():
            return mapped

    var origins_cat: Dictionary = manifest.get("origins_catalog", manifest.get("origins", {}))
    if origins_cat.has(origin_id):
        var orig_entry: Variant = origins_cat.get(origin_id)
        if orig_entry is Dictionary:
            var bound_dag: String = str((orig_entry as Dictionary).get("prologue_dag_id", "")).strip_edges()
            if not bound_dag.is_empty():
                return bound_dag

    var custom_origins: Variant = manifest.get("custom_origins", [])
    if custom_origins is Array:
        for item in custom_origins as Array:
            if item is Dictionary and str((item as Dictionary).get("origin_id", "")).strip_edges() == origin_id:
                return str((item as Dictionary).get("prologue_dag_id", "")).strip_edges()

    return ""

static func _match_rules_by_race_or_default(rules: Array, race_id: String) -> String:
    var default_dag_id: String = ""
    for r in rules:
        if not (r is Dictionary):
            continue
        var rule: Dictionary = r
        var cond: Dictionary = rule.get("match_condition", {})
        if cond.has("origin_id"):
            continue
        if cond.has("race_id") and str(cond.get("race_id", "")).strip_edges() == race_id:
            var target: String = str(rule.get("target_dag_id", "")).strip_edges()
            if not target.is_empty():
                return target
        elif bool(cond.get("is_default", false)) and default_dag_id.is_empty():
            default_dag_id = str(rule.get("target_dag_id", "")).strip_edges()
    return default_dag_id

static func _resolve_builtin_routing_dag_id(race_id: String, origin_id: String) -> String:
    var routing_rules: Array = GameConfig.get_array("narratives.prologue_dag_catalog", "prologue_routing_rules", [])
    var selected_dag_id: String = ""

    for r in routing_rules:
        if not (r is Dictionary):
            continue
        var rule: Dictionary = r
        var cond: Dictionary = rule.get("match_condition", {})
        if not origin_id.is_empty() and cond.has("origin_id") and str(cond["origin_id"]) == origin_id:
            return str(rule.get("target_dag_id", ""))
        if bool(cond.get("is_default", false)):
            if selected_dag_id.is_empty():
                selected_dag_id = str(rule.get("target_dag_id", ""))
        elif cond.has("race_id") and str(cond["race_id"]) == race_id:
            selected_dag_id = str(rule.get("target_dag_id", ""))
            break

    return selected_dag_id

static func _resolve_or_synthesize_mod_graph(
    dag_id: String,
    builtin_catalog: Dictionary,
    manifest: Dictionary
) -> NarrativeDAGGraphDTO:
    var mod_graphs: Dictionary = manifest.get("dag_graphs", manifest.get("custom_dag_graphs", {}))
    if mod_graphs.has(dag_id) and mod_graphs[dag_id] is Dictionary:
        return _assemble_graph_from_raw(dag_id, mod_graphs[dag_id] as Dictionary)

    if builtin_catalog.has(dag_id):
        return get_graph_by_id(dag_id)

    # 当 MOD 仅声明专属 prologue_dag_id / target_dag_id 时，继承默认模板结构并赋予专属 graph_id
    var template_raw: Dictionary = {}
    for k in builtin_catalog.keys():
        if builtin_catalog[k] is Dictionary:
            template_raw = builtin_catalog[k] as Dictionary
            break
    return _assemble_graph_from_raw(dag_id, template_raw)

static func _assemble_graph_from_raw(dag_id: String, raw: Dictionary) -> NarrativeDAGGraphDTO:
    var g := NarrativeDAGGraphDTO.new(dag_id)
    g.entry_node_id = str(raw.get("entry_node_id", ""))
    g.terminal_node_id = str(raw.get("terminal_node_id", ""))

    var raw_nodes: Dictionary = raw.get("nodes", {})
    for nid in raw_nodes.keys():
        _add_single_raw_node(g, str(nid), raw_nodes[nid])

    var raw_edges: Array = raw.get("edges", [])
    for ed in raw_edges:
        _add_single_raw_edge(g, ed)

    return g

static func _add_single_raw_node(
    g: NarrativeDAGGraphDTO,
    nid: String,
    raw_node: Variant
) -> void:
    if not (raw_node is Dictionary):
        return
    var node := NarrativeDAGNode.from_dto(raw_node as Dictionary)
    if node.node_id.is_empty():
        node.node_id = nid
    g.add_node(node)

static func _add_single_raw_edge(g: NarrativeDAGGraphDTO, raw_edge: Variant) -> void:
    if not (raw_edge is Dictionary):
        return
    var edge := NarrativeDAGEdge.from_dto(raw_edge as Dictionary)
    g.add_edge(edge)

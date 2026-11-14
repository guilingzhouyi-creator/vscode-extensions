# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/character_creation/prologue_dag_step_helper.gd
# 架构定位: Domain Support Helper / Prologue DAG State & Step Packet Assembly
# 依赖与触发: 上游: PrologueExecutionKernel, CharacterCreationProtocolHandler | 下游: PrologueDagRegistry, ProloguePlaceholderResolver | 配置: config/domains/character_creation/core.json | 信号: 无
# 职责说明: 提供序章上下文初始化、DAG 会话恢复、节点有效性校验、终态自动结算、状态包拼装与交接物品收集。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## PrologueDagStepHelper：序章 DAG 状态校验、终态结算与状态载荷拼装辅助器
class_name PrologueDagStepHelper
extends RefCounted


## 构建开局初始 CharacterPrologueContext 实例并绑定 manifest 与 origin 占位符
static func create_initial_prologue_context(
    opening: OpeningEventStreamDTO,
    effective_race: String,
    manifest: Dictionary,
    profile: Variant
) -> CharacterPrologueContext:
    var prologue_context := CharacterPrologueContext.new()
    prologue_context.account_id = opening.account_id
    prologue_context.character_id = opening.character_id
    prologue_context.character_name = opening.character_name
    prologue_context.race_id = effective_race
    prologue_context.assigned_start_location_id = opening.starting_location_id
    prologue_context.assigned_opening_quest_id = opening.opening_quest_line_id
    prologue_context.created_timestamp_utc = int(Time.get_unix_time_from_system())
    prologue_context.is_active = true
    prologue_context.current_stage = 1
    prologue_context.step_index = 0
    prologue_context.active_mod_manifest = manifest.duplicate(true)

    var origin_value := str(opening.narrative_context.get("origin_id", "")).strip_edges()
    if origin_value.is_empty() and profile is CharacterProfile:
        origin_value = str((profile as CharacterProfile).growth_state.get("origin_id", "")).strip_edges()
    prologue_context.origin_id = origin_value
    if not origin_value.is_empty():
        prologue_context.runtime_placeholders["ORIGIN_ID"] = origin_value
        prologue_context.runtime_placeholders["origin_id"] = origin_value
    var kit_override := str(opening.narrative_context.get("starter_kit_id", "")).strip_edges()
    if not kit_override.is_empty():
        prologue_context.assigned_starter_kit_id = kit_override
    return prologue_context


## 确保序章上下文关联可用的 DAG 执行会话（缺失时按需恢复）
static func ensure_context_dag_session(
    prologue_context: CharacterPrologueContext,
    create_session_callback: Callable
) -> NarrativeDagExecutionEngine:
    if prologue_context.active_dag_session is NarrativeDagExecutionEngine:
        return prologue_context.active_dag_session as NarrativeDagExecutionEngine
    var restored := create_session_callback.call(prologue_context, prologue_context.origin_id, prologue_context.active_mod_manifest) as NarrativeDagExecutionEngine
    if restored != null:
        prologue_context.active_dag_session = restored
        prologue_context.current_dag_id = restored.graph.graph_id
    return restored


## 获取当前活跃的第一个 DAG 节点
static func resolve_active_dag_node(dag_session: NarrativeDagExecutionEngine) -> NarrativeDAGNode:
    if dag_session == null or dag_session.graph == null or dag_session.active_node_ids.is_empty():
        return null
    var active_node_id: String = dag_session.active_node_ids[0]
    return dag_session.graph.nodes.get(active_node_id, null) as NarrativeDAGNode


## 判定下一节点是否为可无选项自动结算的终点出口节点
static func should_auto_settle_terminal_node(
    next_node: NarrativeDAGNode,
    dag_session: NarrativeDagExecutionEngine
) -> bool:
    if next_node == null or dag_session == null:
        return false
    if next_node.node_type != NarrativeDAGNode.NodeType.TERMINAL_EXIT:
        return false
    return next_node.choices.is_empty() and dag_session.active_node_ids.size() == 1


## 结算 TERMINAL_EXIT 节点并闭合序章完成标志
static func execute_terminal_exit_node(
    dag_session: NarrativeDagExecutionEngine,
    terminal_node: NarrativeDAGNode,
    step_payload: Dictionary,
    prologue_context: CharacterPrologueContext,
    profile: Variant,
    apply_mutations_callback: Callable
) -> Array[Dictionary]:
    var terminal_execution: Dictionary = dag_session.execute_node_action(terminal_node.node_id, step_payload)
    var extra_mutations: Array[Dictionary] = []
    if bool(terminal_execution.get("success", false)):
        var raw_terminal_mutations: Variant = terminal_execution.get("mutations", terminal_node.mutations_on_complete)
        var terminal_mutations: Array = raw_terminal_mutations if raw_terminal_mutations is Array else []
        extra_mutations = apply_mutations_callback.call(terminal_mutations, prologue_context, profile)
    prologue_context.is_completed = true
    prologue_context.is_active = false
    prologue_context.current_node_id = ""
    return extra_mutations


## 校验所选动作是否满足当前节点的分支可选列表
static func is_dag_choice_valid(active_node: NarrativeDAGNode, choice_id: String) -> bool:
    if active_node == null:
        return false
    if active_node.choices.is_empty():
        return true
    if choice_id.is_empty():
        return false
    for choice_entry in active_node.choices:
        var candidate_id := str(choice_entry.get("choice_id", choice_entry.get("action", choice_entry.get("id", "")))).strip_edges()
        if candidate_id == choice_id:
            return true
    return false


## 构造步进后事件包，兼容常规节点延续与终态文本回退
static func build_post_step_packet(
    prologue_context: CharacterPrologueContext,
    dag_session: NarrativeDagExecutionEngine,
    next_node: NarrativeDAGNode,
    settled_mutations: Array[Dictionary],
    fallback_key: String,
    render_packet_callback: Callable
) -> PrologueEventPacketDTO:
    if next_node != null:
        var next_packet := render_packet_callback.call(
            next_node,
            prologue_context,
            prologue_context.active_mod_manifest,
            prologue_context.step_index
        ) as PrologueEventPacketDTO
        next_packet.reserved_payload["applied_mutations"] = settled_mutations
        next_packet.reserved_payload["is_completed"] = prologue_context.is_completed
        if prologue_context.is_completed:
            next_packet.available_actions = ["ENTER_WORLD"]
        return next_packet

    var custom_i18n: Dictionary = prologue_context.active_mod_manifest.get("custom_i18n", {})
    var resolved_completed_key := fallback_key
    if custom_i18n.has("narrative/prologue/completed"):
        resolved_completed_key = "narrative/prologue/completed"
    elif resolved_completed_key.is_empty():
        resolved_completed_key = "narrative.prologue.completed"
    var completed_text_result := ProloguePlaceholderResolver.resolve_narrative_key(
        resolved_completed_key,
        prologue_context.runtime_placeholders,
        prologue_context.active_mod_manifest,
        ""
    )
    var terminal_packet := PrologueEventPacketDTO.new()
    terminal_packet.account_id = prologue_context.account_id
    terminal_packet.character_id = prologue_context.character_id
    terminal_packet.character_name = prologue_context.character_name
    terminal_packet.current_stage = prologue_context.current_stage
    terminal_packet.step_index = prologue_context.step_index
    terminal_packet.narrative_text = str(completed_text_result.get("text", ""))
    terminal_packet.available_actions = ["ENTER_WORLD"]
    terminal_packet.reserved_payload = {
        "dag_id": dag_session.graph.graph_id if dag_session != null and dag_session.graph != null else "",
        "node_id": "",
        "node_type": NarrativeDAGNode.NodeType.TERMINAL_EXIT,
        "choices": [],
        "cutscene_trigger": "",
        "mutations": settled_mutations,
        "is_completed": true
    }
    return terminal_packet


## 构建当前活跃序章状态供前后端协议/UI视图直接消费
static func build_active_state_payload(
    prologue_context: CharacterPrologueContext,
    create_session_callback: Callable,
    render_packet_callback: Callable
) -> Dictionary:
    if prologue_context == null:
        return {}
    var dag_session := ensure_context_dag_session(prologue_context, create_session_callback)
    var active_node := resolve_active_dag_node(dag_session) if dag_session != null else null
    var packet: PrologueEventPacketDTO
    if active_node != null:
        packet = render_packet_callback.call(active_node, prologue_context, prologue_context.active_mod_manifest, prologue_context.step_index)
    else:
        var empty_mutations: Array[Dictionary] = []
        packet = build_post_step_packet(prologue_context, dag_session, null, empty_mutations, "", render_packet_callback)
    return {
        "character_id": prologue_context.character_id,
        "character_name": prologue_context.character_name,
        "race_id": prologue_context.race_id,
        "origin_id": prologue_context.origin_id,
        "dag_id": str(packet.reserved_payload.get("dag_id", prologue_context.current_dag_id)),
        "node_id": str(packet.reserved_payload.get("node_id", prologue_context.current_node_id)),
        "node_type": int(packet.reserved_payload.get("node_type", NarrativeDAGNode.NodeType.TERMINAL_EXIT if prologue_context.is_completed else NarrativeDAGNode.NodeType.STANDARD_STEP)),
        "current_stage": prologue_context.current_stage,
        "step_index": prologue_context.step_index,
        "is_active": prologue_context.is_active,
        "is_completed": prologue_context.is_completed,
        "narrative_text": packet.narrative_text,
        "choices": packet.reserved_payload.get("choices", []),
        "available_actions": packet.available_actions,
        "cutscene_trigger": str(packet.reserved_payload.get("cutscene_trigger", "")),
        "packet": packet.to_dto()
    }

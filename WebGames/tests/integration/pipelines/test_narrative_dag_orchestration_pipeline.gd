# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - Phase 50: 通用剧情因果 DAG 编排与多角色差异化序章测试套件
# 文件路径: res://tests/integration/pipelines/test_narrative_dag_orchestration_pipeline.gd
# 职责: 验证 DAG 静态拓扑排序、循环依赖环拦截、汇聚等待、条件分支、多角色路由与全生命周期闭环
# ==============================================================================
class_name TestNarrativeDagOrchestrationPipeline
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	results.append(_test_dag_topological_sort_validity())
	results.append(_test_dag_cycle_detection_guard())
	results.append(_test_convergence_join_synchronization())
	results.append(_test_conditional_branching_path())
	results.append(_test_multi_race_dag_routing())
	results.append(_test_full_lifecycle_creation_to_dag_completion())
	# 审查修复闭环：R1 权重仲裁单选 + R2 悬挂告警
	results.append(_test_branch_arbitration_and_hanging_detection())
	# 审查修复闭环：R3 全字段装配 + R4 路由单源 + O1 校验守卫
	results.append(_test_registry_full_assembly_and_validator_guards())

	var passed_count := 0
	for r in results:
		if bool(r.get("passed", false)):
			passed_count += 1

	return {
		"domain": "Phase 50: 通用剧情因果 DAG 编排与多角色差异化序章",
		"all_passed": passed_count == results.size(),
		"total": results.size(),
		"passed": passed_count,
		"results": results
	}

## TC-DAG-01: DAG 静态拓扑排序与结构合法性
static func _test_dag_topological_sort_validity() -> Dictionary:
	var g := NarrativeDAGGraphDTO.new("TEST_GRAPH_VALID")
	g.entry_node_id = "N1"
	g.terminal_node_id = "N3"

	var n1 := NarrativeDAGNode.new("N1", NarrativeDAGNode.NodeType.START_ENTRY, "key.n1")
	var n2 := NarrativeDAGNode.new("N2", NarrativeDAGNode.NodeType.STANDARD_STEP, "key.n2")
	var n3 := NarrativeDAGNode.new("N3", NarrativeDAGNode.NodeType.TERMINAL_EXIT, "key.n3")
	g.add_node(n1)
	g.add_node(n2)
	g.add_node(n3)

	g.add_edge(NarrativeDAGEdge.new("N1", "N2"))
	g.add_edge(NarrativeDAGEdge.new("N2", "N3"))

	var res := CausalityDagValidator.validate_graph(g)
	var passed: bool = bool(res.get("is_valid", false)) and int(res.get("sorted_node_count", 0)) == 3
	return { "test": "TC-DAG-01: DAG 静态拓扑排序与结构合法性", "passed": passed }

## TC-DAG-02: 拓扑环依赖与死锁环 100% 拦截
static func _test_dag_cycle_detection_guard() -> Dictionary:
	var g := NarrativeDAGGraphDTO.new("TEST_GRAPH_CYCLIC")
	g.entry_node_id = "A"
	g.terminal_node_id = "C"

	var na := NarrativeDAGNode.new("A", NarrativeDAGNode.NodeType.START_ENTRY)
	var nb := NarrativeDAGNode.new("B", NarrativeDAGNode.NodeType.STANDARD_STEP)
	var nc := NarrativeDAGNode.new("C", NarrativeDAGNode.NodeType.STANDARD_STEP)
	g.add_node(na)
	g.add_node(nb)
	g.add_node(nc)

	# 构造恶意循环依赖: A -> B -> C -> A
	g.add_edge(NarrativeDAGEdge.new("A", "B"))
	g.add_edge(NarrativeDAGEdge.new("B", "C"))
	g.add_edge(NarrativeDAGEdge.new("C", "A"))

	var res := CausalityDagValidator.validate_graph(g)
	var is_valid: bool = bool(res.get("is_valid", false))
	var error_code: String = str(res.get("error_code", ""))

	var passed: bool = (not is_valid) and (error_code == "CYCLE_DETECTED")
	return { "test": "TC-DAG-02: 拓扑环依赖与死锁环 100% 拦截", "passed": passed }

## TC-DAG-03: 汇聚节点依赖等待与条件同步激活
static func _test_convergence_join_synchronization() -> Dictionary:
	var g := NarrativeDAGGraphDTO.new("TEST_GRAPH_JOIN")
	g.entry_node_id = "START"
	g.terminal_node_id = "JOIN"

	var n_start := NarrativeDAGNode.new("START", NarrativeDAGNode.NodeType.PARALLEL_FORK)
	var n_left := NarrativeDAGNode.new("BRANCH_L", NarrativeDAGNode.NodeType.STANDARD_STEP)
	var n_right := NarrativeDAGNode.new("BRANCH_R", NarrativeDAGNode.NodeType.STANDARD_STEP)
	var n_join := NarrativeDAGNode.new("JOIN", NarrativeDAGNode.NodeType.TERMINAL_EXIT)
	n_join.required_prerequisites = ["BRANCH_L", "BRANCH_R"]

	g.add_node(n_start)
	g.add_node(n_left)
	g.add_node(n_right)
	g.add_node(n_join)

	g.add_edge(NarrativeDAGEdge.new("START", "BRANCH_L"))
	g.add_edge(NarrativeDAGEdge.new("START", "BRANCH_R"))
	g.add_edge(NarrativeDAGEdge.new("BRANCH_L", "JOIN"))
	g.add_edge(NarrativeDAGEdge.new("BRANCH_R", "JOIN"))

	var engine := NarrativeDagExecutionEngine.new()
	var init_res := engine.initialize_with_graph(g)
	if not init_res.get("success", false):
		return { "test": "TC-DAG-03: 汇聚节点依赖等待与条件同步激活", "passed": false }

	# 1. 推进 START -> 派生 BRANCH_L 与 BRANCH_R 均处于激活态
	var step1 := engine.execute_node_action("START")
	var active1: Array = step1.get("active_nodes", [])
	var parallel_ok: bool = active1.has("BRANCH_L") and active1.has("BRANCH_R") and not active1.has("JOIN")

	# 2. 仅推进 BRANCH_L -> JOIN 仍缺 BRANCH_R，不可激活
	var step2 := engine.execute_node_action("BRANCH_L")
	var active2: Array = step2.get("active_nodes", [])
	var wait_ok: bool = active2.has("BRANCH_R") and not active2.has("JOIN")

	# 3. 推进 BRANCH_R -> 汇聚前置全部就绪，JOIN 节点激活
	var step3 := engine.execute_node_action("BRANCH_R")
	var active3: Array = step3.get("active_nodes", [])
	var join_activated: bool = active3.has("JOIN")

	# 4. 执行 JOIN -> 终态完结
	var step4 := engine.execute_node_action("JOIN")
	var completed: bool = engine.is_terminated and step4.get("status", "") == "TERMINATED"

	var passed: bool = parallel_ok and wait_ok and join_activated and completed
	return { "test": "TC-DAG-03: 汇聚节点依赖等待与条件同步激活", "passed": passed }

## TC-DAG-04: 条件分支动态选择与路径分流
static func _test_conditional_branching_path() -> Dictionary:
	var g := NarrativeDAGGraphDTO.new("TEST_GRAPH_BRANCH")
	g.entry_node_id = "CHOICE_NODE"
	g.terminal_node_id = "TERMINAL"

	var n_choice := NarrativeDAGNode.new("CHOICE_NODE", NarrativeDAGNode.NodeType.BRANCH_CHOICE)
	var n_path_a := NarrativeDAGNode.new("PATH_A", NarrativeDAGNode.NodeType.STANDARD_STEP)
	var n_path_b := NarrativeDAGNode.new("PATH_B", NarrativeDAGNode.NodeType.STANDARD_STEP)
	var n_term := NarrativeDAGNode.new("TERMINAL", NarrativeDAGNode.NodeType.TERMINAL_EXIT)

	g.add_node(n_choice)
	g.add_node(n_path_a)
	g.add_node(n_path_b)
	g.add_node(n_term)

	# 条件分支: 选 OPTION_A 走 PATH_A, 选 OPTION_B 走 PATH_B
	g.add_edge(NarrativeDAGEdge.new("CHOICE_NODE", "PATH_A", { "kind": "CHOICE_MATCH", "val": "OPTION_A" }))
	g.add_edge(NarrativeDAGEdge.new("CHOICE_NODE", "PATH_B", { "kind": "CHOICE_MATCH", "val": "OPTION_B" }))
	g.add_edge(NarrativeDAGEdge.new("PATH_A", "TERMINAL"))
	g.add_edge(NarrativeDAGEdge.new("PATH_B", "TERMINAL"))

	var engine := NarrativeDagExecutionEngine.new()
	engine.initialize_with_graph(g)

	# 传入动作载荷: 选择了 OPTION_B
	var step := engine.execute_node_action("CHOICE_NODE", { "selected_choice": "OPTION_B" })
	var active_nodes: Array = step.get("active_nodes", [])

	var passed: bool = active_nodes.has("PATH_B") and (not active_nodes.has("PATH_A"))
	return { "test": "TC-DAG-04: 条件分支动态选择与路径分流", "passed": passed }

## TC-DAG-05: 角色种族差异化序章配置路由
static func _test_multi_race_dag_routing() -> Dictionary:
	var elf_dag := PrologueDagRegistry.resolve_prologue_dag("ELF")
	var human_dag := PrologueDagRegistry.resolve_prologue_dag("HUMAN")
	var unknown_dag := PrologueDagRegistry.resolve_prologue_dag("UNKNOWN_RACE")

	var elf_ok: bool = (elf_dag != null) and (elf_dag.graph_id == "DAG_PROLOGUE_ELF_SANCTUARY") \
		and (elf_dag.entry_node_id == "NODE_AWAKEN_GROVE")
	var human_ok: bool = (human_dag != null) and (human_dag.graph_id == "DAG_PROLOGUE_HUMAN_CAPITAL") \
		and (human_dag.entry_node_id == "NODE_AWAKEN_PLAZA")
	var fallback_ok: bool = (unknown_dag != null) and (unknown_dag.graph_id == "DAG_PROLOGUE_HUMAN_CAPITAL")

	var passed: bool = elf_ok and human_ok and fallback_ok
	return { "test": "TC-DAG-05: 角色种族差异化序章配置路由", "passed": passed }

## TC-DAG-06: 创角到序章 DAG 完结全生命周期闭环
static func _test_full_lifecycle_creation_to_dag_completion() -> Dictionary:
	var dag := PrologueDagRegistry.get_graph_by_id("DAG_PROLOGUE_HUMAN_CAPITAL")
	if dag == null:
		return { "test": "TC-DAG-06: 创角到序章 DAG 完结全生命周期闭环", "passed": false }

	var bus := EventBusCore.get_instance()
	var seen_events: Array[String] = []
	var on_domain_event = func(pkt: EventPacket) -> void:
		var w: Dictionary = pkt.payload_data if pkt.payload_data is Dictionary else {}
		seen_events.append(str(w.get("channel", "")))

	var tok := bus.on_channel(EventChannelDefinition.DOMAIN_EVENT_GENERIC, on_domain_event)

	var engine := NarrativeDagExecutionEngine.new()
	var init_res := engine.initialize_with_graph(dag, { "character_name": "艾隆" })
	var init_ok: bool = bool(init_res.get("success", false))

	# 依次推进: NODE_AWAKEN_PLAZA -> NODE_BRANCH_EXPLORE -> NODE_TALK_GUARD -> NODE_DEPART_WORLD
	var s1 := engine.execute_node_action("NODE_AWAKEN_PLAZA")
	var s2 := engine.execute_node_action("NODE_BRANCH_EXPLORE")
	var s3 := engine.execute_node_action("NODE_TALK_GUARD")
	var s4 := engine.execute_node_action("NODE_DEPART_WORLD")

	tok.unbind()

	var completed_ok: bool = engine.is_terminated and s4.get("status", "") == "TERMINATED"
	var events_ok: bool = seen_events.has("narrative.dag.node_activated") \
		and seen_events.has("narrative.dag.node_completed") \
		and seen_events.has("narrative.dag.completed")

	var passed: bool = init_ok and s1.get("success", false) and s2.get("success", false) \
		and s3.get("success", false) and completed_ok and events_ok
	return { "test": "TC-DAG-06: 创角到序章 DAG 完结全生命周期闭环", "passed": passed }


## TC-DAG-07: 审查修复 R1 分支权重仲裁单选 + R2 悬挂死路显式告警
static func _test_branch_arbitration_and_hanging_detection() -> Dictionary:
	# --- R1 场景：BRANCH_CHOICE 两条重叠无条件出边（低权重在前）---
	var g := NarrativeDAGGraphDTO.new("TEST_GRAPH_ARBITRATION")
	g.entry_node_id = "CH"
	g.terminal_node_id = "TERM_HIGH"
	var n_ch := NarrativeDAGNode.new("CH", NarrativeDAGNode.NodeType.BRANCH_CHOICE)
	var n_low := NarrativeDAGNode.new("PATH_LOW", NarrativeDAGNode.NodeType.STANDARD_STEP)
	var n_high := NarrativeDAGNode.new("PATH_HIGH", NarrativeDAGNode.NodeType.STANDARD_STEP)
	var n_term_high := NarrativeDAGNode.new("TERM_HIGH", NarrativeDAGNode.NodeType.TERMINAL_EXIT)
	g.add_node(n_ch)
	g.add_node(n_low)
	g.add_node(n_high)
	g.add_node(n_term_high)
	# 两条边条件均为空（重叠命中）：低权 10 在前、高权 90 在后
	g.add_edge(NarrativeDAGEdge.new("CH", "PATH_LOW", {}, 10))
	g.add_edge(NarrativeDAGEdge.new("CH", "PATH_HIGH", {}, 90))
	g.add_edge(NarrativeDAGEdge.new("PATH_LOW", "TERM_HIGH"))
	g.add_edge(NarrativeDAGEdge.new("PATH_HIGH", "TERM_HIGH"))

	var engine := NarrativeDagExecutionEngine.new()
	var init_r := engine.initialize_with_graph(g)
	var step := engine.execute_node_action("CH")
	var active: Array = step.get("active_nodes", [])
	var arbitration_ok: bool = bool(init_r.get("success", false)) \
		and active.has("PATH_HIGH") and (not active.has("PATH_LOW"))

	# --- R2 场景：运行时条件致下游零激活且非终态 → 悬挂显式告警 ---
	# （图静态可达通过 O1 校验；执行时不满足分支条件 → 无路可走 → HANGING）
	var g2 := NarrativeDAGGraphDTO.new("TEST_GRAPH_HANGING")
	g2.entry_node_id = "START"
	g2.terminal_node_id = "TERM"
	var n_start := NarrativeDAGNode.new("START", NarrativeDAGNode.NodeType.STANDARD_STEP)
	var n_dead := NarrativeDAGNode.new("CH_DEAD", NarrativeDAGNode.NodeType.BRANCH_CHOICE)
	var n_term := NarrativeDAGNode.new("TERM", NarrativeDAGNode.NodeType.TERMINAL_EXIT)
	g2.add_node(n_start)
	g2.add_node(n_dead)
	g2.add_node(n_term)
	g2.add_edge(NarrativeDAGEdge.new("START", "CH_DEAD"))
	# CH_DEAD 出边需 CHOICE_MATCH=REQUIRED_CHOICE；执行时不提供 → 零激活 → 悬挂
	g2.add_edge(NarrativeDAGEdge.new("CH_DEAD", "TERM", { "kind": "CHOICE_MATCH", "val": "REQUIRED_CHOICE" }))
	var engine2 := NarrativeDagExecutionEngine.new()
	var init2 := engine2.initialize_with_graph(g2)
	var s1 := engine2.execute_node_action("START")
	var s2 := engine2.execute_node_action("CH_DEAD")
	var hanging_ok: bool = bool(init2.get("success", false)) \
		and (not s2.get("success", true)) \
		and s2.get("error_code", "") == "HANGING_NO_EXIT"

	var passed := arbitration_ok and hanging_ok
	return { "test": "TC-DAG-07: 分支权重仲裁单选防重叠 + 悬挂死路显式告警", "passed": passed }


## TC-DAG-08: 审查修复 R3 全字段装配 + R4 路由配置单源 + O1 校验守卫
static func _test_registry_full_assembly_and_validator_guards() -> Dictionary:
	# --- R3：registry 全字段装配（mutations_on_complete 从配置词条装配生效）---
	var human_dag := PrologueDagRegistry.get_graph_by_id("DAG_PROLOGUE_HUMAN_CAPITAL")
	var term_node: NarrativeDAGNode = null
	if human_dag != null:
		term_node = human_dag.nodes.get(human_dag.terminal_node_id, null)
	var mutations: Array = []
	if term_node != null:
		mutations = term_node.mutations_on_complete
	var assembly_ok: bool = human_dag != null and term_node != null \
		and not mutations.is_empty() \
		and str(mutations[0].get("type", "")) == "PrologueCompleted"

	# --- R4：默认 DAG 由配置 is_default 规则驱动（未知种族回退 HUMAN_CAPITAL）---
	var unknown_dag := PrologueDagRegistry.resolve_prologue_dag("UNKNOWN_RACE")
	var routing_ok: bool = unknown_dag != null and unknown_dag.graph_id == "DAG_PROLOGUE_HUMAN_CAPITAL"

	# --- O1：终态缺失 + 不可达非可选节点分别被校验器拦截 ---
	var g_bad_term := NarrativeDAGGraphDTO.new("TEST_BAD_TERMINAL")
	g_bad_term.entry_node_id = "A"
	g_bad_term.terminal_node_id = "GHOST"  # 声明的终态不存在于图中
	var n_a := NarrativeDAGNode.new("A", NarrativeDAGNode.NodeType.START_ENTRY)
	g_bad_term.add_node(n_a)
	var bad_term_res := CausalityDagValidator.validate_graph(g_bad_term)
	var o1_term_ok: bool = (not bad_term_res.get("is_valid", true)) \
		and bad_term_res.get("error_code", "") == "INVALID_TERMINAL_NODE"

	var g_iso := NarrativeDAGGraphDTO.new("TEST_ISOLATED")
	g_iso.entry_node_id = "A"
	g_iso.terminal_node_id = "B"
	var n_iso_a := NarrativeDAGNode.new("A", NarrativeDAGNode.NodeType.START_ENTRY)
	var n_iso_b := NarrativeDAGNode.new("B", NarrativeDAGNode.NodeType.TERMINAL_EXIT)
	var n_iso_c := NarrativeDAGNode.new("C", NarrativeDAGNode.NodeType.STANDARD_STEP)  # 孤立不可达
	g_iso.add_node(n_iso_a)
	g_iso.add_node(n_iso_b)
	g_iso.add_node(n_iso_c)
	g_iso.add_edge(NarrativeDAGEdge.new("A", "B"))
	var iso_res := CausalityDagValidator.validate_graph(g_iso)
	var o1_reach_ok: bool = (not iso_res.get("is_valid", true)) \
		and iso_res.get("error_code", "") == "UNREACHABLE_NODE"

	var passed := assembly_ok and routing_ok and o1_term_ok and o1_reach_ok
	return { "test": "TC-DAG-08: registry 全字段装配 + 路由配置单源 + 校验器守卫", "passed": passed }

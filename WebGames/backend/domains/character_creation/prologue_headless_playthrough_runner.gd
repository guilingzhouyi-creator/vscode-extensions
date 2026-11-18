# ==============================================================================
# 模块归属: 业务领域层 (Domains · 角色创建集群 (Character Creation))
# 文件路径: res://backend/domains/character_creation/prologue_headless_playthrough_runner.gd
# 架构定位: Domain Logic Component / Headless Mod Playthrough Loop & Transcript Builder
# 依赖与触发: 上游: PrologueExecutionKernel | 下游: ModPackageDiscoverySolver, NarrativeDagExecutionEngine, PrologueEventPacketDTO | 配置: 无直读 | 信号: 无
# 职责说明: 承担无头全流程 MOD 试玩仿真的候选包加载、DAG 节点步进循环执行、突变汇总与标准回放报告组装。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## PrologueHeadlessPlaythroughRunner：Domain Logic Component / Headless Playthrough Loop Runner
class_name PrologueHeadlessPlaythroughRunner
extends RefCounted

const MAX_HEADLESS_DAG_STEPS: int = 100


## 解析无头试玩的候选 MOD 包列表（支持内联 candidate_packs 与磁盘目录扫描）
static func prepare_headless_candidates(config: Dictionary) -> Array:
	var candidates: Array = config.get("candidate_packs", []).duplicate()
	var mod_directories: Array = config.get("mod_dirs", [])
	if candidates.is_empty() and not mod_directories.is_empty():
		for mod_directory in mod_directories:
			var loaded_package: Dictionary = ModPackageDiscoverySolver.load_full_mod_package_from_dir(str(mod_directory))
			if not loaded_package.is_empty():
				candidates.append(loaded_package)
	return candidates


## 按有界步数上限推进无头试玩 DAG 会话循环并记录每步报告
static func run_headless_loop(
	engine: NarrativeDagExecutionEngine,
	loop_state: Dictionary,
	transcript_steps: Array[Dictionary],
	render_packet_callable: Callable,
	apply_mutations_callable: Callable
) -> void:
	var step_guard: int = 0
	while not engine.active_node_ids.is_empty() and not engine.is_terminated and step_guard < MAX_HEADLESS_DAG_STEPS:
		step_guard += 1
		var current_node_id: String = engine.active_node_ids[0]
		var node: NarrativeDAGNode = engine.graph.nodes.get(current_node_id)
		if node == null:
			break
		loop_state["step_index"] = transcript_steps.size()
		transcript_steps.append(_step_headless_node(engine, current_node_id, node, loop_state, render_packet_callable, apply_mutations_callable))


## 组装无头全流程 MOD 试玩标准报告信封
static func build_headless_transcript(
	character_name: String,
	effective_race: String,
	effective_origin: String,
	reincarnation_result: Dictionary,
	profile: CharacterProfile,
	engine: NarrativeDagExecutionEngine,
	prologue_context: CharacterPrologueContext,
	transcript_steps: Array[Dictionary]
) -> Dictionary:
	var all_mutations: Array = _collect_applied_mutations(transcript_steps)

	var last_visited: String = ""
	if not engine.completed_node_ids.is_empty():
		last_visited = engine.completed_node_ids[-1]

	var initial_gold: int = int(reincarnation_result.get("initial_gold", profile.personal_resources.get("gold", 50)))
	var starter_kit_id: String = str(reincarnation_result.get("starter_kit_id", prologue_context.assigned_starter_kit_id))
	profile.personal_resources["gold"] = initial_gold

	return {
		"schema_version": "kalar.mod_sdk.playthrough_transcript.v1",
		"is_success": true,
		"character_sheet": {
			"character_name": character_name,
			"race_id": effective_race,
			"origin_id": effective_origin,
			"origin_name": str(reincarnation_result.get("origin_name", effective_origin)),
			"attributes": profile.attributes.duplicate(true),
			"wallet": profile.personal_resources.duplicate(true),
			"inventory": profile.inventory.duplicate(true),
			"equipment": profile.equipment.duplicate(true),
			"selected_traits": (reincarnation_result.get("selected_traits", []) as Array).duplicate(),
			"initial_gold": initial_gold,
			"starter_kit_id": starter_kit_id,
			"starter_kit_name": str(reincarnation_result.get("starter_kit_name", starter_kit_id))
		},
		"dag_routing": {
			"target_dag_id": engine.graph.graph_id,
			"dag_id": engine.graph.graph_id,
			"origin_id": effective_origin,
			"race_id": effective_race
		},
		"transcript_steps": transcript_steps,
		"final_state": {
			"is_completed": prologue_context.is_completed,
			"prologue_completed": prologue_context.is_completed,
			"reached_terminal": engine.is_terminated or prologue_context.is_completed,
			"terminal_node_id": last_visited,
			"completed_node_ids": engine.completed_node_ids.duplicate(),
			"active_node_ids": engine.active_node_ids.duplicate(),
			"is_terminated": engine.is_terminated,
			"applied_mutations": all_mutations
		}
	}


static func _step_headless_node(
	engine: NarrativeDagExecutionEngine,
	current_node_id: String,
	node: NarrativeDAGNode,
	loop_state: Dictionary,
	render_packet_callable: Callable,
	apply_mutations_callable: Callable
) -> Dictionary:
	var step_index: int = int(loop_state["step_index"])
	var prologue_context: CharacterPrologueContext = loop_state["ctx"]
	var profile: CharacterProfile = loop_state["profile"]
	var adapted_manifest: Dictionary = loop_state["manifest"]
	var choice_indices: Array = loop_state["choice_indices"]

	var raw_packet: Variant = render_packet_callable.call(node, prologue_context, adapted_manifest, step_index)
	var packet_dto: Dictionary = (raw_packet as PrologueEventPacketDTO).to_dto() if raw_packet is PrologueEventPacketDTO else {}

	var action_payload: Dictionary = {}
	if not node.choices.is_empty():
		var choice_index: int = 0
		var choice_pointer: int = int(loop_state["choice_ptr"])
		if choice_pointer < choice_indices.size():
			choice_index = clampi(int(choice_indices[choice_pointer]), 0, node.choices.size() - 1)
			loop_state["choice_ptr"] = choice_pointer + 1
		var chosen: Dictionary = node.choices[choice_index]
		action_payload["selected_choice"] = chosen.get("choice_id", str(choice_index))

	var step_result: Dictionary = engine.execute_node_action(current_node_id, action_payload)
	var raw_mutations: Variant = step_result.get("mutations")
	var mutations: Array = raw_mutations if raw_mutations is Array else node.mutations_on_complete
	var raw_applied: Variant = apply_mutations_callable.call(mutations, prologue_context, profile)
	var applied: Array = raw_applied as Array if raw_applied is Array else []

	return {
		"step_index": step_index,
		"node_id": current_node_id,
		"packet": packet_dto,
		"action_payload": action_payload,
		"applied_mutations": applied,
		"step_result": step_result
	}


static func _collect_applied_mutations(transcript_steps: Array[Dictionary]) -> Array:
	var all_mutations: Array = []
	for step_entry in transcript_steps:
		var raw_mutations: Variant = step_entry.get("applied_mutations")
		if raw_mutations is Array:
			all_mutations.append_array(raw_mutations as Array)
	return all_mutations

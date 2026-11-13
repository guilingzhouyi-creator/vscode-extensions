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
	var mod_dirs: Array = config.get("mod_dirs", [])
	if candidates.is_empty() and not mod_dirs.is_empty():
		for d in mod_dirs:
			var pkg: Dictionary = ModPackageDiscoverySolver.load_full_mod_package_from_dir(str(d))
			if not pkg.is_empty():
				candidates.append(pkg)
	return candidates


## 按有界步数上限推进无头试玩 DAG 会话循环并记录每步报告
static func run_headless_loop(
	engine: NarrativeDagExecutionEngine,
	loop_state: Dictionary,
	transcript_steps: Array[Dictionary],
	render_packet_fn: Callable,
	apply_muts_fn: Callable
) -> void:
	var step_guard: int = 0
	while not engine.active_node_ids.is_empty() and not engine.is_terminated and step_guard < MAX_HEADLESS_DAG_STEPS:
		step_guard += 1
		var curr_nid: String = engine.active_node_ids[0]
		var node: NarrativeDAGNode = engine.graph.nodes.get(curr_nid)
		if node == null:
			break
		loop_state["step_index"] = transcript_steps.size()
		transcript_steps.append(_step_headless_node(engine, curr_nid, node, loop_state, render_packet_fn, apply_muts_fn))


## 组装无头全流程 MOD 试玩标准报告信封
static func build_headless_transcript(
	char_name: String,
	eff_race: String,
	eff_origin: String,
	reinc_res: Dictionary,
	profile: CharacterProfile,
	engine: NarrativeDagExecutionEngine,
	ctx: CharacterPrologueContext,
	transcript_steps: Array[Dictionary]
) -> Dictionary:
	var all_mutations: Array = _collect_applied_mutations(transcript_steps)

	var last_visited: String = ""
	if not engine.completed_node_ids.is_empty():
		last_visited = engine.completed_node_ids[-1]

	var init_gold: int = int(reinc_res.get("initial_gold", profile.personal_resources.get("gold", 50)))
	var starter_kit_id: String = str(reinc_res.get("starter_kit_id", ctx.assigned_starter_kit_id))
	profile.personal_resources["gold"] = init_gold

	return {
		"schema_version": "kalar.mod_sdk.playthrough_transcript.v1",
		"is_success": true,
		"character_sheet": {
			"character_name": char_name,
			"race_id": eff_race,
			"origin_id": eff_origin,
			"origin_name": str(reinc_res.get("origin_name", eff_origin)),
			"attributes": profile.attributes.duplicate(true),
			"wallet": profile.personal_resources.duplicate(true),
			"inventory": profile.inventory.duplicate(true),
			"equipment": profile.equipment.duplicate(true),
			"selected_traits": (reinc_res.get("selected_traits", []) as Array).duplicate(),
			"initial_gold": init_gold,
			"starter_kit_id": starter_kit_id,
			"starter_kit_name": str(reinc_res.get("starter_kit_name", starter_kit_id))
		},
		"dag_routing": {
			"target_dag_id": engine.graph.graph_id,
			"dag_id": engine.graph.graph_id,
			"origin_id": eff_origin,
			"race_id": eff_race
		},
		"transcript_steps": transcript_steps,
		"final_state": {
			"is_completed": ctx.is_completed,
			"prologue_completed": ctx.is_completed,
			"reached_terminal": engine.is_terminated or ctx.is_completed,
			"terminal_node_id": last_visited,
			"completed_node_ids": engine.completed_node_ids.duplicate(),
			"active_node_ids": engine.active_node_ids.duplicate(),
			"is_terminated": engine.is_terminated,
			"applied_mutations": all_mutations
		}
	}


static func _step_headless_node(
	engine: NarrativeDagExecutionEngine,
	curr_nid: String,
	node: NarrativeDAGNode,
	loop_state: Dictionary,
	render_packet_fn: Callable,
	apply_muts_fn: Callable
) -> Dictionary:
	var step_index: int = int(loop_state["step_index"])
	var ctx: CharacterPrologueContext = loop_state["ctx"]
	var profile: CharacterProfile = loop_state["profile"]
	var adapted_manifest: Dictionary = loop_state["manifest"]
	var choice_indices: Array = loop_state["choice_indices"]

	var raw_packet: Variant = render_packet_fn.call(node, ctx, adapted_manifest, step_index)
	var packet_dto: Dictionary = (raw_packet as PrologueEventPacketDTO).to_dto() if raw_packet is PrologueEventPacketDTO else {}

	var action_payload: Dictionary = {}
	if not node.choices.is_empty():
		var c_idx: int = 0
		var ptr: int = int(loop_state["choice_ptr"])
		if ptr < choice_indices.size():
			c_idx = clampi(int(choice_indices[ptr]), 0, node.choices.size() - 1)
			loop_state["choice_ptr"] = ptr + 1
		var chosen: Dictionary = node.choices[c_idx]
		action_payload["selected_choice"] = chosen.get("choice_id", chosen.get("id", str(c_idx)))

	var step_res: Dictionary = engine.execute_node_action(curr_nid, action_payload)
	var raw_muts: Variant = step_res.get("mutations")
	var mutations: Array = raw_muts if raw_muts is Array else node.mutations_on_complete
	var raw_applied: Variant = apply_muts_fn.call(mutations, ctx, profile)
	var applied: Array = raw_applied as Array if raw_applied is Array else []

	return {
		"step_index": step_index,
		"node_id": curr_nid,
		"packet": packet_dto,
		"action_payload": action_payload,
		"applied_mutations": applied,
		"step_result": step_res
	}


static func _collect_applied_mutations(transcript_steps: Array[Dictionary]) -> Array:
	var all_mutations: Array = []
	for step_entry in transcript_steps:
		var raw_muts: Variant = step_entry.get("applied_mutations")
		if raw_muts is Array:
			all_mutations.append_array(raw_muts as Array)
	return all_mutations

# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/character_creation/prologue_execution_kernel.gd
# 架构定位: Domain Logic Component
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/character_creation.json | 信号: EventBus 领域广播
# 职责说明: 承接 OpeningEventStreamDTO 编排角色专属序章启动：构建上下文、 提取并缓存初始占位符、发放新手装备、推进四阶段剧情状态跃迁、生成结构化突变事件流 （CharacterCreated / LocationAssigned / EquipmentGranted / DialogueReady / PrologueCompleted） 与首步/后继事件包。事件与状态解耦——仅产出纯结构化结果，不指示前端页面。 无缝衔接 通用因果 DAG 编排引擎会话。 关联细则: 阶段2 §四（序章执行内核与状态解耦）与 协作契约
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## PrologueExecutionKernel：Domain Logic Component
class_name PrologueExecutionKernel
extends RefCounted

# ==============================================================================
# 一、启动编排（开局事件流 → 序章上下文 + 首步事件包）
# ==============================================================================

## 启动角色序章，产出初始化结构化事件流。
## 契约：opening 为空或 character_id 为空返回 INVALID_OPENING；种族默认经
##       config 键 defaults/default_race_id 驱动（既有键）；内部顺序执行
##       上下文构建 → 占位符提取 → 新手套件发放 → 突变事件列表 → 首步事件包。
static func boot_character_prologue(opening: OpeningEventStreamDTO, race_id: String = "", allow_default_fallback: bool = true) -> Dictionary:
	if opening == null or opening.character_id.is_empty():
		return {"success": false, "error_code": "INVALID_OPENING", "message": "开局事件包缺失或角色 ID 为空"}

	var effective_race := race_id if not race_id.is_empty() else opening.race_id
	if effective_race.is_empty() or effective_race == "UNBOUND":
		if not allow_default_fallback:
			return {"success": false, "error_code": "UNBOUND_RACE_ID", "unwired_slot": "race_id", "message": "种族标识未接线(UNBOUND)，禁止静默回退默认种族"}
		effective_race = GameConfig.get_string("domains.character_creation", "defaults/default_race_id", "HUMAN")

	var ctx := CharacterPrologueContext.new()
	ctx.account_id = opening.account_id
	ctx.character_id = opening.character_id
	ctx.character_name = opening.character_name
	ctx.race_id = effective_race
	ctx.assigned_start_location_id = opening.starting_location_id
	ctx.assigned_opening_quest_id = opening.opening_quest_line_id
	ctx.created_timestamp_utc = int(Time.get_unix_time_from_system())
	ctx.is_active = true
	ctx.current_stage = 1
	ctx.step_index = 0

	# 1. 提取并缓存初始占位符
	var ph := ProloguePlaceholderResolver.extract_placeholders(ctx)
	ctx.runtime_placeholders = ph

	# 2. 发放初始装备（幂等保护在 Dispatcher 内）
	var kit_res := StarterLoadoutDispatcher.dispatch_starter_kit(ctx)

	# 3. 结构化事件列表（事件与状态彻底解耦）
	var structured_mutations: Array[Dictionary] = [
		{"type": "CharacterCreated", "character_id": ctx.character_id, "name": ctx.character_name},
		{"type": "LocationAssigned", "location_id": ctx.assigned_start_location_id},
		{"type": "EquipmentGranted", "kit_id": kit_res.get("kit_id", ""), "gold": kit_res.get("gold", 0)},
		{"type": "DialogueReady", "npc_target": ph.get("NPC_TARGET", "")}
	]

	# 4. 生成第一步事件数据包（阶段配置经 domains.character_creation prologue_stages 驱动）
	var stages_cfg: Dictionary = GameConfig.get_dict("domains.character_creation", "prologue_stages", {})
	var stage1_cfg: Dictionary = stages_cfg.get("1", {})
	var stage1_key := str(stage1_cfg.get("narrative_key", "narrative/prologue/awakening"))
	var template := GameConfig.get_string(
		"narratives.prologue_i18n", stage1_key,
		"【苏醒】晨曦降临，开拓者 {PLAYER_NAME} 缓缓睁开双眼……"
	)
	var text_res := ProloguePlaceholderResolver.resolve_template(template, ctx.runtime_placeholders)

	var packet := PrologueEventPacketDTO.new()
	packet.account_id = ctx.account_id
	packet.character_id = ctx.character_id
	packet.character_name = ctx.character_name
	packet.current_stage = 1
	packet.step_index = 0
	packet.narrative_text = text_res.get("text", "")
	packet.available_actions = _to_string_array(stage1_cfg.get("available_actions", ["WAKE_UP", "NEXT"]))
	packet.reserved_payload = {"mutations": structured_mutations}

	return {"success": true, "context": ctx, "packet": packet, "kit": kit_res}

# ==============================================================================
# 二、配置驱动单向阶段流转（Stage 1 -> 2 -> 3 -> 4 闭环完结）
# ==============================================================================

## 推进角色序章单向阶段流转（阶段表由 domains.character_creation prologue_stages 配置驱动）。
static func advance_prologue_step(
	ctx: CharacterPrologueContext,
	action: String = "NEXT",
	action_payload: Dictionary = {}
) -> Dictionary:
	if ctx == null:
		return {"success": false, "error_code": "NULL_CONTEXT", "message": "序章上下文为空"}
	if ctx.is_completed:
		return {"success": false, "error_code": "PROLOGUE_ALREADY_COMPLETED", "message": "该角色序章已完结"}
	if not ctx.is_active:
		return {"success": false, "error_code": "INACTIVE_CONTEXT", "message": "序章上下文未激活"}

	for k in action_payload.keys():
		ctx.runtime_placeholders[k] = action_payload[k]

	ctx.current_stage += 1
	ctx.step_index += 1

	var stages_cfg: Dictionary = GameConfig.get_dict("domains.character_creation", "prologue_stages", {})
	var stage_key := str(mini(ctx.current_stage, 4))
	var stage_def: Dictionary = stages_cfg.get(stage_key, stages_cfg.get("4", {}))
	var is_term := bool(stage_def.get("is_terminal", ctx.current_stage >= 4))
	if is_term:
		ctx.current_stage = int(stage_key)
		ctx.is_completed = true
		ctx.is_active = false

	var narrative_sub_key := str(stage_def.get("narrative_key", "narrative/prologue/completed"))
	var available_actions := _to_string_array(stage_def.get("available_actions", ["ENTER_WORLD"]))
	var mutations := _build_stage_mutations(ctx, str(stage_def.get("mutation_type", "PrologueCompleted")), action)

	var template := GameConfig.get_string("narratives.prologue_i18n", narrative_sub_key, "")
	var text_res := ProloguePlaceholderResolver.resolve_template(template, ctx.runtime_placeholders)

	var packet := PrologueEventPacketDTO.new()
	packet.account_id = ctx.account_id
	packet.character_id = ctx.character_id
	packet.character_name = ctx.character_name
	packet.current_stage = ctx.current_stage
	packet.step_index = ctx.step_index
	packet.narrative_text = text_res.get("text", "")
	packet.available_actions = available_actions
	packet.reserved_payload = {"mutations": mutations}

	broadcast_step(packet, narrative_sub_key, ctx.runtime_placeholders)
	if ctx.is_completed:
		var creation_hooks: Dictionary = GameConfig.get_dict("domains.character_creation", "creation_hooks", {})
		EventBusCore.get_instance().emit_domain_event("prologue.completed", {
			"account_id": ctx.account_id,
			"character_id": ctx.character_id,
			"race_id": ctx.race_id,
			"configured_hooks": creation_hooks.get("on_prologue_completed", [])
		})

	return {
		"success": true,
		"context": ctx,
		"packet": packet,
		"is_completed": ctx.is_completed
	}


static func _to_string_array(raw: Variant) -> Array[String]:
	var out: Array[String] = []
	if raw is Array:
		for item in raw:
			out.append(str(item))
	return out


static func _build_stage_mutations(ctx: CharacterPrologueContext, mutation_type: String, action: String) -> Array[Dictionary]:
	var mutations: Array[Dictionary] = []
	if mutation_type == "EnvironmentExplored":
		mutations.append({"type": "EnvironmentExplored", "location": ctx.assigned_start_location_id, "action": action})
	elif mutation_type == "DialogueTriggered":
		mutations.append({"type": "DialogueTriggered", "npc": ctx.runtime_placeholders.get("NPC_TARGET", "UNBOUND_NPC"), "action": action})
	else:
		mutations.append({"type": mutation_type, "character_id": ctx.character_id, "step_index": ctx.step_index})
	return mutations

# ==============================================================================
# 三、会话衔接与结构化广播
# ==============================================================================

## 为指定角色序章上下文动态创建并初始化 通用因果 DAG 编排引擎会话。
## 契约：ctx 为空或该种族/身世无对应 DAG 时返回 null（调用方判空降级为顺序推进）。
static func create_dag_session(
	ctx: CharacterPrologueContext,
	origin_id: String = "",
	adapted_mod_manifest: Dictionary = {}
) -> NarrativeDagExecutionEngine:
	if ctx == null:
		return null
	var effective_origin: String = origin_id
	if effective_origin.is_empty():
		effective_origin = str(ctx.runtime_placeholders.get("ORIGIN_ID", ctx.runtime_placeholders.get("origin_id", "")))
	var dag := PrologueDagRegistry.resolve_prologue_dag(ctx.race_id, effective_origin, adapted_mod_manifest)
	if dag == null:
		return null
	var engine := NarrativeDagExecutionEngine.new()
	engine.initialize_with_graph(dag, ctx.runtime_placeholders)
	return engine

## 将当前活跃的 DAG 节点渲染为 PrologueEventPacketDTO 数据包
static func render_dag_node_packet(
	node: NarrativeDAGNode,
	ctx: CharacterPrologueContext,
	adapted_mod_manifest: Dictionary = {},
	step_index: int = 0
) -> PrologueEventPacketDTO:
	if node == null or ctx == null:
		return PrologueEventPacketDTO.new()

	var text_res := ProloguePlaceholderResolver.resolve_narrative_key(
		node.narrative_key,
		ctx.runtime_placeholders,
		adapted_mod_manifest,
		node.inline_text
	)

	var actions: Array[String] = []
	if not node.choices.is_empty():
		for c in node.choices:
			var act: String = str(c.get("action", c.get("choice_id", c.get("id", "")))).strip_edges()
			if not act.is_empty():
				actions.append(act)
	if actions.is_empty():
		if node.node_type == NarrativeDAGNode.NodeType.TERMINAL_EXIT:
			actions.append("ENTER_WORLD")
		else:
			actions.append("NEXT")

	var packet := PrologueEventPacketDTO.new()
	packet.account_id = ctx.account_id
	packet.character_id = ctx.character_id
	packet.character_name = ctx.character_name
	packet.current_stage = ctx.current_stage
	packet.step_index = step_index
	packet.narrative_text = str(text_res.get("text", ""))
	packet.available_actions = actions
	packet.reserved_payload = {
		"node_id": node.node_id,
		"node_type": node.node_type,
		"choices": node.choices.duplicate(true),
		"mutations": node.mutations_on_complete.duplicate(true)
	}
	return packet

## 执行并应用 DAG 节点突变（支持 PrologueCompleted、GoldGranted/ModifyGold、AttributeModified、LocationAssigned）
static func apply_dag_mutations(
	mutations: Array,
	ctx: CharacterPrologueContext,
	profile: Variant = null
) -> Array[Dictionary]:
	var settled: Array[Dictionary] = []
	if ctx == null:
		return settled

	for m in mutations:
		var d: Dictionary = {}
		if m is Dictionary:
			d = (m as Dictionary).duplicate(true)
		elif m is String:
			d = {"type": str(m)}
		else:
			continue

		var m_type: String = str(d.get("type", d.get("event", "")))
		_apply_single_mutation(m_type, d, ctx, profile)
		settled.append(d)

	return settled

static func _apply_single_mutation(
	m_type: String,
	d: Dictionary,
	ctx: CharacterPrologueContext,
	profile: Variant
) -> void:
	match m_type:
		"PrologueCompleted":
			ctx.is_completed = true
			ctx.is_active = false
		"GoldGranted", "ModifyGold":
			var gold_delta: int = int(d.get("amount", d.get("gold", d.get("delta", 0))))
			_apply_gold_mutation(gold_delta, ctx, profile)
		"AttributeModified":
			var attr_name: String = str(d.get("attribute", d.get("attr", "")))
			var delta: int = int(d.get("delta", d.get("value", 0)))
			_apply_attr_mutation(attr_name, delta, profile)
		"LocationAssigned":
			var loc_id: String = str(d.get("location_id", d.get("location", "")))
			if not loc_id.is_empty():
				ctx.assigned_start_location_id = loc_id
				ctx.runtime_placeholders["START_LOCATION"] = loc_id
				ctx.runtime_placeholders["start_location"] = loc_id

static func _apply_gold_mutation(gold_delta: int, ctx: CharacterPrologueContext, profile: Variant) -> void:
	if profile != null:
		if profile is CharacterProfile:
			var curr: int = int((profile as CharacterProfile).personal_resources.get("gold", 0))
			(profile as CharacterProfile).personal_resources["gold"] = curr + gold_delta
		elif profile is Dictionary:
			var pr: Dictionary = (profile as Dictionary).get("personal_resources", {})
			pr["gold"] = int(pr.get("gold", 0)) + gold_delta
			(profile as Dictionary)["personal_resources"] = pr
	var prev_gold: int = int(ctx.runtime_placeholders.get("INITIAL_GOLD", ctx.runtime_placeholders.get("STARTER_GOLD", 0)))
	ctx.runtime_placeholders["INITIAL_GOLD"] = str(prev_gold + gold_delta)
	ctx.runtime_placeholders["initial_gold"] = ctx.runtime_placeholders["INITIAL_GOLD"]

static func _apply_attr_mutation(attr_name: String, delta: int, profile: Variant) -> void:
	if attr_name.is_empty() or profile == null:
		return
	if profile is CharacterProfile:
		var curr_val: int = int((profile as CharacterProfile).attributes.get(attr_name, 0))
		(profile as CharacterProfile).attributes[attr_name] = curr_val + delta
	elif profile is Dictionary:
		var attrs: Dictionary = (profile as Dictionary).get("attributes", {})
		attrs[attr_name] = int(attrs.get(attr_name, 0)) + delta
		(profile as Dictionary)["attributes"] = attrs

## 执行无头全流程 MOD 试玩仿真并生成完整过程报告
static func execute_headless_mod_playthrough(config: Dictionary) -> Dictionary:
	var candidates: Array = _prepare_headless_candidates(config)
	var enabled_ids: Array = config.get("enabled_pack_ids", ["*"])
	var adapt_res := ModPrecheckAndAdaptationSolver.precheck_and_adapt_mod_list(candidates, enabled_ids)
	if not bool(adapt_res.get("success", false)):
		return {
			"schema_version": "kalar.mod_sdk.playthrough_transcript.v1",
			"is_success": false,
			"error_code": str(adapt_res.get("error_code", "ERR_MOD_PRECHECK_FAILED")),
			"conflicts": adapt_res.get("conflicts", []),
			"precheck_checklist": adapt_res.get("precheck_checklist", [])
		}

	var adapted_manifest: Dictionary = adapt_res.get("adapted_manifest", {})
	var seed_val: int = int(config.get("seed", config.get("seed_val", 1337)))
	var char_name: String = str(config.get("character_name", "HeadlessTraveler")).strip_edges()
	if char_name.is_empty():
		char_name = "HeadlessTraveler"

	var req := AuthoritativeCharacterCreationRequestDTO.new()
	req.character_name = char_name
	req.request_seed = seed_val
	var req_origin: String = str(config.get("origin_id", "")).strip_edges()
	if not req_origin.is_empty():
		req.extra_custom_fields["selected_origin_id"] = req_origin
	var req_trait: String = str(config.get("selected_positive_trait", "")).strip_edges()
	if not req_trait.is_empty():
		req.extra_custom_fields["selected_positive_trait"] = req_trait
	var req_nonce: int = int(config.get("reroll_nonce", 0))
	if req_nonce != 0:
		req.extra_custom_fields["reroll_nonce"] = req_nonce

	var reinc_res := AuthoritativeReincarnationSolver.resolve_reincarnation_package(req, seed_val, adapted_manifest)
	if not bool(reinc_res.get("success", false)):
		return {
			"schema_version": "kalar.mod_sdk.playthrough_transcript.v1",
			"is_success": false,
			"error_code": str(reinc_res.get("error_code", "ERR_REINCARNATION_FAILED"))
		}

	var eff_race: String = str(config.get("race_id", reinc_res.get("race_id", "HUMAN")))
	var eff_origin: String = str(reinc_res.get("origin_id", req_origin))

	var profile := CharacterProfile.new()
	profile.character_id = "CHAR_" + str(seed_val)
	profile.character_name = char_name
	profile.attributes = (reinc_res.get("attributes", {}) as Dictionary).duplicate(true)

	var hydrate_res := StarterLoadoutDispatcher.hydrate_starter_loadout_into_profile(
		profile, eff_race, eff_origin, adapted_manifest
	)

	var ctx := CharacterPrologueContext.new()
	ctx.character_id = profile.character_id
	ctx.character_name = char_name
	ctx.race_id = eff_race
	ctx.assigned_start_location_id = str(reinc_res.get("birth_region_id", "CENTRAL_CONTINENT"))
	ctx.assigned_starter_kit_id = str(reinc_res.get("starter_kit_id", hydrate_res.get("kit_id", "")))
	ctx.is_active = true
	ctx.runtime_placeholders = ProloguePlaceholderResolver.extract_placeholders(ctx, adapted_manifest, profile)
	ctx.runtime_placeholders["ORIGIN_ID"] = eff_origin
	ctx.runtime_placeholders["origin_id"] = eff_origin
	ctx.runtime_placeholders["ORIGIN_NAME"] = reinc_res.get("origin_name", eff_origin)
	ctx.runtime_placeholders["origin_name"] = ctx.runtime_placeholders["ORIGIN_NAME"]

	var engine := create_dag_session(ctx, eff_origin, adapted_manifest)
	if engine == null:
		return {
			"schema_version": "kalar.mod_sdk.playthrough_transcript.v1",
			"is_success": false,
			"error_code": "ERR_DAG_SESSION_CREATION_FAILED"
		}

	var transcript_steps: Array[Dictionary] = []
	var choice_indices: Array = config.get("choice_indices", [])
	_run_headless_loop(engine, ctx, profile, adapted_manifest, choice_indices, transcript_steps)

	return _build_headless_transcript(char_name, eff_race, eff_origin, reinc_res, profile, engine, ctx, transcript_steps)

static func _prepare_headless_candidates(config: Dictionary) -> Array:
	var candidates: Array = config.get("candidate_packs", []).duplicate()
	var mod_dirs: Array = config.get("mod_dirs", [])
	if candidates.is_empty() and not mod_dirs.is_empty():
		for d in mod_dirs:
			var pkg := ModPackageDiscoverySolver.load_full_mod_package_from_dir(str(d))
			if not pkg.is_empty():
				candidates.append(pkg)
	return candidates

static func _run_headless_loop(
	engine: NarrativeDagExecutionEngine,
	ctx: CharacterPrologueContext,
	profile: CharacterProfile,
	adapted_manifest: Dictionary,
	choice_indices: Array,
	transcript_steps: Array[Dictionary]
) -> void:
	var choice_ptr: int = 0
	var step_guard: int = 0
	while not engine.active_node_ids.is_empty() and not engine.is_terminated and step_guard < 100:
		step_guard += 1
		var curr_nid: String = engine.active_node_ids[0]
		var node: NarrativeDAGNode = engine.graph.nodes.get(curr_nid)
		if node == null:
			break

		var packet := render_dag_node_packet(node, ctx, adapted_manifest, transcript_steps.size())
		var action_payload: Dictionary = {}
		if not node.choices.is_empty():
			var c_idx: int = 0
			if choice_ptr < choice_indices.size():
				c_idx = clampi(int(choice_indices[choice_ptr]), 0, node.choices.size() - 1)
				choice_ptr += 1
			var chosen: Dictionary = node.choices[c_idx]
			action_payload["selected_choice"] = chosen.get("choice_id", chosen.get("id", str(c_idx)))

		var step_res := engine.execute_node_action(curr_nid, action_payload)
		var mutations: Array = step_res.get("mutations", node.mutations_on_complete)
		var applied := apply_dag_mutations(mutations, ctx, profile)

		transcript_steps.append({
			"step_index": transcript_steps.size(),
			"node_id": curr_nid,
			"packet": packet.to_dto(),
			"action_payload": action_payload,
			"applied_mutations": applied,
			"step_result": step_res
		})

static func _build_headless_transcript(
	char_name: String,
	eff_race: String,
	eff_origin: String,
	reinc_res: Dictionary,
	profile: CharacterProfile,
	engine: NarrativeDagExecutionEngine,
	ctx: CharacterPrologueContext,
	transcript_steps: Array[Dictionary]
) -> Dictionary:
	var all_mutations: Array = []
	for s in transcript_steps:
		for m in s.get("applied_mutations", []):
			all_mutations.append(m)

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

## 序章步骤结构化广播：向前端暴露 channel + narrative_key + i18n_params + mutations
## （前端既可直显 fallback 文案，也可按 key+params 自渲染；纯结构化事件与状态解耦）。
## 契约：EventBus 未就绪（null）安全跳过；事件后同步投递富文本文字战报
##       （category 经既有 event_categories 键解析，未命中回退大写）。
static func broadcast_step(
	packet: PrologueEventPacketDTO,
	narrative_key: String,
	params: Dictionary
) -> void:
	var bus := EventBusCore.get_instance()
	if bus == null:
		return
	var payload: Dictionary = packet.to_dto()
	payload["narrative_key"] = narrative_key
	payload["i18n_params"] = params.duplicate(true)
	bus.emit_domain_event("prologue.step_advanced", payload)
	# 同步投递富文本文字战报（category 经既有 event_categories 键解析，未命中回退大写）
	bus.emit_narrative(packet.narrative_text, "narrative", {
		"character_id": packet.character_id,
		"narrative_key": narrative_key
	})

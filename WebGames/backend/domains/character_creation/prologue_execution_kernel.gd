# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/character_creation/prologue_execution_kernel.gd
# 架构定位: Domain Logic Component
# 依赖与触发: 上游: GameBootstrap, WorldGateway | 下游: GameConfig, EventBusCore
# 配置与信号: 配置 config/domains/character_creation.json | 信号: EventBus 领域广播
# 职责说明: 编排角色专属序章启动、模板参数提取、新手装备发放、四阶段跃迁与 DAG 会话。
#   事件与状态解耦，仅产出纯结构化结果。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## PrologueExecutionKernel：Domain Logic Component
class_name PrologueExecutionKernel
extends RefCounted

# ==============================================================================
# 一、启动编排（开局事件流 → 序章上下文 + 首步事件包）
# ==============================================================================

## 启动角色序章：必须经因果 DAG 图元实例化并驱动首步节点包（废除线性四阶段固定回退）。
## 契约：opening 为空或 character_id 为空返回 INVALID_OPENING；无有效内容 MOD 或缺失对应 DAG
##       时按 Fail-Closed 返回 ERR_NO_BASE_CONTENT_MOD / MOD_ERR_MISSING_PROLOGUE_DAG。
static func boot_character_prologue(
	opening: OpeningEventStreamDTO,
	race_id: String = "",
	_should_allow_default_fallback: bool = false,
	adapted_mod_manifest: Dictionary = {},
	profile: Variant = null
) -> Dictionary:
	if opening == null or opening.character_id.is_empty():
		return {"success": false, "error_code": "INVALID_OPENING", "message": "开局事件包缺失或角色 ID 为空"}

	var effective_race := race_id.strip_edges() if not race_id.strip_edges().is_empty() else opening.race_id.strip_edges()
	if effective_race.is_empty() or effective_race == "UNBOUND":
		return {"success": false, "error_code": "UNBOUND_RACE_ID", "unwired_slot": "race_id", "message": "种族标识未接线(UNBOUND)，禁止静默回退默认种族"}

	var manifest: Dictionary = DestinyModManifestDTO.unwrap_adapted_manifest(adapted_mod_manifest)
	var prologue_context := PrologueDagStepHelper.create_initial_prologue_context(opening, effective_race, manifest, profile)

	# 1. 提取并缓存初始模板参数（优先消费已适配 MOD manifest 与 profile）
	var runtime_placeholders := ProloguePlaceholderResolver.extract_placeholders(prologue_context, manifest, profile)
	for placeholder_key in prologue_context.runtime_placeholders.keys():
		if not runtime_placeholders.has(placeholder_key):
			runtime_placeholders[placeholder_key] = prologue_context.runtime_placeholders[placeholder_key]
	prologue_context.runtime_placeholders = runtime_placeholders

	# 2. 发放初始装备（幂等保护在 Dispatcher 内）
	var kit_result := StarterLoadoutDispatcher.dispatch_starter_kit(prologue_context, manifest)
	if not bool(kit_result.get("success", false)):
		return kit_result

	# 3. 初始化因果 DAG 会话并 Fail-Closed 阻断缺失
	var dag_session := create_dag_session(prologue_context, prologue_context.origin_id, manifest)
	if dag_session == null:
		var has_catalog_fallback := not GameConfig.get_dict("narratives.prologue_dag_catalog", "dag_graphs", {}).is_empty()
		var failure_code := "ERR_NO_BASE_CONTENT_MOD" if (manifest.is_empty() and not has_catalog_fallback) else "MOD_ERR_MISSING_PROLOGUE_DAG"
		return {
			"success": false,
			"error_code": failure_code,
			"message": "No matching prologue DAG graph found for active MOD manifest (Fail-Closed)."
		}

	prologue_context.active_dag_session = dag_session
	prologue_context.current_dag_id = dag_session.graph.graph_id
	var entry_node := PrologueDagStepHelper.resolve_active_dag_node(dag_session)
	prologue_context.current_node_id = entry_node.node_id if entry_node != null else dag_session.graph.entry_node_id

	# 4. 结构化初始化突变 + 首步 DAG 节点数据包
	var initial_mutations: Array[Dictionary] = [
		{"type": "CharacterCreated", "character_id": prologue_context.character_id, "name": prologue_context.character_name},
		{"type": "LocationAssigned", "location_id": prologue_context.assigned_start_location_id},
		{"type": "EquipmentGranted", "kit_id": kit_result.get("kit_id", ""), "gold": kit_result.get("gold", 0)},
		{"type": "DialogueReady", "npc_target": runtime_placeholders.get("NPC_TARGET", "")}
	]
	var packet := render_dag_node_packet(entry_node, prologue_context, manifest, 0)
	var existing_mutations: Variant = packet.reserved_payload.get("mutations", [])
	var combined_mutations: Array = initial_mutations.duplicate()
	if existing_mutations is Array:
		combined_mutations.append_array(existing_mutations as Array)
	packet.reserved_payload["mutations"] = combined_mutations

	broadcast_step(packet, entry_node.narrative_key if entry_node != null else "", prologue_context.runtime_placeholders)
	return {
		"success": true,
		"context": prologue_context,
		"packet": packet,
		"kit": kit_result,
		"dag_session": dag_session,
		"adapted_mod_manifest": manifest
	}

# ==============================================================================
# 二、统一因果 DAG 状态机步进流转 (DAG Execution & Choice Validation)
# ==============================================================================

## 推进角色序章当前活跃 DAG 节点并结算突变事件与下一节点渲染
static func advance_prologue_step(
	prologue_context: CharacterPrologueContext,
	action: String = "NEXT",
	action_payload: Dictionary = {},
	profile: Variant = null
) -> Dictionary:
	if prologue_context == null:
		return {"success": false, "error_code": "NULL_CONTEXT", "message": "序章上下文为空"}
	if prologue_context.is_completed:
		return {"success": false, "error_code": "PROLOGUE_ALREADY_COMPLETED", "message": "该角色序章已完结"}
	if not prologue_context.is_active:
		return {"success": false, "error_code": "INACTIVE_CONTEXT", "message": "序章上下文未激活"}

	var dag_session := PrologueDagStepHelper.ensure_context_dag_session(prologue_context, create_dag_session)
	if dag_session == null:
		return {"success": false, "error_code": "MOD_ERR_MISSING_PROLOGUE_DAG", "message": "当前序章缺少有效因果 DAG 会话 (Fail-Closed)"}

	var active_node := PrologueDagStepHelper.resolve_active_dag_node(dag_session)
	if active_node == null:
		return {"success": false, "error_code": "ERR_PROLOGUE_NO_ACTIVE_NODE", "message": "当前序章不存在活跃 DAG 节点"}

	var choice_id := str(action_payload.get("choice_id", action)).strip_edges()
	if not PrologueDagStepHelper.is_dag_choice_valid(active_node, choice_id):
		return {"success": false, "error_code": "ERR_PROLOGUE_INVALID_CHOICE", "message": "所选分支动作无效: " + choice_id}

	var step_payload := action_payload.duplicate(true)
	step_payload["selected_choice"] = choice_id
	for payload_key in action_payload.keys():
		prologue_context.runtime_placeholders[payload_key] = action_payload[payload_key]

	var execution_result: Dictionary = dag_session.execute_node_action(active_node.node_id, step_payload)
	if not bool(execution_result.get("success", false)):
		return {
			"success": false,
			"error_code": str(execution_result.get("error_code", "ERR_PROLOGUE_ADVANCE_FAILED")),
			"message": str(execution_result.get("message", "DAG 节点推进失败"))
		}

	var raw_mutations: Variant = execution_result.get("mutations", active_node.mutations_on_complete)
	var mutations_list: Array = raw_mutations if raw_mutations is Array else []
	var settled_mutations := apply_dag_mutations(mutations_list, prologue_context, profile)

	prologue_context.current_stage += 1
	prologue_context.step_index += 1

	var next_node: NarrativeDAGNode = null
	var settled_terminal_node: NarrativeDAGNode = null
	if dag_session.is_terminated or dag_session.active_node_ids.is_empty():
		prologue_context.is_completed = true
		prologue_context.is_active = false
		prologue_context.current_node_id = ""
	else:
		next_node = PrologueDagStepHelper.resolve_active_dag_node(dag_session)
		if PrologueDagStepHelper.should_auto_settle_terminal_node(next_node, dag_session):
			settled_terminal_node = next_node
			settled_mutations.append_array(PrologueDagStepHelper.execute_terminal_exit_node(
				dag_session, next_node, step_payload, prologue_context, profile, apply_dag_mutations
			))
			next_node = null
		else:
			prologue_context.current_node_id = next_node.node_id if next_node != null else ""

	var display_node: NarrativeDAGNode = settled_terminal_node if settled_terminal_node != null else next_node
	var display_narrative_key: String = display_node.narrative_key if display_node != null else active_node.narrative_key
	var packet: PrologueEventPacketDTO = PrologueDagStepHelper.build_post_step_packet(
		prologue_context,
		dag_session,
		display_node,
		settled_mutations,
		display_narrative_key,
		render_dag_node_packet
	)
	broadcast_step(packet, display_narrative_key, prologue_context.runtime_placeholders)

	if prologue_context.is_completed:
		var creation_hooks: Dictionary = GameConfig.get_dict("domains.character_creation", "creation_hooks", {})
		EventBusCore.get_instance().emit_domain_event("prologue.completed", {
			"account_id": prologue_context.account_id,
			"character_id": prologue_context.character_id,
			"race_id": prologue_context.race_id,
			"dag_id": prologue_context.current_dag_id,
			"configured_hooks": creation_hooks.get("on_prologue_completed", [])
		})

	return {
		"success": true,
		"context": prologue_context,
		"packet": packet,
		"is_completed": prologue_context.is_completed,
		"dag_session": dag_session
	}

# ==============================================================================
# 三、会话衔接与结构化广播
# ==============================================================================

## 为指定角色序章上下文动态创建并初始化 通用因果 DAG 编排引擎会话。
## 契约：prologue_context 为空或该种族/身世无对应 DAG 时返回 null（调用方判空降级为顺序推进）。
static func create_dag_session(
	prologue_context: CharacterPrologueContext,
	origin_id: String = "",
	adapted_mod_manifest: Dictionary = {}
) -> NarrativeDagExecutionEngine:
	if prologue_context == null:
		return null
	var effective_origin: String = origin_id
	if effective_origin.is_empty():
		effective_origin = str(prologue_context.runtime_placeholders.get("ORIGIN_ID", prologue_context.runtime_placeholders.get("origin_id", "")))
	var dag := PrologueDagRegistry.resolve_prologue_dag(prologue_context.race_id, effective_origin, adapted_mod_manifest)
	if dag == null:
		return null
	var engine := NarrativeDagExecutionEngine.new()
	engine.set_hook_interceptor(Callable(PrologueCutscenePort, "intercept_narrative_hook"))
	engine.initialize_with_graph(dag, prologue_context.runtime_placeholders)
	return engine

## 将当前活跃的 DAG 节点渲染为 PrologueEventPacketDTO 数据包
static func render_dag_node_packet(
	node: NarrativeDAGNode,
	prologue_context: CharacterPrologueContext,
	adapted_mod_manifest: Dictionary = {},
	step_index: int = 0
) -> PrologueEventPacketDTO:
	if node == null or prologue_context == null:
		return PrologueEventPacketDTO.new()

	var text_result := ProloguePlaceholderResolver.resolve_narrative_key(
		node.narrative_key,
		prologue_context.runtime_placeholders,
		adapted_mod_manifest,
		node.inline_text
	)

	var actions: Array[String] = []
	var formatted_choices: Array[Dictionary] = []
	if not node.choices.is_empty():
		for choice_entry in node.choices:
			var localized_choice := _localize_dag_choice(choice_entry, prologue_context, adapted_mod_manifest)
			var action_name: String = str(localized_choice.get("action", "")).strip_edges()
			if not action_name.is_empty():
				actions.append(action_name)
			formatted_choices.append(localized_choice)
	if actions.is_empty():
		if node.node_type == NarrativeDAGNode.NodeType.TERMINAL_EXIT:
			actions.append("ENTER_WORLD")
		else:
			actions.append("NEXT")

	var packet := PrologueEventPacketDTO.new()
	packet.account_id = prologue_context.account_id
	packet.character_id = prologue_context.character_id
	packet.character_name = prologue_context.character_name
	packet.current_stage = prologue_context.current_stage
	packet.step_index = step_index
	packet.narrative_text = str(text_result.get("text", ""))
	packet.available_actions = actions
	packet.reserved_payload = {
		"dag_id": prologue_context.current_dag_id,
		"node_id": node.node_id,
		"node_type": node.node_type,
		"choices": formatted_choices,
		"cutscene_trigger": node.cutscene_trigger,
		"mutations": node.mutations_on_complete.duplicate(true)
	}
	return packet


static func _localize_dag_choice(
	choice_entry: Dictionary,
	prologue_context: CharacterPrologueContext,
	adapted_mod_manifest: Dictionary
) -> Dictionary:
	var action_id := str(choice_entry.get("action", choice_entry.get("choice_id", choice_entry.get("id", "")))).strip_edges()
	var choice_id := str(choice_entry.get("choice_id", action_id)).strip_edges()
	var raw_text := str(choice_entry.get("text", choice_entry.get("desc", ""))).strip_edges()
	var label_key := str(choice_entry.get("text_key", choice_entry.get("narrative_key", ""))).strip_edges()
	var resolved_text := raw_text
	if not label_key.is_empty():
		var text_result := ProloguePlaceholderResolver.resolve_narrative_key(
			label_key,
			prologue_context.runtime_placeholders,
			adapted_mod_manifest,
			raw_text if not raw_text.is_empty() else action_id
		)
		resolved_text = str(text_result.get("text", raw_text))
	if resolved_text.is_empty():
		resolved_text = choice_id
	return {
		"choice_id": choice_id,
		"action": action_id if not action_id.is_empty() else choice_id,
		"text": resolved_text,
		"target_node_id": str(choice_entry.get("target_node_id", ""))
	}

static func _apply_mutation_entry(
	mutation_entry: Variant,
	prologue_context: CharacterPrologueContext,
	profile: Variant,
	settled: Array[Dictionary]
) -> void:
	if mutation_entry is Dictionary:
		var mutation_record: Dictionary = (mutation_entry as Dictionary).duplicate(true)
		var mutation_type: String = str(mutation_record.get("type", mutation_record.get("event", "")))
		_apply_single_mutation(mutation_type, mutation_record, prologue_context, profile)
		settled.append(mutation_record)
	elif mutation_entry is String:
		var label_record: Dictionary = {"type": str(mutation_entry)}
		_apply_single_mutation(str(mutation_entry), label_record, prologue_context, profile)
		settled.append(label_record)

## 执行并应用 DAG 节点突变（PrologueCompleted、Gold、Attribute、Location）
static func apply_dag_mutations(
	mutations: Array,
	prologue_context: CharacterPrologueContext,
	profile: Variant = null
) -> Array[Dictionary]:
	var settled: Array[Dictionary] = []
	if prologue_context == null:
		return settled

	for mutation_entry in mutations:
		_apply_mutation_entry(mutation_entry, prologue_context, profile, settled)

	return settled

static func _apply_single_mutation(
	mutation_type: String,
	mutation_payload: Dictionary,
	prologue_context: CharacterPrologueContext,
	profile: Variant
) -> void:
	match mutation_type:
		"PrologueCompleted":
			prologue_context.is_completed = true
			prologue_context.is_active = false
		"GoldGranted", "ModifyGold":
			var gold_delta: int = int(mutation_payload.get("amount", mutation_payload.get("gold", mutation_payload.get("delta", 0))))
			_apply_gold_mutation(gold_delta, prologue_context, profile)
		"AttributeModified":
			var attribute_name: String = str(mutation_payload.get("attribute", mutation_payload.get("attr", "")))
			var delta: int = int(mutation_payload.get("delta", mutation_payload.get("value", 0)))
			_apply_attr_mutation(attribute_name, delta, profile)
		"LocationAssigned":
			var location_id: String = str(mutation_payload.get("location_id", mutation_payload.get("location", "")))
			if not location_id.is_empty():
				prologue_context.assigned_start_location_id = location_id
				prologue_context.runtime_placeholders["START_LOCATION"] = location_id
				prologue_context.runtime_placeholders["start_location"] = location_id

static func _apply_gold_mutation(gold_delta: int, prologue_context: CharacterPrologueContext, profile: Variant) -> void:
	if profile != null:
		if profile is CharacterProfile:
			var current_gold: int = int((profile as CharacterProfile).personal_resources.get("gold", 0))
			(profile as CharacterProfile).personal_resources["gold"] = current_gold + gold_delta
		elif profile is Dictionary:
			var personal_resources: Dictionary = (profile as Dictionary).get("personal_resources", {})
			personal_resources["gold"] = int(personal_resources.get("gold", 0)) + gold_delta
			(profile as Dictionary)["personal_resources"] = personal_resources
	var previous_gold: int = int(prologue_context.runtime_placeholders.get("INITIAL_GOLD", prologue_context.runtime_placeholders.get("STARTER_GOLD", 0)))
	prologue_context.runtime_placeholders["INITIAL_GOLD"] = str(previous_gold + gold_delta)
	prologue_context.runtime_placeholders["initial_gold"] = prologue_context.runtime_placeholders["INITIAL_GOLD"]

static func _apply_attr_mutation(attribute_name: String, delta: int, profile: Variant) -> void:
	if attribute_name.is_empty() or profile == null:
		return
	if profile is CharacterProfile:
		var current_value: int = int((profile as CharacterProfile).attributes.get(attribute_name, 0))
		(profile as CharacterProfile).attributes[attribute_name] = current_value + delta
	elif profile is Dictionary:
		var attributes: Dictionary = (profile as Dictionary).get("attributes", {})
		attributes[attribute_name] = int(attributes.get(attribute_name, 0)) + delta
		(profile as Dictionary)["attributes"] = attributes

## 执行无头全流程 MOD 试玩仿真并生成完整过程报告
static func execute_headless_mod_playthrough(config: Dictionary) -> Dictionary:
	var candidates: Array = PrologueHeadlessPlaythroughRunner.prepare_headless_candidates(config)
	var enabled_ids: Array = config.get("enabled_pack_ids", ["*"])
	var adaptation_result := ModPrecheckAndAdaptationSolver.precheck_and_adapt_mod_list(candidates, enabled_ids)
	if not bool(adaptation_result.get("success", false)):
		return {
			"schema_version": "kalar.mod_sdk.playthrough_transcript.v1",
			"is_success": false,
			"error_code": str(adaptation_result.get("error_code", "ERR_MOD_PRECHECK_FAILED")),
			"conflicts": adaptation_result.get("conflicts", []),
			"precheck_checklist": adaptation_result.get("precheck_checklist", [])
		}

	var adapted_manifest: Dictionary = adaptation_result.get("adapted_manifest", {})
	var seed_value: int = int(config.get("seed", config.get("seed_val", 1337)))
	var character_name: String = str(config.get("character_name", "HeadlessTraveler")).strip_edges()
	if character_name.is_empty():
		character_name = "HeadlessTraveler"

	var creation_request := AuthoritativeCharacterCreationRequestDTO.new()
	creation_request.character_name = character_name
	creation_request.request_seed = seed_value
	var requested_origin_id: String = str(config.get("origin_id", "")).strip_edges()
	if not requested_origin_id.is_empty():
		creation_request.extra_custom_fields["selected_origin_id"] = requested_origin_id
	var requested_positive_trait: String = str(config.get("selected_positive_trait", "")).strip_edges()
	if not requested_positive_trait.is_empty():
		creation_request.extra_custom_fields["selected_positive_trait"] = requested_positive_trait
	var reroll_nonce: int = int(config.get("reroll_nonce", 0))
	if reroll_nonce != 0:
		creation_request.extra_custom_fields["reroll_nonce"] = reroll_nonce

	var reincarnation_result := AuthoritativeReincarnationSolver.resolve_reincarnation_package(creation_request, seed_value, adapted_manifest)
	if not bool(reincarnation_result.get("success", false)):
		return {
			"schema_version": "kalar.mod_sdk.playthrough_transcript.v1",
			"is_success": false,
			"error_code": str(reincarnation_result.get("error_code", "ERR_REINCARNATION_FAILED"))
		}

	var effective_race: String = str(config.get("race_id", reincarnation_result.get("race_id", ""))).strip_edges()
	var effective_origin: String = str(reincarnation_result.get("origin_id", requested_origin_id))

	var profile := CharacterProfile.new()
	profile.character_id = "CHAR_" + str(seed_value)
	profile.character_name = character_name
	profile.attributes = (reincarnation_result.get("attributes", {}) as Dictionary).duplicate(true)

	var loadout_result := StarterLoadoutDispatcher.hydrate_starter_loadout_into_profile(
		profile, effective_race, effective_origin, adapted_manifest
	)

	var prologue_context := CharacterPrologueContext.new()
	prologue_context.character_id = profile.character_id
	prologue_context.character_name = character_name
	prologue_context.race_id = effective_race
	prologue_context.origin_id = effective_origin
	prologue_context.assigned_start_location_id = str(reincarnation_result.get("birth_region_id", ""))
	prologue_context.assigned_starter_kit_id = str(reincarnation_result.get("starter_kit_id", loadout_result.get("kit_id", "")))
	prologue_context.active_mod_manifest = adapted_manifest.duplicate(true)
	prologue_context.is_active = true
	prologue_context.runtime_placeholders = ProloguePlaceholderResolver.extract_placeholders(prologue_context, adapted_manifest, profile)
	prologue_context.runtime_placeholders["ORIGIN_ID"] = effective_origin
	prologue_context.runtime_placeholders["origin_id"] = effective_origin
	prologue_context.runtime_placeholders["ORIGIN_NAME"] = reincarnation_result.get("origin_name", effective_origin)
	prologue_context.runtime_placeholders["origin_name"] = prologue_context.runtime_placeholders["ORIGIN_NAME"]

	var engine := create_dag_session(prologue_context, effective_origin, adapted_manifest)
	if engine == null:
		return {
			"schema_version": "kalar.mod_sdk.playthrough_transcript.v1",
			"is_success": false,
			"error_code": "ERR_DAG_SESSION_CREATION_FAILED"
		}

	var transcript_steps: Array[Dictionary] = []
	var choice_indices: Array = config.get("choice_indices", [])
	var loop_state: Dictionary = {
		"ctx": prologue_context,
		"profile": profile,
		"manifest": adapted_manifest,
		"choice_indices": choice_indices,
		"choice_ptr": 0,
		"step_index": 0
	}
	PrologueHeadlessPlaythroughRunner.run_headless_loop(
		engine, loop_state, transcript_steps, render_dag_node_packet, apply_dag_mutations
	)

	return PrologueHeadlessPlaythroughRunner.build_headless_transcript(
		character_name, effective_race, effective_origin, reincarnation_result, profile, engine, prologue_context, transcript_steps
	)

## 序章步骤结构化广播：向前端暴露 channel + narrative_key + i18n_params + mutations
## （前端既可直显 fallback 文案，也可按 key+params 自渲染；纯结构化事件与状态解耦）。
## 契约：EventBus 未就绪（null）安全跳过；事件后同步投递富文本文字战报
##       （category 经既有 event_categories 键解析，未命中回退大写）。
static func broadcast_step(
	packet: PrologueEventPacketDTO,
	narrative_key: String,
	i18n_parameters: Dictionary
) -> void:
	var bus := EventBusCore.get_instance()
	if bus == null:
		return
	var payload: Dictionary = packet.to_dto()
	payload["narrative_key"] = narrative_key
	payload["i18n_params"] = i18n_parameters.duplicate(true)
	bus.emit_domain_event("prologue.step_advanced", payload)
	# 同步投递富文本文字战报（category 经既有 event_categories 键解析，未命中回退大写）
	bus.emit_narrative(packet.narrative_text, "narrative", {
		"character_id": packet.character_id,
		"narrative_key": narrative_key
	})

## 无头完结序章并构造标准化 PrologueHandoffDTO（衔接大地图探索与 HUD 首帧同步）
static func complete_prologue_to_handoff(
	prologue_context: CharacterPrologueContext,
	profile: CharacterProfile = null,
	options: Dictionary = {}
) -> Dictionary:
	if prologue_context == null or prologue_context.character_id.is_empty():
		return {"success": false, "error_code": "INVALID_PROLOGUE_CONTEXT", "handoff": null}

	var extra_attributes: Dictionary = options.get("extra_attrs", {}) if options.get("extra_attrs", null) is Dictionary else {}
	var initial_gold: int = int(options.get("initial_gold", -1))
	var active_mods: Array = options.get("active_mods", []) if options.get("active_mods", null) is Array else []
	var empty_step_payload: Dictionary = {}

	var safety_steps := 0
	var last_step_result: Dictionary = {}
	while not prologue_context.is_completed and safety_steps < 64:
		safety_steps += 1
		var dag_session := PrologueDagStepHelper.ensure_context_dag_session(prologue_context, create_dag_session)
		if dag_session == null:
			return {"success": false, "error_code": "MOD_ERR_MISSING_PROLOGUE_DAG", "handoff": null}
		var active_node := PrologueDagStepHelper.resolve_active_dag_node(dag_session)
		var next_choice := _pick_default_choice_for_node(active_node)
		last_step_result = advance_prologue_step(prologue_context, next_choice, empty_step_payload, profile)
		if not bool(last_step_result.get("success", false)):
			break

	prologue_context.is_completed = true
	prologue_context.is_active = false

	var handoff := PrologueHandoffDTO.new()
	handoff.account_id = prologue_context.account_id
	handoff.character_id = prologue_context.character_id
	handoff.character_name = prologue_context.character_name
	handoff.race_id = prologue_context.race_id
	handoff.origin_id = str(prologue_context.runtime_placeholders.get("ORIGIN_ID", prologue_context.origin_id))
	handoff.assigned_start_location_id = prologue_context.assigned_start_location_id
	handoff.active_mods = active_mods.duplicate()
	handoff.timestamp_utc = int(Time.get_unix_time_from_system())

	if profile != null:
		handoff.allocated_attributes = profile.attributes.duplicate(true)
		var raw_gold: int = int(profile.personal_resources.get("gold", 0))
		handoff.initial_gold = initial_gold if initial_gold >= 0 else raw_gold
		_append_profile_inventory_items(profile.inventory, handoff.initial_inventory_items)
	elif initial_gold >= 0:
		handoff.initial_gold = initial_gold

	for attribute_key in extra_attributes.keys():
		handoff.allocated_attributes[attribute_key] = extra_attributes[attribute_key]

	return {
		"success": true,
		"is_completed": prologue_context.is_completed,
		"context": prologue_context,
		"handoff": handoff
	}

static func _append_profile_inventory_items(inventory_payload: Dictionary, collected_items: Array) -> void:
	if inventory_payload.is_empty():
		return
	var has_aggregate_buckets: bool = inventory_payload.has("storage_items") or inventory_payload.has("equipped_payloads")
	if has_aggregate_buckets:
		var storage_array: Variant = inventory_payload.get("storage_items", [])
		if storage_array is Array and not (storage_array as Array).is_empty():
			var cloned_storage: Array = (storage_array as Array).duplicate(true)
			for entry in cloned_storage:
				if entry is Dictionary:
					collected_items.append(entry)
		var equipped_map: Variant = inventory_payload.get("equipped_payloads", {})
		if equipped_map is Dictionary:
			for slot_key in equipped_map.keys():
				if equipped_map[slot_key] != null:
					collected_items.append({"item_id": slot_key, "data": equipped_map[slot_key]})
		return
	for inventory_key in inventory_payload.keys():
		collected_items.append({"item_id": inventory_key, "data": inventory_payload[inventory_key]})

static func _pick_default_choice_for_node(node: NarrativeDAGNode) -> String:
	if node != null and not node.choices.is_empty():
		var first_choice: Dictionary = node.choices[0]
		var choice_id := str(first_choice.get("choice_id", first_choice.get("action", first_choice.get("id", "")))).strip_edges()
		if not choice_id.is_empty():
			return choice_id
	return "NEXT"

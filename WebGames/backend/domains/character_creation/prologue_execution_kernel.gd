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

const PrologueHeadlessPlaythroughRunner = preload("res://backend/domains/character_creation/prologue_headless_playthrough_runner.gd")

# ==============================================================================
# 一、启动编排（开局事件流 → 序章上下文 + 首步事件包）
# ==============================================================================

## 启动角色序章，产出初始化结构化事件流。
## 契约：opening 为空或 character_id 为空返回 INVALID_OPENING；种族默认经
##       config 键 defaults/default_race_id 驱动（既有键）；内部顺序执行
##       上下文构建 → 模板参数提取 → 新手套件发放 → 突变事件列表 → 首步事件包。
static func boot_character_prologue(opening: OpeningEventStreamDTO, race_id: String = "", should_allow_default_fallback: bool = true) -> Dictionary:
	if opening == null or opening.character_id.is_empty():
		return {"success": false, "error_code": "INVALID_OPENING", "message": "开局事件包缺失或角色 ID 为空"}

	var effective_race := race_id if not race_id.is_empty() else opening.race_id
	if effective_race.is_empty() or effective_race == "UNBOUND":
		if not should_allow_default_fallback:
			return {"success": false, "error_code": "UNBOUND_RACE_ID", "unwired_slot": "race_id", "message": "种族标识未接线(UNBOUND)，禁止静默回退默认种族"}
		effective_race = GameConfig.get_string("domains.character_creation", "defaults/default_race_id", "HUMAN")

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

	# 1. 提取并缓存初始模板参数
	var runtime_placeholders := ProloguePlaceholderResolver.extract_placeholders(prologue_context)
	prologue_context.runtime_placeholders = runtime_placeholders

	# 2. 发放初始装备（幂等保护在 Dispatcher 内）
	var kit_result := StarterLoadoutDispatcher.dispatch_starter_kit(prologue_context)

	# 3. 结构化事件列表（事件与状态彻底解耦）
	var structured_mutations: Array[Dictionary] = [
		{"type": "CharacterCreated", "character_id": prologue_context.character_id, "name": prologue_context.character_name},
		{"type": "LocationAssigned", "location_id": prologue_context.assigned_start_location_id},
		{"type": "EquipmentGranted", "kit_id": kit_result.get("kit_id", ""), "gold": kit_result.get("gold", 0)},
		{"type": "DialogueReady", "npc_target": runtime_placeholders.get("NPC_TARGET", "")}
	]

	# 4. 生成第一步事件数据包（阶段配置经 domains.character_creation prologue_stages 驱动）
	var stages_config: Dictionary = GameConfig.get_dict("domains.character_creation", "prologue_stages", {})
	var stage1_config: Dictionary = stages_config.get("1", {})
	var stage1_key := str(stage1_config.get("narrative_key", "narrative/prologue/awakening"))
	var template := GameConfig.get_string(
		"narratives.prologue_i18n", stage1_key,
		"【苏醒】晨曦降临，开拓者 {PLAYER_NAME} 缓缓睁开双眼……"
	)
	var text_result := ProloguePlaceholderResolver.resolve_template(template, prologue_context.runtime_placeholders)

	var packet := PrologueEventPacketDTO.new()
	packet.account_id = prologue_context.account_id
	packet.character_id = prologue_context.character_id
	packet.character_name = prologue_context.character_name
	packet.current_stage = 1
	packet.step_index = 0
	packet.narrative_text = text_result.get("text", "")
	packet.available_actions = _to_string_array(stage1_config.get("available_actions", ["WAKE_UP", "NEXT"]))
	packet.reserved_payload = {"mutations": structured_mutations}

	return {"success": true, "context": prologue_context, "packet": packet, "kit": kit_result}

# ==============================================================================
# 二、配置驱动单向阶段流转（Stage 1 -> 2 -> 3 -> 4 完整流程完结）
# ==============================================================================

## 推进角色序章单向阶段流转（阶段表由 domains.character_creation prologue_stages 配置驱动）。
static func advance_prologue_step(
	prologue_context: CharacterPrologueContext,
	action: String = "NEXT",
	action_payload: Dictionary = {}
) -> Dictionary:
	if prologue_context == null:
		return {"success": false, "error_code": "NULL_CONTEXT", "message": "序章上下文为空"}
	if prologue_context.is_completed:
		return {"success": false, "error_code": "PROLOGUE_ALREADY_COMPLETED", "message": "该角色序章已完结"}
	if not prologue_context.is_active:
		return {"success": false, "error_code": "INACTIVE_CONTEXT", "message": "序章上下文未激活"}

	for payload_key in action_payload.keys():
		prologue_context.runtime_placeholders[payload_key] = action_payload[payload_key]

	prologue_context.current_stage += 1
	prologue_context.step_index += 1

	var stages_config: Dictionary = GameConfig.get_dict("domains.character_creation", "prologue_stages", {})
	var stage_key := str(mini(prologue_context.current_stage, 4))
	var stage_definition: Dictionary = stages_config.get(stage_key, stages_config.get("4", {}))
	var is_terminal := bool(stage_definition.get("is_terminal", prologue_context.current_stage >= 4))
	if is_terminal:
		prologue_context.current_stage = int(stage_key)
		prologue_context.is_completed = true
		prologue_context.is_active = false

	var stage_narrative_key := str(stage_definition.get("narrative_key", "narrative/prologue/completed"))
	var available_actions := _to_string_array(stage_definition.get("available_actions", ["ENTER_WORLD"]))
	var mutations := _build_stage_mutations(prologue_context, str(stage_definition.get("mutation_type", "PrologueCompleted")), action)

	var template := GameConfig.get_string("narratives.prologue_i18n", stage_narrative_key, "")
	var text_result := ProloguePlaceholderResolver.resolve_template(template, prologue_context.runtime_placeholders)

	var packet := PrologueEventPacketDTO.new()
	packet.account_id = prologue_context.account_id
	packet.character_id = prologue_context.character_id
	packet.character_name = prologue_context.character_name
	packet.current_stage = prologue_context.current_stage
	packet.step_index = prologue_context.step_index
	packet.narrative_text = text_result.get("text", "")
	packet.available_actions = available_actions
	packet.reserved_payload = {"mutations": mutations}

	broadcast_step(packet, stage_narrative_key, prologue_context.runtime_placeholders)
	if prologue_context.is_completed:
		var creation_hooks: Dictionary = GameConfig.get_dict("domains.character_creation", "creation_hooks", {})
		EventBusCore.get_instance().emit_domain_event("prologue.completed", {
			"account_id": prologue_context.account_id,
			"character_id": prologue_context.character_id,
			"race_id": prologue_context.race_id,
			"configured_hooks": creation_hooks.get("on_prologue_completed", [])
		})

	return {
		"success": true,
		"context": prologue_context,
		"packet": packet,
		"is_completed": prologue_context.is_completed
	}


static func _to_string_array(raw_value: Variant) -> Array[String]:
	var string_items: Array[String] = []
	if raw_value is Array:
		for raw_entry in raw_value:
			string_items.append(str(raw_entry))
	return string_items


static func _build_stage_mutations(prologue_context: CharacterPrologueContext, mutation_type: String, action: String) -> Array[Dictionary]:
	var mutations: Array[Dictionary] = []
	if mutation_type == "EnvironmentExplored":
		mutations.append({"type": "EnvironmentExplored", "location": prologue_context.assigned_start_location_id, "action": action})
	elif mutation_type == "DialogueTriggered":
		mutations.append({"type": "DialogueTriggered", "npc": prologue_context.runtime_placeholders.get("NPC_TARGET", "UNBOUND_NPC"), "action": action})
	else:
		mutations.append({"type": mutation_type, "character_id": prologue_context.character_id, "step_index": prologue_context.step_index})
	return mutations

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
	if not node.choices.is_empty():
		for choice_entry in node.choices:
			var action_name: String = str(choice_entry.get("action", choice_entry.get("choice_id", choice_entry.get("id", "")))).strip_edges()
			if not action_name.is_empty():
				actions.append(action_name)
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
		"node_id": node.node_id,
		"node_type": node.node_type,
		"choices": node.choices.duplicate(true),
		"mutations": node.mutations_on_complete.duplicate(true)
	}
	return packet

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

	var effective_race: String = str(config.get("race_id", reincarnation_result.get("race_id", "HUMAN")))
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
	prologue_context.assigned_start_location_id = str(reincarnation_result.get("birth_region_id", "CENTRAL_CONTINENT"))
	prologue_context.assigned_starter_kit_id = str(reincarnation_result.get("starter_kit_id", loadout_result.get("kit_id", "")))
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
	while not prologue_context.is_completed and safety_steps < 8:
		safety_steps += 1
		last_step_result = advance_prologue_step(prologue_context, "NEXT", empty_step_payload)
		if not bool(last_step_result.get("success", false)):
			break

	prologue_context.is_completed = true
	prologue_context.is_active = false

	var handoff := PrologueHandoffDTO.new()
	handoff.account_id = prologue_context.account_id
	handoff.character_id = prologue_context.character_id
	handoff.character_name = prologue_context.character_name
	handoff.race_id = prologue_context.race_id if not prologue_context.race_id.is_empty() else "HUMAN"
	handoff.origin_id = str(prologue_context.runtime_placeholders.get("ORIGIN_ID", prologue_context.runtime_placeholders.get("origin_id", "")))
	handoff.assigned_start_location_id = prologue_context.assigned_start_location_id if not prologue_context.assigned_start_location_id.is_empty() else "CENTRAL_CONTINENT"
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
			# 初始物品移交仅在开局执行一次，提前在循环外整表深拷贝以避免逐项分配
			var cloned_storage: Array = (storage_array as Array).duplicate(true)
			for entry in cloned_storage:
				if entry is Dictionary:
					collected_items.append(entry)
		var equipped_map: Variant = inventory_payload.get("equipped_payloads", {})
		if equipped_map is Dictionary:
			for slot_key in equipped_map.keys():
				if equipped_map[slot_key] != null:
					collected_items.append(_make_inventory_handoff_entry(slot_key, equipped_map[slot_key]))
		return
	for inventory_key in inventory_payload.keys():
		collected_items.append(_make_inventory_handoff_entry(inventory_key, inventory_payload[inventory_key]))

static func _make_inventory_handoff_entry(inventory_key: Variant, item_payload: Variant) -> Dictionary:
	return {"item_id": inventory_key, "data": item_payload}

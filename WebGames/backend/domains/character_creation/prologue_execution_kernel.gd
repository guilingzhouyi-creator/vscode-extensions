# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/character_creation/prologue_execution_kernel.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/character_creation.json | 信号: EventBus 领域广播
# 职责说明: 承接 OpeningEventStreamDTO 编排角色专属序章启动：构建上下文、 提取并缓存初始占位符、发放新手装备、推进四阶段剧情状态跃迁、生成结构化突变事件流 （CharacterCreated / LocationAssigned / EquipmentGranted / DialogueReady / PrologueCompleted） 与首步/后继事件包。事件与状态解耦——仅产出纯结构化结果，不指示前端页面。 无缝衔接 通用因果 DAG 编排引擎会话。 关联细则: 阶段2 §四（序章执行内核与状态解耦）与 协作契约
# 设计依据: 业务域第一性原理 / Phase 02 施工细则规范
# ==============================================================================

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
## 契约：ctx 为空或该种族无对应 DAG 时返回 null（调用方判空降级为顺序推进）。
static func create_dag_session(ctx: CharacterPrologueContext) -> NarrativeDagExecutionEngine:
	if ctx == null:
		return null
	var dag := PrologueDagRegistry.resolve_prologue_dag(ctx.race_id)
	if dag == null:
		return null
	var engine := NarrativeDagExecutionEngine.new()
	engine.initialize_with_graph(dag, ctx.runtime_placeholders)
	return engine

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

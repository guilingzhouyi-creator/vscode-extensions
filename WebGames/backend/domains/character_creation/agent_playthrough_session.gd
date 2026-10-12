# ==============================================================================
# 模块归属: 业务领域层 (Domains · 角色创建集群 (Character Creation))
# 文件路径: res://backend/domains/character_creation/agent_playthrough_session.gd
# 架构定位: Domain Workflow Controller / Playthrough Session
# 跨域依赖: 上游: Gateway, ModWorkbenchView | 下游: NarrativeDagExecutionEngine, PrologueExecutionKernel, CompanionObserverBus, CompanionBlackboxRecorder | 配置: config/domains/character_creation/core.json | 信号: CompanionObserverBus
# 职责说明: 长程交互式推演会话控制器；编排模组预检适配、身世权威解算、装备物理水化与因果 DAG 逐步推演，维护历史快照调用栈（支持确定性无损回滚与分支跳转），向伴侣总线广播生命周期事件并输出标准观测包。
# 设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

class_name AgentPlaythroughSession
extends RefCounted

# ==============================================================================
# 一、会话运行时状态字段
# ==============================================================================

var session_id: String = ""
var step_index: int = 0
var engine: NarrativeDagExecutionEngine = null
var ctx: CharacterPrologueContext = null
var profile: CharacterProfile = null
var adapted_manifest: Dictionary = {}
var is_terminal: bool = false
var history_stack: Array[Dictionary] = []

# ==============================================================================
# 二、推演启动核心入口 (Start Session)
# ==============================================================================

## 启动长程交互式推演会话：加载模组、权威解算、物理水化、初始化DAG并产出首步观测包
func start_session(config: Dictionary) -> Dictionary:
	session_id = _prepare_session_id(config)
	step_index = 0
	is_terminal = false
	history_stack.clear()

	# 1. 预检并加载候选包
	var manifest_res := _resolve_mod_manifest(config)
	if not bool(manifest_res.get("success", false)):
		is_terminal = true
		var err_code: String = str(manifest_res.get("error_code", "ERR_MOD_PRECHECK_FAILED"))
		CompanionBlackboxRecorder.create_diagnostic_dump(err_code, "", "", {
			"config": config,
			"manifest_res": manifest_res
		})
		return _build_error_observation(err_code)
	adapted_manifest = manifest_res.get("adapted_manifest", {})

	# 2. 权威身世解算
	var req := _build_creation_request(config)
	var solve_res: Dictionary = AuthoritativeReincarnationSolver.resolve_reincarnation_package(
		req, req.request_seed, adapted_manifest
	)
	if not bool(solve_res.get("success", false)):
		is_terminal = true
		var err_code: String = str(solve_res.get("error_code", "REINCARNATION_FAILED"))
		CompanionBlackboxRecorder.create_diagnostic_dump(err_code, "", "", {
			"req": req.to_dto(),
			"solve_res": solve_res
		})
		return _build_error_observation(err_code)

	# 3. 角色档案构建与新手套件发放
	profile = _build_character_profile(solve_res, req)
	var race_id: String = str(solve_res.get("race_id", "HUMAN"))
	var origin_id: String = str(solve_res.get("origin_id", ""))
	StarterLoadoutDispatcher.hydrate_starter_loadout_into_profile(profile, race_id, origin_id, adapted_manifest)

	# 4. 初始化序章上下文与双轨占位符
	ctx = _build_prologue_context(solve_res, profile, req)
	var ph: Dictionary = ProloguePlaceholderResolver.extract_placeholders(ctx, adapted_manifest, profile)
	for k in ph.keys():
		ctx.runtime_placeholders[k] = ph[k]

	# 5. 构建通用因果 DAG 会话
	engine = PrologueExecutionKernel.create_dag_session(ctx, origin_id, adapted_manifest)
	if engine == null:
		is_terminal = true
		var err_code := "DAG_NOT_FOUND"
		CompanionBlackboxRecorder.create_diagnostic_dump(err_code, "", "", {
			"race_id": ctx.race_id,
			"origin_id": origin_id,
			"profile": profile.serialize()
		})
		return _build_error_observation(err_code)

	is_terminal = engine.is_terminated
	_record_history_snapshot()

	# 6. 广播会话启动事件
	var bus := CompanionObserverBus.get_instance()
	if bus != null:
		bus.broadcast_event("session_started", {
			"session_id": session_id,
			"step_index": step_index,
			"current_node_id": _get_active_node_id(),
			"character_name": ctx.character_name,
			"race_id": ctx.race_id,
			"origin_id": origin_id
		})

	return get_current_observation()

# ==============================================================================
# 三、推演步进核心入口 (Step)
# ==============================================================================

## 推进推演单步：校验分支合法性、执行节点动作、应用突变、压栈快照并广播事件
func step(action: Dictionary) -> Dictionary:
	var act_type: String = str(action.get("action_type", "")).to_upper()
	var choice_id: String = str(action.get("choice_id", action.get("action", ""))).strip_edges()

	if act_type == "ROLLBACK" or choice_id.to_upper() == "ROLLBACK":
		return rollback()

	if act_type == "QUIT" or choice_id.to_upper() == "QUIT":
		is_terminal = true
		var bus := CompanionObserverBus.get_instance()
		if bus != null:
			bus.broadcast_event("session_quit", {
				"session_id": session_id,
				"step_index": step_index
			})
		return get_current_observation()

	if is_terminal:
		return _build_error_observation("SESSION_ALREADY_TERMINAL")

	if engine == null or engine.graph == null:
		return _build_error_observation("ENGINE_NOT_INITIALIZED")

	var active_nid := _get_active_node_id()
	if active_nid.is_empty():
		is_terminal = true
		return _build_error_observation("NO_ACTIVE_NODE")

	var current_node: NarrativeDAGNode = engine.graph.nodes.get(active_nid)
	if current_node == null:
		is_terminal = true
		var err_code := "NODE_NOT_FOUND"
		CompanionBlackboxRecorder.create_diagnostic_dump(err_code, "", active_nid, {
			"session_id": session_id,
			"step_index": step_index
		})
		return _build_error_observation(err_code)

	if not _validate_choice_legality(current_node, choice_id):
		var err_code := "INVALID_CHOICE"
		CompanionBlackboxRecorder.create_diagnostic_dump(err_code, "", active_nid, {
			"session_id": session_id,
			"attempted_choice": choice_id,
			"available_choices": current_node.choices
		})
		return _build_error_observation(err_code)

	var action_payload: Dictionary = {}
	var raw_params: Variant = action.get("params", {})
	if raw_params is Dictionary:
		action_payload = (raw_params as Dictionary).duplicate(true)
	action_payload["selected_choice"] = choice_id

	var exec_res: Dictionary = engine.execute_node_action(active_nid, action_payload)
	if not bool(exec_res.get("success", false)):
		var err_code: String = str(exec_res.get("error_code", "EXECUTION_FAILED"))
		CompanionBlackboxRecorder.create_diagnostic_dump(err_code, "", active_nid, {
			"session_id": session_id,
			"step_index": step_index,
			"action_payload": action_payload,
			"exec_res": exec_res
		})
		return _build_error_observation(err_code)

	var mutations: Array = exec_res.get("mutations", [])
	if not mutations.is_empty():
		PrologueExecutionKernel.apply_dag_mutations(mutations, ctx, profile)

	step_index += 1
	is_terminal = engine.is_terminated or (ctx != null and ctx.is_completed) or _is_current_node_terminal()

	_record_history_snapshot(choice_id)

	var bus := CompanionObserverBus.get_instance()
	if bus != null:
		bus.broadcast_event("step_advanced", {
			"session_id": session_id,
			"step_index": step_index,
			"node_id": _get_active_node_id(),
			"choice_id": choice_id,
			"is_terminal": is_terminal
		})

	return get_current_observation()

# ==============================================================================
# 四、回滚核心入口 (Rollback)
# ==============================================================================

## 回滚至上一历史状态（栈深 > 1 时弹出栈顶并恢复上一快照）
func rollback() -> Dictionary:
	if history_stack.size() <= 1:
		var cur := get_current_observation()
		cur["error_code"] = "CANNOT_ROLLBACK_INITIAL_STEP"
		return cur

	history_stack.pop_back()
	var prev_snap: Dictionary = history_stack[history_stack.size() - 1]
	_restore_from_snapshot(prev_snap)

	var bus := CompanionObserverBus.get_instance()
	if bus != null:
		bus.broadcast_event("step_rollbacked", {
			"session_id": session_id,
			"step_index": step_index,
			"current_node_id": _get_active_node_id()
		})

	return get_current_observation()

# ==============================================================================
# 五、观测与摘要呈现 (Observation & Summary Transcript)
# ==============================================================================

## 获取当前步骤观测包字典
func get_current_observation() -> Dictionary:
	var packet := AgentObservationPacketDTO.new()
	packet.session_id = session_id
	packet.step_index = step_index
	packet.is_terminal = is_terminal

	if engine == null or engine.graph == null:
		return packet.to_dto()

	var active_nid := _get_active_node_id()
	packet.current_node_id = active_nid

	if not active_nid.is_empty() and engine.graph.nodes.has(active_nid):
		var node: NarrativeDAGNode = engine.graph.nodes[active_nid]
		var ph: Dictionary = ctx.runtime_placeholders if ctx != null else {}
		var text_res := ProloguePlaceholderResolver.resolve_narrative_key(
			node.narrative_key,
			ph,
			adapted_manifest,
			node.inline_text
		)
		packet.hydrated_text = str(text_res.get("text", ""))
		packet.available_choices = _extract_choices_for_node(node)
	elif is_terminal:
		packet.hydrated_text = "序章推演已完结"
		packet.available_choices = [{
			"choice_id": "ENTER_WORLD",
			"text": "进入世界",
			"action": "ENTER_WORLD",
			"target_node_id": ""
		}]

	if profile != null:
		packet.character_snapshot = _build_character_snapshot()

	return packet.to_dto()

## 获取推演会话完整文字记录与状态摘要
func get_summary_transcript() -> Dictionary:
	var transcript_steps: Array[Dictionary] = []
	for snap in history_stack:
		transcript_steps.append({
			"step_index": snap.get("step_index", 0),
			"node_id": snap.get("active_node_id", ""),
			"chosen_action": snap.get("chosen_action", "")
		})

	var completed: Array[String] = []
	if engine != null:
		for nid in engine.completed_node_ids:
			completed.append(str(nid))

	return {
		"session_id": session_id,
		"step_index": step_index,
		"is_terminal": is_terminal,
		"total_history_depth": history_stack.size(),
		"completed_node_ids": completed,
		"transcript_steps": transcript_steps,
		"character_snapshot": profile.serialize() if profile != null else {}
	}

# ==============================================================================
# 六、辅助方法 (CC <= 8, Depth <= 2, ADV-PRF-002)
# ==============================================================================

func _prepare_session_id(config: Dictionary) -> String:
	var sid: String = str(config.get("session_id", "")).strip_edges()
	if not sid.is_empty():
		return sid
	return "sess_%d_%d" % [int(Time.get_unix_time_from_system()), int(Time.get_ticks_usec()) % 1000000]

func _resolve_mod_manifest(config: Dictionary) -> Dictionary:
	if config.has("adapted_manifest"):
		var raw_man: Variant = config.get("adapted_manifest")
		if raw_man is Dictionary and not (raw_man as Dictionary).is_empty():
			return {
				"success": true,
				"adapted_manifest": (raw_man as Dictionary).duplicate(true)
			}

	var cand_packs: Array = config.get("candidate_packs", [])
	var enabled_ids: Array = config.get("enabled_pack_ids", ["*"])
	return ModPrecheckAndAdaptationSolver.precheck_and_adapt_mod_list(cand_packs, enabled_ids)

func _build_creation_request(config: Dictionary) -> AuthoritativeCharacterCreationRequestDTO:
	if config.get("request") is AuthoritativeCharacterCreationRequestDTO:
		return config.get("request")
	var req := AuthoritativeCharacterCreationRequestDTO.new()
	req.account_id = str(config.get("account_id", "agent_account"))
	req.slot_id = int(config.get("slot_id", 0))
	req.world_id = str(config.get("world_id", "default_world"))
	req.character_name = str(config.get("character_name", "Hero"))
	req.request_seed = int(config.get("request_seed", config.get("seed", 0)))
	var raw_extra: Variant = config.get("extra_custom_fields", {})
	if raw_extra is Dictionary:
		req.extra_custom_fields = (raw_extra as Dictionary).duplicate(true)
	return req

func _build_character_profile(solve_res: Dictionary, req: AuthoritativeCharacterCreationRequestDTO) -> CharacterProfile:
	var prof := CharacterProfile.new()
	prof.character_id = "char_" + session_id
	prof.character_name = str(solve_res.get("character_name", req.character_name))
	var attrs: Variant = solve_res.get("attributes", {})
	if attrs is Dictionary:
		prof.attributes = (attrs as Dictionary).duplicate(true)
	var wallet: Variant = solve_res.get("wallet", {})
	if wallet is Dictionary:
		prof.personal_resources = (wallet as Dictionary).duplicate(true)
	return prof

func _build_prologue_context(solve_res: Dictionary, prof: CharacterProfile, req: AuthoritativeCharacterCreationRequestDTO) -> CharacterPrologueContext:
	var c := CharacterPrologueContext.new()
	c.account_id = req.account_id
	c.character_id = prof.character_id
	c.character_name = prof.character_name
	c.race_id = str(solve_res.get("race_id", "HUMAN"))
	c.gender = str(solve_res.get("gender", "OTHER"))
	c.assigned_start_location_id = str(solve_res.get("birth_region_id", "CENTRAL_CONTINENT"))
	c.assigned_starter_kit_id = str(solve_res.get("starter_kit_id", ""))
	c.created_timestamp_utc = int(Time.get_unix_time_from_system())
	c.is_active = true
	c.current_stage = 1
	c.step_index = 0

	var origin_id: String = str(solve_res.get("origin_id", ""))
	c.runtime_placeholders["ORIGIN_ID"] = origin_id
	c.runtime_placeholders["origin_id"] = origin_id
	c.runtime_placeholders["ORIGIN_NAME"] = str(solve_res.get("origin_name", origin_id))
	c.runtime_placeholders["TRAIT_SUMMARY"] = _build_trait_summary(solve_res.get("traits_details", []))
	return c

func _build_trait_summary(traits_details: Variant) -> String:
	if not (traits_details is Array):
		return ""
	var names: Array[String] = []
	for item in (traits_details as Array):
		if item is Dictionary:
			var tname: String = str((item as Dictionary).get("name", "")).strip_edges()
			if not tname.is_empty():
				names.append(tname)
	return " / ".join(names)

func _validate_choice_legality(node: NarrativeDAGNode, choice_id: String) -> bool:
	if node.choices.is_empty():
		return true
	if choice_id.is_empty():
		return false
	for c in node.choices:
		var cid: String = str(c.get("choice_id", c.get("id", c.get("action", "")))).strip_edges()
		if cid == choice_id:
			return true
		var target_nid: String = str(c.get("target_node_id", "")).strip_edges()
		if not target_nid.is_empty() and target_nid == choice_id:
			return true
	return false

func _extract_choices_for_node(node: NarrativeDAGNode) -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	if not node.choices.is_empty():
		for c in node.choices:
			var cid: String = str(c.get("choice_id", c.get("id", c.get("action", "")))).strip_edges()
			var txt: String = str(c.get("text", c.get("desc", cid)))
			out.append({
				"choice_id": cid,
				"text": txt,
				"action": cid,
				"target_node_id": str(c.get("target_node_id", ""))
			})
		return out

	if node.node_type == NarrativeDAGNode.NodeType.TERMINAL_EXIT or is_terminal:
		out.append({
			"choice_id": "ENTER_WORLD",
			"text": "进入世界",
			"action": "ENTER_WORLD",
			"target_node_id": ""
		})
	else:
		out.append({
			"choice_id": "NEXT",
			"text": "继续",
			"action": "NEXT",
			"target_node_id": ""
		})
	return out

func _build_character_snapshot() -> Dictionary:
	if profile == null:
		return {}
	return {
		"character_id": profile.character_id,
		"character_name": profile.character_name,
		"race_id": ctx.race_id if ctx != null else "",
		"origin_id": str(ctx.runtime_placeholders.get("ORIGIN_ID", "")) if ctx != null else "",
		"attributes": profile.attributes.duplicate(true),
		"personal_resources": profile.personal_resources.duplicate(true),
		"inventory": profile.inventory.duplicate(true),
		"equipment": profile.equipment.duplicate(true)
	}

func _build_error_observation(err_code: String) -> Dictionary:
	var packet := AgentObservationPacketDTO.new()
	packet.session_id = session_id
	packet.step_index = step_index
	packet.current_node_id = _get_active_node_id()
	packet.is_terminal = is_terminal
	packet.error_code = err_code
	if profile != null:
		packet.character_snapshot = _build_character_snapshot()
	return packet.to_dto()

func _record_history_snapshot(chosen_action: String = "") -> void:
	var snap: Dictionary = {
		"step_index": step_index,
		"is_terminal": is_terminal,
		"chosen_action": chosen_action,
		"active_node_id": _get_active_node_id(),
		"engine_dto": engine.export_session_dto() if engine != null else null,
		"ctx_dto": ctx.to_dto() if ctx != null else {},
		"profile_dto": profile.serialize() if profile != null else {}
	}
	history_stack.append(snap)

func _restore_from_snapshot(snap: Dictionary) -> void:
	step_index = int(snap.get("step_index", 0))
	is_terminal = bool(snap.get("is_terminal", false))

	if engine != null and engine.graph != null and snap.get("engine_dto") != null:
		engine.restore_session_dto(snap.get("engine_dto"), engine.graph)

	if snap.has("ctx_dto") and ctx != null:
		var raw_ctx: Variant = snap.get("ctx_dto")
		if raw_ctx is Dictionary:
			ctx = CharacterPrologueContext.from_dto(raw_ctx as Dictionary)

	if snap.has("profile_dto") and profile != null:
		var raw_prof: Variant = snap.get("profile_dto")
		if raw_prof is Dictionary:
			profile = CharacterProfile.deserialize(raw_prof as Dictionary)

func _is_current_node_terminal() -> bool:
	if engine == null or engine.graph == null:
		return true
	var nid := _get_active_node_id()
	if nid.is_empty():
		return true
	if nid == engine.graph.terminal_node_id:
		return true
	var node: NarrativeDAGNode = engine.graph.nodes.get(nid)
	if node != null and node.node_type == NarrativeDAGNode.NodeType.TERMINAL_EXIT:
		return true
	return false

func _get_active_node_id() -> String:
	if engine == null or engine.active_node_ids.is_empty():
		return ""
	return engine.active_node_ids[0]

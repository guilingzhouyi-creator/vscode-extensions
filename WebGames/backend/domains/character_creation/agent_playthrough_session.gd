# ==============================================================================
# 模块归属: 业务领域层 (Domains · 角色创建集群 (Character Creation))
# 文件路径: res://backend/domains/character_creation/agent_playthrough_session.gd
# 架构定位: Domain Workflow Controller / Playthrough Session
# 依赖与触发: 上游: Gateway, ModWorkbenchView | 下游: NarrativeDagExecutionEngine, PrologueExecutionKernel, CompanionObserverBus, CompanionBlackboxRecorder | 配置: config/domains/character_creation/core.json | 信号: CompanionObserverBus
# 职责说明: 长程交互式推演会话控制器；编排模组预检适配、身世权威解算、装备实体装配与因果 DAG 逐步推演，维护历史快照调用栈（支持确定性无损回滚与分支跳转），向伴侣总线广播生命周期事件并输出标准观测包。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## AgentPlaythroughSession：Domain Workflow Controller / Playthrough Session
class_name AgentPlaythroughSession
extends RefCounted

# ==============================================================================
# 一、会话运行时状态字段
# ==============================================================================

var session_id: String = ""
var step_index: int = 0
var engine: NarrativeDagExecutionEngine = null
var prologue_context: CharacterPrologueContext = null
var profile: CharacterProfile = null
var adapted_manifest: Dictionary = {}
var is_terminal: bool = false
var history_stack: Array[Dictionary] = []
var last_diagnostic_dump: Dictionary = {}

# ==============================================================================
# 二、推演启动核心入口 (Start Session)
# ==============================================================================

## 启动长程交互式推演会话：加载模组、权威解算、装备装配、初始化DAG并产出首步观测包
func start_session(config: Dictionary) -> Dictionary:
	session_id = AgentPlaythroughSessionFactory.prepare_session_id(config)
	step_index = 0
	is_terminal = false
	history_stack.clear()
	last_diagnostic_dump.clear()

	# 1. 预检并加载候选包
	var manifest_result := AgentPlaythroughSessionFactory.resolve_mod_manifest(config)
	if not bool(manifest_result.get("success", false)):
		is_terminal = true
		var error_code: String = str(manifest_result.get("error_code", "ERR_MOD_PRECHECK_FAILED"))
		last_diagnostic_dump = CompanionBlackboxRecorder.create_diagnostic_dump(error_code, "", "", {
			"config": config,
			"manifest_res": manifest_result
		})
		_notify_diagnostic_dump(error_code)
		return _build_error_observation(error_code)
	adapted_manifest = manifest_result.get("adapted_manifest", {})

	# 2. 权威身世解算
	var creation_request := AgentPlaythroughSessionFactory.build_creation_request(config)
	var solve_result: Dictionary = AuthoritativeReincarnationSolver.resolve_reincarnation_package(
		creation_request, creation_request.request_seed, adapted_manifest
	)
	if not bool(solve_result.get("success", false)):
		is_terminal = true
		var error_code: String = str(solve_result.get("error_code", "REINCARNATION_FAILED"))
		last_diagnostic_dump = CompanionBlackboxRecorder.create_diagnostic_dump(error_code, "", "", {
			"req": creation_request.to_dto(),
			"solve_res": solve_result
		})
		_notify_diagnostic_dump(error_code)
		return _build_error_observation(error_code)

	# 3. 角色档案构建与新手套件发放
	profile = AgentPlaythroughSessionFactory.build_character_profile(session_id, solve_result, creation_request)
	var race_id: String = str(solve_result.get("race_id", ""))
	var origin_id: String = str(solve_result.get("origin_id", ""))
	StarterLoadoutDispatcher.hydrate_starter_loadout_into_profile(profile, race_id, origin_id, adapted_manifest)

	# 4. 初始化序章上下文与双通道占位符
	prologue_context = AgentPlaythroughSessionFactory.build_prologue_context(solve_result, profile, creation_request)
	var placeholders: Dictionary = ProloguePlaceholderResolver.extract_placeholders(prologue_context, adapted_manifest, profile)
	for placeholder_key in placeholders.keys():
		prologue_context.runtime_placeholders[placeholder_key] = placeholders[placeholder_key]

	# 5. 构建通用因果 DAG 会话
	engine = PrologueExecutionKernel.create_dag_session(prologue_context, origin_id, adapted_manifest)
	if engine == null:
		is_terminal = true
		var error_code := "DAG_NOT_FOUND"
		last_diagnostic_dump = CompanionBlackboxRecorder.create_diagnostic_dump(error_code, "", "", {
			"race_id": prologue_context.race_id,
			"origin_id": origin_id,
			"profile": profile.serialize()
		})
		_notify_diagnostic_dump(error_code)
		return _build_error_observation(error_code)

	is_terminal = engine.is_terminated
	_record_history_snapshot()

	# 6. 广播会话启动事件
	var bus := CompanionObserverBus.get_instance()
	if bus != null:
		bus.broadcast_event("session_started", {
			"session_id": session_id,
			"step_index": step_index,
			"current_node_id": _get_active_node_id(),
			"character_name": prologue_context.character_name,
			"race_id": prologue_context.race_id,
			"origin_id": origin_id
		})

	return get_current_observation()

# ==============================================================================
# 三、推演步进核心入口 (Step)
# ==============================================================================

## 推进推演单步：校验分支合法性、执行节点动作、应用突变、压栈快照并广播事件
func step(action: Dictionary) -> Dictionary:
	var action_type: String = str(action.get("action_type", "")).to_upper()
	var choice_id: String = str(action.get("choice_id", action.get("action", ""))).strip_edges()

	if action_type == "ROLLBACK" or choice_id.to_upper() == "ROLLBACK":
		return rollback()

	if action_type == "QUIT" or choice_id.to_upper() == "QUIT":
		is_terminal = true
		var observer_bus := CompanionObserverBus.get_instance()
		if observer_bus != null:
			observer_bus.broadcast_event("session_quit", {
				"session_id": session_id,
				"step_index": step_index
			})
		return get_current_observation()

	if is_terminal:
		return _build_error_observation("SESSION_ALREADY_TERMINAL")

	if engine == null or engine.graph == null:
		return _build_error_observation("ENGINE_NOT_INITIALIZED")

	var active_node_id := _get_active_node_id()
	if active_node_id.is_empty():
		is_terminal = true
		return _build_error_observation("NO_ACTIVE_NODE")

	var current_node: NarrativeDAGNode = engine.graph.nodes.get(active_node_id)
	if current_node == null:
		is_terminal = true
		var error_code := "NODE_NOT_FOUND"
		last_diagnostic_dump = CompanionBlackboxRecorder.create_diagnostic_dump(error_code, "", active_node_id, {
			"session_id": session_id,
			"step_index": step_index
		})
		_notify_diagnostic_dump(error_code)
		return _build_error_observation(error_code)

	if not _validate_choice_legality(current_node, choice_id):
		var error_code := "INVALID_CHOICE"
		last_diagnostic_dump = CompanionBlackboxRecorder.create_diagnostic_dump(error_code, "", active_node_id, {
			"session_id": session_id,
			"attempted_choice": choice_id,
			"available_choices": current_node.choices
		})
		_notify_diagnostic_dump(error_code)
		return _build_error_observation(error_code)

	var action_payload: Dictionary = {}
	var raw_parameters: Variant = action.get("params", {})
	if raw_parameters is Dictionary:
		action_payload = (raw_parameters as Dictionary).duplicate(true)
	action_payload["selected_choice"] = choice_id

	var execution_result: Dictionary = engine.execute_node_action(active_node_id, action_payload)
	if not bool(execution_result.get("success", false)):
		var error_code: String = str(execution_result.get("error_code", "EXECUTION_FAILED"))
		last_diagnostic_dump = CompanionBlackboxRecorder.create_diagnostic_dump(error_code, "", active_node_id, {
			"session_id": session_id,
			"step_index": step_index,
			"action_payload": action_payload,
			"exec_res": execution_result
		})
		_notify_diagnostic_dump(error_code)
		return _build_error_observation(error_code)

	var mutations: Array = execution_result.get("mutations", [])
	if not mutations.is_empty():
		PrologueExecutionKernel.apply_dag_mutations(mutations, prologue_context, profile)

	step_index += 1
	is_terminal = engine.is_terminated or (prologue_context != null and prologue_context.is_completed) or _is_current_node_terminal()

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
		var current_observation := get_current_observation()
		current_observation["error_code"] = "CANNOT_ROLLBACK_INITIAL_STEP"
		return current_observation

	history_stack.pop_back()
	var previous_snapshot: Dictionary = history_stack[history_stack.size() - 1]
	_restore_from_snapshot(previous_snapshot)

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

	var active_node_id := _get_active_node_id()
	packet.current_node_id = active_node_id

	if not active_node_id.is_empty() and engine.graph.nodes.has(active_node_id):
		var node: NarrativeDAGNode = engine.graph.nodes[active_node_id]
		var placeholders: Dictionary = prologue_context.runtime_placeholders if prologue_context != null else {}
		var text_result := ProloguePlaceholderResolver.resolve_narrative_key(
			node.narrative_key,
			placeholders,
			adapted_manifest,
			node.inline_text
		)
		packet.hydrated_text = str(text_result.get("text", ""))
		packet.available_choices = _extract_choices_for_node(node)
	elif is_terminal:
		var custom_i18n: Dictionary = adapted_manifest.get("custom_i18n", {})
		packet.hydrated_text = str(custom_i18n.get("narrative/prologue/completed", "PROLOGUE_COMPLETED"))
		packet.available_choices = [{
			"choice_id": "ENTER_WORLD",
			"text": str(custom_i18n.get("ui/common/enter_world", "ENTER_WORLD")),
			"action": "ENTER_WORLD",
			"target_node_id": ""
		}]

	if profile != null:
		packet.character_snapshot = _build_character_snapshot()

	return packet.to_dto()

## 获取推演会话完整文字记录与状态摘要
func get_summary_transcript() -> Dictionary:
	var transcript_steps: Array[Dictionary] = []
	for snapshot_entry in history_stack:
		transcript_steps.append({
			"step_index": snapshot_entry.get("step_index", 0),
			"node_id": snapshot_entry.get("active_node_id", ""),
			"chosen_action": snapshot_entry.get("chosen_action", "")
		})

	var completed: Array[String] = []
	if engine != null:
		for node_id in engine.completed_node_ids:
			completed.append(str(node_id))

	return {
		"is_success": true,
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

func _validate_choice_legality(node: NarrativeDAGNode, choice_id: String) -> bool:
	if node.choices.is_empty():
		return true
	if choice_id.is_empty():
		return false
	for choice_entry in node.choices:
		var candidate_choice_id: String = str(choice_entry.get("choice_id", choice_entry.get("id", choice_entry.get("action", "")))).strip_edges()
		if candidate_choice_id == choice_id:
			return true
		var target_node_id: String = str(choice_entry.get("target_node_id", "")).strip_edges()
		if not target_node_id.is_empty() and target_node_id == choice_id:
			return true
	return false

func _extract_choices_for_node(node: NarrativeDAGNode) -> Array[Dictionary]:
	var extracted_choices: Array[Dictionary] = []
	if not node.choices.is_empty():
		for choice_entry in node.choices:
			var resolved_choice_id: String = str(choice_entry.get("choice_id", choice_entry.get("id", choice_entry.get("action", "")))).strip_edges()
			var choice_text: String = str(choice_entry.get("text", choice_entry.get("desc", resolved_choice_id)))
			extracted_choices.append({
				"choice_id": resolved_choice_id,
				"text": choice_text,
				"action": resolved_choice_id,
				"target_node_id": str(choice_entry.get("target_node_id", ""))
			})
		return extracted_choices

	var custom_i18n: Dictionary = adapted_manifest.get("custom_i18n", {})
	if node.node_type == NarrativeDAGNode.NodeType.TERMINAL_EXIT or is_terminal:
		extracted_choices.append({
			"choice_id": "ENTER_WORLD",
			"text": str(custom_i18n.get("ui/common/enter_world", "ENTER_WORLD")),
			"action": "ENTER_WORLD",
			"target_node_id": ""
		})
	else:
		extracted_choices.append({
			"choice_id": "NEXT",
			"text": str(custom_i18n.get("ui/common/continue", "NEXT")),
			"action": "NEXT",
			"target_node_id": ""
		})
	return extracted_choices

func _build_character_snapshot() -> Dictionary:
	if profile == null:
		return {}
	return {
		"character_id": profile.character_id,
		"character_name": profile.character_name,
		"race_id": prologue_context.race_id if prologue_context != null else "",
		"origin_id": str(prologue_context.runtime_placeholders.get("ORIGIN_ID", "")) if prologue_context != null else "",
		"attributes": profile.attributes.duplicate(true),
		"personal_resources": profile.personal_resources.duplicate(true),
		"inventory": profile.inventory.duplicate(true),
		"equipment": profile.equipment.duplicate(true)
	}

func _build_error_observation(error_code: String) -> Dictionary:
	var packet := AgentObservationPacketDTO.new()
	packet.session_id = session_id
	packet.step_index = step_index
	packet.current_node_id = _get_active_node_id()
	packet.is_terminal = is_terminal
	packet.error_code = error_code
	if not last_diagnostic_dump.is_empty():
		packet.diagnostic_dump = last_diagnostic_dump.duplicate(true)
	if profile != null:
		packet.character_snapshot = _build_character_snapshot()
	return packet.to_dto()

func _notify_diagnostic_dump(error_code: String) -> void:
	var bus := CompanionObserverBus.get_instance()
	if bus != null and not last_diagnostic_dump.is_empty():
		bus.broadcast_event("diagnostic_dump_recorded", {
			"session_id": session_id,
			"error_code": error_code,
			"dump": last_diagnostic_dump
		})

func _record_history_snapshot(chosen_action: String = "") -> void:
	var snapshot: Dictionary = {
		"step_index": step_index,
		"is_terminal": is_terminal,
		"chosen_action": chosen_action,
		"active_node_id": _get_active_node_id(),
		"engine_dto": engine.export_session_dto() if engine != null else null,
		"ctx_dto": prologue_context.serialize() if prologue_context != null else {},
		"profile_dto": profile.serialize() if profile != null else {}
	}
	history_stack.append(snapshot)

func _restore_from_snapshot(snapshot: Dictionary) -> void:
	step_index = int(snapshot.get("step_index", 0))
	is_terminal = bool(snapshot.get("is_terminal", false))

	if engine != null and engine.graph != null and snapshot.get("engine_dto") != null:
		engine.restore_session_dto(snapshot.get("engine_dto"), engine.graph)

	if snapshot.has("ctx_dto") and prologue_context != null:
		var raw_context: Variant = snapshot.get("ctx_dto")
		if raw_context is Dictionary:
			prologue_context = CharacterPrologueContext.deserialize(raw_context as Dictionary)

	if snapshot.has("profile_dto") and profile != null:
		var raw_profile: Variant = snapshot.get("profile_dto")
		if raw_profile is Dictionary:
			profile = CharacterProfile.deserialize(raw_profile as Dictionary)

func _is_current_node_terminal() -> bool:
	if engine == null or engine.graph == null:
		return true
	var node_id := _get_active_node_id()
	if node_id.is_empty():
		return true
	if node_id == engine.graph.terminal_node_id:
		return true
	var node: NarrativeDAGNode = engine.graph.nodes.get(node_id)
	if node != null and node.node_type == NarrativeDAGNode.NodeType.TERMINAL_EXIT:
		return true
	return false

func _get_active_node_id() -> String:
	if engine == null or engine.active_node_ids.is_empty():
		return ""
	return engine.active_node_ids[0]

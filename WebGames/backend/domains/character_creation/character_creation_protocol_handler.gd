# ==============================================================================
# 模块归属: 业务领域层 (Domains · 角色创建与序章集群 (Character Creation & Prologue))
# 文件路径: res://backend/domains/character_creation/character_creation_protocol_handler.gd
# 架构定位: Domain Protocol Action Handler
# 依赖与触发: 上游: UnifiedProtocolDispatcher | 下游: WorldCharacterCreationOrchestrator, PrologueExecutionKernel
# 配置与信号: 契约 config/infrastructure/contracts.json
# 职责说明: 承接并解算创角与序章领域客户端协议动作，分发命途轮盘、权威创角、序章启动、推进与完结移交。
# 退出语义与设计依据: 卡拉尔领域第一性原理 (Inv-SESSION-VAULT-3)
# ==============================================================================

## CharacterCreationProtocolHandler：创角与序章客户端协议动作分发处理器
class_name CharacterCreationProtocolHandler
extends RefCounted

const AuthoritativeCharacterCreationRequestDTO = preload("res://backend/domains/character_creation/dto/authoritative_character_creation_request_dto.gd")
const AuthoritativeReincarnationSolver = preload("res://backend/domains/character_creation/authoritative_reincarnation_solver.gd")
const WorldArchiveRepository = preload("res://backend/domains/world_state/world_archive_repository.gd")
const WorldCharacterCreationOrchestrator = preload("res://backend/domains/character_creation/world_character_creation_orchestrator.gd")
const CharacterPrologueContext = preload("res://backend/domains/character_creation/character_prologue_context.gd")
const PrologueExecutionKernel = preload("res://backend/domains/character_creation/prologue_execution_kernel.gd")
const PrologueCutscenePort = preload("res://backend/domains/character_creation/prologue_cutscene_port.gd")
const PrologueHandoffDTO = preload("res://backend/domains/character_creation/dto/prologue_handoff_dto.gd")
const CreationUiSnapshotBuilder = preload("res://backend/domains/character_creation/creation_ui_snapshot_builder.gd")
const WorldSessionRuntimeService = preload("res://backend/domains/world_state/services/world_session_runtime_service.gd")
const UnifiedProtocolFactory = preload("res://backend/domains/world_state/services/unified_protocol_factory.gd")

## 分发角色创建阶段客户端协议动作（UI 快照读取、命途预览摇骰、权威创角）
static func dispatch_creation(request: ClientRequestEnvelopeDTO, gateway: Variant) -> UnifiedResponseEnvelopeDTO:
	var payload_dict: Dictionary = request.payload if request.payload is Dictionary else {}
	var creation_request := AuthoritativeCharacterCreationRequestDTO.new()
	creation_request.account_id = request.account_id
	creation_request.slot_id = maxi(1, int(payload_dict.get("slot_index", 1)))
	var raw_world_id := str(payload_dict.get("world_id", "")).strip_edges()
	if raw_world_id.is_empty() and gateway != null and gateway.context != null:
		raw_world_id = str(gateway.context.selected_world_id).strip_edges()
	creation_request.world_id = raw_world_id
	creation_request.character_name = str(payload_dict.get("character_name", ""))
	creation_request.request_seed = int(payload_dict.get("request_seed", 0))
	if payload_dict.get("extra_custom_fields") is Dictionary:
		creation_request.extra_custom_fields = (payload_dict.get("extra_custom_fields") as Dictionary).duplicate(true)
	for option_key in ["selected_origin_id", "selected_positive_trait", "selected_negative_trait", "reroll_nonce", "gender", "starter_kit_id"]:
		if payload_dict.has(option_key) and not creation_request.extra_custom_fields.has(option_key):
			creation_request.extra_custom_fields[option_key] = payload_dict[option_key]

	match request.action_type:
		"GET_CREATION_UI_SNAPSHOT":
			var ui_snapshot: Dictionary = {}
			if gateway != null and gateway.has_method("get_creation_ui_snapshot"):
				ui_snapshot = gateway.get_creation_ui_snapshot()
			if ui_snapshot.is_empty() and gateway != null:
				var manifest: Dictionary = gateway.get_adapted_mod_manifest()
				ui_snapshot = CreationUiSnapshotBuilder.build_creation_ui_snapshot(manifest, [], [])
			elif ui_snapshot.is_empty():
				ui_snapshot = CreationUiSnapshotBuilder.build_creation_ui_snapshot({}, [], [])
			return UnifiedProtocolFactory.create_response(
				request.request_id, true, {"creation_ui_snapshot": ui_snapshot}, "", "Creation UI snapshot retrieved successfully."
			)

		"ROLL_CHARACTER_PREVIEW":
			var manifest: Dictionary = gateway.get_adapted_mod_manifest() if gateway != null else {}
			var roll_result := AuthoritativeReincarnationSolver.resolve_reincarnation_package(creation_request, creation_request.request_seed, manifest)
			return UnifiedProtocolFactory.create_response(
				request.request_id, bool(roll_result.get("success", false)), roll_result,
				"" if bool(roll_result.get("success", false)) else String(roll_result.get("error_code", "ERR_ROLL_FAILED")),
				"Character destiny preview calculated successfully."
			)

		"CREATE_AUTHORITATIVE_CHARACTER":
			var world_repository := WorldArchiveRepository.get_instance()
			if world_repository != null and not creation_request.world_id.is_empty() and not world_repository.has_world(creation_request.world_id):
				world_repository.create_world(creation_request.world_id, creation_request.world_id, creation_request.request_seed)
			var creation_flow_result := WorldCharacterCreationOrchestrator.execute_creation_and_boot_prologue(
				creation_request, gateway, gateway.get_adapted_mod_manifest() if gateway != null else {}
			)
			if not bool(creation_flow_result.get("success", false)):
				return UnifiedProtocolFactory.create_response(
					request.request_id, false, creation_flow_result, String(creation_flow_result.get("error_code", "ERR_CHARACTER_CREATE_FAILED")), String(creation_flow_result.get("message", "Character creation failed."))
				)
			var prologue_context: CharacterPrologueContext = creation_flow_result.get("prologue_context", null)
			var profile: Variant = creation_flow_result.get("profile", null)
			var bound_slot_name := "SLOT_%02d" % creation_request.slot_id
			WorldSessionRuntimeService.bind_prologue_session(prologue_context, profile)
			if gateway != null and gateway.context != null:
				gateway.context.selected_slot_id = bound_slot_name
			var presentation: Variant = creation_flow_result.get("presentation", null)
			var response_data := {
				"character_id": String(creation_flow_result.get("character_id", "")),
				"character_name": String(creation_flow_result.get("character_name", "")),
				"slot_id": bound_slot_name,
				"world_id": String(creation_flow_result.get("world_id", "")),
				"prologue_started": prologue_context != null,
				"presentation": presentation.to_dto() if (presentation != null and presentation.has_method("to_dto")) else {}
			}
			return UnifiedProtocolFactory.create_response(
				request.request_id, true, response_data, "", "Character creation and prologue initialization completed."
			)

	return UnifiedProtocolFactory.create_unhandled_action_response(request.request_id, request.action_type)

static func _build_prologue_state_payload(prologue_context: CharacterPrologueContext) -> Dictionary:
	var stages_config: Dictionary = GameConfig.get_dict("domains.character_creation", "prologue_stages", {})
	var stage_key := str(clampi(prologue_context.current_stage, 1, 4))
	var stage_definition: Dictionary = stages_config.get(stage_key, stages_config.get("1", {}))
	var narrative_key := str(stage_definition.get("narrative_key", "narrative/prologue/awakening"))
	var template := GameConfig.get_string("narratives.prologue_i18n", narrative_key, "")
	var text_result := ProloguePlaceholderResolver.resolve_template(template, prologue_context.runtime_placeholders)
	return {
		"character_id": prologue_context.character_id,
		"character_name": prologue_context.character_name,
		"current_stage": prologue_context.current_stage,
		"step_index": prologue_context.step_index,
		"is_active": prologue_context.is_active,
		"is_completed": prologue_context.is_completed,
		"narrative_text": str(text_result.get("text", "")),
		"available_actions": stage_definition.get("available_actions", ["NEXT"])
	}

## 分发角色序章阶段客户端协议动作（启动、状态查询、推进、完结/跳过与世界探索交接）
static func dispatch_prologue(request: ClientRequestEnvelopeDTO, gateway: Variant) -> UnifiedResponseEnvelopeDTO:
	var payload_dict: Dictionary = request.payload if request.payload is Dictionary else {}
	var prologue_context := WorldSessionRuntimeService.get_prologue_context() as CharacterPrologueContext
	var profile := WorldSessionRuntimeService.get_character_profile() as CharacterProfile

	match request.action_type:
		"START_PROLOGUE":
			if prologue_context == null:
				return UnifiedProtocolFactory.create_response(
					request.request_id, false, {}, "ERR_NO_PROLOGUE_CONTEXT", "Active prologue context is missing."
				)
			return UnifiedProtocolFactory.create_response(
				request.request_id, true, _build_prologue_state_payload(prologue_context), "", "Prologue session is ready."
			)

		"GET_PROLOGUE_STATE":
			if prologue_context == null:
				return UnifiedProtocolFactory.create_response(
					request.request_id, false, {}, "ERR_NO_PROLOGUE_CONTEXT", "Active prologue context is missing."
				)
			return UnifiedProtocolFactory.create_response(
				request.request_id, true, _build_prologue_state_payload(prologue_context), "", "Prologue state retrieved successfully."
			)

		"ADVANCE_PROLOGUE":
			if prologue_context == null:
				return UnifiedProtocolFactory.create_response(
					request.request_id, false, {}, "ERR_NO_PROLOGUE_CONTEXT", "Active prologue context is missing."
				)
			var step_result := PrologueExecutionKernel.advance_prologue_step(prologue_context, str(payload_dict.get("choice_id", "NEXT")), payload_dict)
			var is_step_ok := bool(step_result.get("success", false))
			var step_packet: Variant = step_result.get("packet", null)
			var step_data := {
				"current_stage": prologue_context.current_stage,
				"step_index": prologue_context.step_index,
				"is_completed": prologue_context.is_completed,
				"packet": step_packet.to_dto() if (step_packet != null and step_packet.has_method("to_dto")) else {}
			}
			return UnifiedProtocolFactory.create_response(
				request.request_id, is_step_ok, step_data,
				"" if is_step_ok else String(step_result.get("error_code", "ERR_PROLOGUE_ADVANCE_FAILED")),
				"Prologue step advanced successfully." if is_step_ok else String(step_result.get("message", "Failed to advance prologue."))
			)

		"COMPLETE_PROLOGUE", "SKIP_PROLOGUE":
			if prologue_context == null:
				return UnifiedProtocolFactory.create_response(
					request.request_id, false, {}, "ERR_NO_PROLOGUE_CONTEXT", "Active prologue context is missing."
				)
			var cutscene_id := str(payload_dict.get("cutscene_id", ""))
			if not cutscene_id.is_empty():
				PrologueCutscenePort.dispatch_cutscene(cutscene_id, request.action_type == "SKIP_PROLOGUE")
			var completion_result := PrologueExecutionKernel.complete_prologue_to_handoff(
				prologue_context,
				profile,
				{
					"extra_attrs": payload_dict.get("extra_attributes", {}) if payload_dict.get("extra_attributes") is Dictionary else {},
					"initial_gold": int(payload_dict.get("initial_gold", -1)),
					"active_mods": gateway.active_mods if gateway != null else [],
				}
			)
			if not bool(completion_result.get("success", false)):
				return UnifiedProtocolFactory.create_response(
					request.request_id, false, completion_result, String(completion_result.get("error_code", "ERR_PROLOGUE_COMPLETE_FAILED")), "Prologue completion failed."
				)
			var handoff: PrologueHandoffDTO = completion_result.get("handoff", null)
			var handoff_result: Dictionary = {}
			if gateway != null:
				handoff_result = gateway.handoff_prologue_to_world_exploration(handoff)
			else:
				var world_snapshot := WorldSessionRuntimeService.activate_world_session({
					"account_id": handoff.account_id,
					"character_id": handoff.character_id,
					"character_name": handoff.character_name,
					"race_id": handoff.race_id,
					"current_location_id": handoff.assigned_start_location_id,
					"wallet_gold": handoff.initial_gold,
					"attribute_values": handoff.allocated_attributes,
					"attribute_levels": handoff.allocated_attributes,
					"character_profile": profile,
					"prologue_context": prologue_context
				}, true)
				handoff_result = {"success": true, "snapshot": world_snapshot}
			var is_handoff_ok := bool(handoff_result.get("success", false))
			var snapshot_object: Variant = handoff_result.get("snapshot", null)
			var snapshot_dict: Dictionary = snapshot_object.to_dto() if (snapshot_object != null and snapshot_object.has_method("to_dto")) else {}
			return UnifiedProtocolFactory.create_response(
				request.request_id, is_handoff_ok, {
					"completed": is_handoff_ok,
					"handoff": handoff.to_dto() if handoff != null else {},
					"initial_hud_snapshot": snapshot_dict
				},
				"" if is_handoff_ok else String(handoff_result.get("error_code", "ERR_PROLOGUE_HANDOFF_FAILED")),
				"Prologue completed and exploration handed off with initial HUD synchronization." if is_handoff_ok else String(handoff_result.get("message", "Prologue handoff failed."))
			)

	return UnifiedProtocolFactory.create_unhandled_action_response(request.request_id, request.action_type)

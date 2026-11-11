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
const WorldSessionRuntimeService = preload("res://backend/domains/world_state/services/world_session_runtime_service.gd")
const UnifiedProtocolFactory = preload("res://backend/domains/world_state/services/unified_protocol_factory.gd")

static func dispatch_creation(request: ClientRequestEnvelopeDTO, gateway: Variant) -> UnifiedResponseEnvelopeDTO:
	var payload_dict: Dictionary = request.payload if request.payload is Dictionary else {}
	var char_req := AuthoritativeCharacterCreationRequestDTO.new()
	char_req.account_id = request.account_id
	char_req.slot_id = maxi(1, int(payload_dict.get("slot_index", 1)))
	char_req.world_id = str(payload_dict.get("world_id", gateway.context.selected_world_id if (gateway != null and gateway.context != null) else ""))
	char_req.character_name = str(payload_dict.get("character_name", ""))
	char_req.request_seed = int(payload_dict.get("request_seed", 20261110))
	if payload_dict.get("extra_custom_fields") is Dictionary:
		char_req.extra_custom_fields = (payload_dict.get("extra_custom_fields") as Dictionary).duplicate(true)

	match request.action_type:
		"ROLL_CHARACTER_PREVIEW":
			var manifest: Dictionary = gateway.get_adapted_mod_manifest() if gateway != null else {}
			var roll_res := AuthoritativeReincarnationSolver.resolve_reincarnation_package(char_req, char_req.request_seed, manifest)
			return UnifiedProtocolFactory.create_response(
				request.request_id, bool(roll_res.get("success", false)), roll_res,
				"" if bool(roll_res.get("success", false)) else String(roll_res.get("error_code", "ERR_ROLL_FAILED")),
				"Character destiny preview calculated successfully."
			)

		"CREATE_AUTHORITATIVE_CHARACTER":
			var world_repo := WorldArchiveRepository.get_instance()
			if world_repo != null and not char_req.world_id.is_empty() and not world_repo.has_world(char_req.world_id):
				world_repo.create_world(char_req.world_id, char_req.world_id, char_req.request_seed)
			var flow_res := WorldCharacterCreationOrchestrator.execute_creation_and_boot_prologue(
				char_req, gateway, gateway.get_adapted_mod_manifest() if gateway != null else {}
			)
			if not bool(flow_res.get("success", false)):
				return UnifiedProtocolFactory.create_response(
					request.request_id, false, flow_res, String(flow_res.get("error_code", "ERR_CHARACTER_CREATE_FAILED")), String(flow_res.get("message", "Character creation failed."))
				)
			var prologue_context: CharacterPrologueContext = flow_res.get("prologue_context", null)
			var profile: Variant = flow_res.get("profile", null)
			var bound_slot_name := "SLOT_%02d" % char_req.slot_id
			WorldSessionRuntimeService.bind_prologue_session(prologue_context, profile)
			if gateway != null and gateway.context != null:
				gateway.context.selected_slot_id = bound_slot_name
			var pres: Variant = flow_res.get("presentation", null)
			var resp_data := {
				"character_id": String(flow_res.get("character_id", "")),
				"character_name": String(flow_res.get("character_name", "")),
				"slot_id": bound_slot_name,
				"world_id": String(flow_res.get("world_id", "")),
				"prologue_started": prologue_context != null,
				"presentation": pres.to_dto() if (pres != null and pres.has_method("to_dto")) else {}
			}
			return UnifiedProtocolFactory.create_response(
				request.request_id, true, resp_data, "", "Character creation and prologue initialization completed."
			)

	return UnifiedProtocolFactory.create_response(
		request.request_id, false, {}, "ERR_UNHANDLED_ACTION",
		TemplateFormatter.format("Unsupported action instruction: {action_type}.", {"action_type": request.action_type})
	)

static func dispatch_prologue(request: ClientRequestEnvelopeDTO, gateway: Variant) -> UnifiedResponseEnvelopeDTO:
	var payload_dict: Dictionary = request.payload if request.payload is Dictionary else {}
	var prologue_ctx := WorldSessionRuntimeService.get_prologue_context() as CharacterPrologueContext
	var profile := WorldSessionRuntimeService.get_character_profile() as CharacterProfile

	match request.action_type:
		"START_PROLOGUE":
			if prologue_ctx == null:
				return UnifiedProtocolFactory.create_response(
					request.request_id, false, {}, "ERR_NO_PROLOGUE_CONTEXT", "Active prologue context is missing."
				)
			return UnifiedProtocolFactory.create_response(
				request.request_id, true, {"character_id": prologue_ctx.character_id, "current_stage": prologue_ctx.current_stage, "is_completed": prologue_ctx.is_completed}, "", "Prologue session is ready."
			)

		"ADVANCE_PROLOGUE":
			if prologue_ctx == null:
				return UnifiedProtocolFactory.create_response(
					request.request_id, false, {}, "ERR_NO_PROLOGUE_CONTEXT", "Active prologue context is missing."
				)
			var step_res := PrologueExecutionKernel.advance_prologue_step(prologue_ctx, str(payload_dict.get("choice_id", "NEXT")), payload_dict)
			return UnifiedProtocolFactory.create_response(
				request.request_id, bool(step_res.get("success", false)), {"current_stage": prologue_ctx.current_stage, "is_completed": prologue_ctx.is_completed}, "", "Prologue step advanced successfully."
			)

		"COMPLETE_PROLOGUE", "SKIP_PROLOGUE":
			if prologue_ctx == null:
				return UnifiedProtocolFactory.create_response(
					request.request_id, false, {}, "ERR_NO_PROLOGUE_CONTEXT", "Active prologue context is missing."
				)
			var cutscene_id := str(payload_dict.get("cutscene_id", ""))
			if not cutscene_id.is_empty():
				PrologueCutscenePort.dispatch_cutscene(cutscene_id, request.action_type == "SKIP_PROLOGUE")
			var done_res := PrologueExecutionKernel.complete_prologue_to_handoff(
				prologue_ctx,
				profile,
				{
					"extra_attrs": payload_dict.get("extra_attributes", {}) if payload_dict.get("extra_attributes") is Dictionary else {},
					"initial_gold": int(payload_dict.get("initial_gold", -1)),
					"active_mods": gateway.active_mods if gateway != null else [],
				}
			)
			if not bool(done_res.get("success", false)):
				return UnifiedProtocolFactory.create_response(
					request.request_id, false, done_res, String(done_res.get("error_code", "ERR_PROLOGUE_COMPLETE_FAILED")), "Prologue completion failed."
				)
			var handoff: PrologueHandoffDTO = done_res.get("handoff", null)
			var handoff_res: Dictionary = {}
			if gateway != null:
				handoff_res = gateway.handoff_prologue_to_world_exploration(handoff)
			else:
				var snap := WorldSessionRuntimeService.activate_world_session({
					"account_id": handoff.account_id,
					"character_id": handoff.character_id,
					"character_name": handoff.character_name,
					"race_id": handoff.race_id,
					"current_location_id": handoff.assigned_start_location_id,
					"wallet_gold": handoff.initial_gold,
					"attribute_values": handoff.allocated_attributes
				}, true)
				handoff_res = {"success": true, "snapshot": snap}
			var snap_obj: Variant = handoff_res.get("snapshot", null)
			var snap_dict: Dictionary = snap_obj.to_dto() if (snap_obj != null and snap_obj.has_method("to_dto")) else {}
			return UnifiedProtocolFactory.create_response(
				request.request_id, bool(handoff_res.get("success", false)), {
					"completed": true,
					"handoff": handoff.to_dto() if handoff != null else {},
					"initial_hud_snapshot": snap_dict
				}, "", "Prologue completed and exploration handed off with initial HUD synchronization."
			)

	return UnifiedProtocolFactory.create_response(
		request.request_id, false, {}, "ERR_UNHANDLED_ACTION",
		TemplateFormatter.format("Unsupported action instruction: {action_type}.", {"action_type": request.action_type})
	)

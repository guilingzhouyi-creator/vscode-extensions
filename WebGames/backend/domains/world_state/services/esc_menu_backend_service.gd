# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群)
# 文件路径: res://backend/domains/world_state/services/esc_menu_backend_service.gd
# 架构定位: Domain Service / Facade Orchestrator
# 依赖与触发: 上游: UnifiedProtocolDispatcher | 下游: SaveReadinessGuard, SaveDataAccessLayer, WorldGatewayFSM, GameLifecycleService
# 职责说明: 集中处理 ESC 菜单各类操作（状态检测、安全存档、退回世界网关重置清理、退出桌面）
# 退出语义与设计依据: 业务服务类；设计依据: 卡拉尔事务级网关重置清理与停机安全契约 (Inv-TRANSACTIONAL-GATEWAY-SCRUB-2)
# ==============================================================================

## EscMenuBackendService：ESC 菜单后端领域服务，提供系统菜单请求处理与事务级状态流转
class_name EscMenuBackendService
extends RefCounted

const SaveReadinessGuard = preload("res://backend/domains/world_state/guards/save_readiness_guard.gd")
const SaveDataAccessLayer = preload("res://backend/domains/persistence_protocol/save_data_access_layer.gd")
const GameLifecycleService = preload("res://backend/domains/lifecycle/game_lifecycle_service.gd")
const GameShutdownDTO = preload("res://backend/domains/lifecycle/dto/game_shutdown_dto.gd")
const GameLifecycleModel = preload("res://backend/domains/lifecycle/game_lifecycle_model.gd")
const UnifiedProtocolFactory = preload("res://backend/domains/world_state/services/unified_protocol_factory.gd")
const ClientRequestEnvelopeDTO = preload("res://backend/domains/world_state/dto/client_request_envelope_dto.gd")
const UnifiedResponseEnvelopeDTO = preload("res://backend/domains/world_state/dto/unified_response_envelope_dto.gd")
const WorldGatewayFSM = preload("res://backend/domains/world_gateway/world_gateway_fsm.gd")
const WorldGatewayModel = preload("res://backend/domains/world_gateway/world_gateway_model.gd")
const HumanControlLeaseManager = preload("res://backend/domains/world_state/services/human_control_lease_manager.gd")
const WorldSessionRuntimeService = preload("res://backend/domains/world_state/services/world_session_runtime_service.gd")
const GameSettingsProtocolHandler = preload("res://backend/domains/game_settings/game_settings_protocol_handler.gd")
const GameLifecycleManager = preload("res://backend/domains/lifecycle/game_lifecycle_manager.gd")

const DOMAIN_WORLD_STATE_CONFIG: String = "domains.world_state"

## 处理用户触发 ESC 快捷菜单时的动作路由
static func handle_esc_action(request: ClientRequestEnvelopeDTO, gateway: WorldGatewayFSM = null) -> UnifiedResponseEnvelopeDTO:
	if request == null:
		return UnifiedProtocolFactory.create_response(
			"", false, {}, "ERR_NULL_REQUEST", "Request envelope cannot be null."
		)

	match request.action_type:
		"ESC_GET_MENU_STATE":
			return _handle_esc_get_menu_state(request, gateway)
		"ESC_QUERY_READINESS":
			return _handle_esc_query_readiness(request)
		"ESC_SAVE_GAME":
			return _handle_esc_save_game(request, gateway)
		"ESC_EXIT_TO_GATEWAY":
			return _handle_esc_exit_to_gateway(request, gateway)
		"ESC_QUIT_GAME":
			return _handle_esc_quit_game(request, gateway)
		"ESC_PAUSE_GAME":
			return _handle_esc_pause_resume(request, true)
		"ESC_RESUME_GAME":
			return _handle_esc_pause_resume(request, false)
		"ESC_APPLY_SETTINGS":
			return GameSettingsProtocolHandler.dispatch(request)

	return UnifiedProtocolFactory.create_response(
		request.request_id, false, {}, "ERR_INVALID_ESC_ACTION",
		TemplateFormatter.format("Unrecognized ESC action: {action_type}.", {"action_type": request.action_type})
	)

static func _handle_esc_get_menu_state(request: ClientRequestEnvelopeDTO, gateway: WorldGatewayFSM) -> UnifiedResponseEnvelopeDTO:
	var runtime_state := WorldSessionRuntimeService.get_esc_menu_state()
	var in_combat: bool = bool(request.payload.get("in_combat", runtime_state.get("in_combat", false)))
	var in_cutscene: bool = bool(request.payload.get("in_cutscene", runtime_state.get("in_cutscene", false)))
	var is_dead: bool = bool(request.payload.get("is_dead", runtime_state.get("is_dead", false)))
	var readiness := SaveReadinessGuard.evaluate_save_readiness(in_combat, in_cutscene, is_dead)
	var menu_state_data := runtime_state.duplicate(true)
	menu_state_data["readiness"] = readiness
	menu_state_data["can_save"] = bool(readiness.get("is_ready", false))
	menu_state_data["effective_slot_id"] = _resolve_effective_slot_id(request, gateway)
	return UnifiedProtocolFactory.create_response(
		request.request_id, true, menu_state_data, "", "Authoritative ESC menu state queried successfully."
	)

static func _handle_esc_query_readiness(request: ClientRequestEnvelopeDTO) -> UnifiedResponseEnvelopeDTO:
	var runtime_state := WorldSessionRuntimeService.get_esc_menu_state()
	var in_combat: bool = bool(request.payload.get("in_combat", runtime_state.get("in_combat", false)))
	var in_cutscene: bool = bool(request.payload.get("in_cutscene", runtime_state.get("in_cutscene", false)))
	var is_dead: bool = bool(request.payload.get("is_dead", runtime_state.get("is_dead", false)))
	var readiness := SaveReadinessGuard.evaluate_save_readiness(in_combat, in_cutscene, is_dead)
	return UnifiedProtocolFactory.create_response(
		request.request_id, true, readiness, "", "Save readiness state evaluated successfully."
	)

static func _validate_save_path_safety(
	request: ClientRequestEnvelopeDTO,
	gateway: WorldGatewayFSM,
	slot_id: String,
	use_request_mode: bool
) -> UnifiedResponseEnvelopeDTO:
	var has_gateway_mode: bool = (gateway != null and gateway.context != null and gateway.context.selected_mode != WorldGatewayModel.GameMode.UNSELECTED)
	var gateway_mode: int = int(gateway.context.selected_mode) if has_gateway_mode else WorldGatewayModel.GameMode.SINGLE_PLAYER
	var mode: int = int(request.payload.get("game_mode", gateway_mode)) if use_request_mode else gateway_mode
	var vault_prefix := GameConfig.get_string(DOMAIN_WORLD_STATE_CONFIG, "storage/offline_vault_prefix", "user://offline_vault/")
	var path_safety := SaveReadinessGuard.evaluate_storage_path_safety("%s%s.sav" % [vault_prefix, slot_id.to_lower()], mode)
	if not bool(path_safety.get("safe", path_safety.get("is_safe", false))):
		return UnifiedProtocolFactory.create_response(
			request.request_id, false, path_safety, "ERR_STORAGE_UNSAFE", "Storage path violates runtime mode isolation policy."
		)
	return null

static func _handle_esc_save_game(request: ClientRequestEnvelopeDTO, gateway: WorldGatewayFSM) -> UnifiedResponseEnvelopeDTO:
	var runtime_state := WorldSessionRuntimeService.get_esc_menu_state()
	var in_combat: bool = bool(request.payload.get("in_combat", runtime_state.get("in_combat", false)))
	var in_cutscene: bool = bool(request.payload.get("in_cutscene", runtime_state.get("in_cutscene", false)))
	var is_dead: bool = bool(request.payload.get("is_dead", runtime_state.get("is_dead", false)))
	var readiness := SaveReadinessGuard.evaluate_save_readiness(in_combat, in_cutscene, is_dead)
	if not bool(readiness.get("is_ready", false)):
		return UnifiedProtocolFactory.create_response(
			request.request_id, false, readiness, "ERR_SAVE_GUARD_BLOCKED", "Save operation is blocked by readiness guard."
		)

	var slot_id := _resolve_effective_slot_id(request, gateway)
	if slot_id.is_empty():
		return UnifiedProtocolFactory.create_response(
			request.request_id, false, {}, "ERR_UNBOUND_SAVE_SLOT", "No valid save slot is bound; save operation rejected."
		)

	var unsafe_response := _validate_save_path_safety(request, gateway, slot_id, true)
	if unsafe_response != null:
		return unsafe_response

	var game_data := _resolve_save_payload(request)
	if game_data.is_empty():
		var incomplete_save_error_code := GameConfig.get_string(DOMAIN_WORLD_STATE_CONFIG, "esc_menu/errors/incomplete_save_blocked", "ERR_INCOMPLETE_SAVE_BLOCKED")
		if bool(request.payload.get("strict_full_save", false)) or _has_existing_full_domain_save(slot_id):
			return UnifiedProtocolFactory.create_response(
				request.request_id, false, {"slot_id": slot_id}, incomplete_save_error_code, "Overwriting existing world save with incomplete payload shell is strictly forbidden."
			)
		game_data = {
			"slot_id": slot_id,
			"saved_at": int(Time.get_unix_time_from_system())
		}

	var save_result := SaveDataAccessLayer.save_game(slot_id, game_data)
	var is_save_success := bool(save_result.get("success", false))
	if is_save_success:
		WorldSessionRuntimeService.clear_world_dirty()
	return UnifiedProtocolFactory.create_response(
		request.request_id, is_save_success, save_result,
		"" if is_save_success else str(save_result.get("error_code", "ERR_SAVE_FAILED")),
		"Game save persisted successfully." if is_save_success else "Failed to persist game save."
	)

static func _handle_esc_exit_to_gateway(request: ClientRequestEnvelopeDTO, gateway: WorldGatewayFSM) -> UnifiedResponseEnvelopeDTO:
	if gateway == null:
		return UnifiedProtocolFactory.create_response(
			request.request_id, false, {}, "ERR_GATEWAY_NOT_BOUND", "Active world gateway instance is not bound."
		)

	var slot_id := _resolve_effective_slot_id(request, gateway)
	var auto_save_requested := bool(request.payload.get("auto_save", true))
	var strict_auto_save := bool(request.payload.get("strict_auto_save", false)) or not slot_id.is_empty()
	var skip_unbound := false
	var save_result: Dictionary = {}

	if auto_save_requested:
		if strict_auto_save:
			var incomplete_save_error_code := GameConfig.get_string(DOMAIN_WORLD_STATE_CONFIG, "esc_menu/errors/incomplete_save_blocked", "ERR_INCOMPLETE_SAVE_BLOCKED")
			if slot_id.is_empty():
				return UnifiedProtocolFactory.create_response(
					request.request_id, false, {}, incomplete_save_error_code, "No valid save slot is bound; auto-save operation blocked."
				)
			var unsafe_response := _validate_save_path_safety(request, gateway, slot_id, false)
			if unsafe_response != null:
				return unsafe_response
			var auto_payload := _resolve_save_payload(request)
			if auto_payload.is_empty():
				if not bool(request.payload.get("allow_skip_unsaved_exit", false)):
					return UnifiedProtocolFactory.create_response(
						request.request_id, false, {"slot_id": slot_id}, incomplete_save_error_code, "Multi-domain save data is incomplete; saving partial shell is strictly forbidden."
					)
				skip_unbound = true
			else:
				save_result = SaveDataAccessLayer.save_game(slot_id, auto_payload)
				if not bool(save_result.get("success", false)):
					var flush_error_code := GameConfig.get_string(DOMAIN_WORLD_STATE_CONFIG, "esc_menu/errors/save_flush_failed", "ERR_SAVE_FLUSH_FAILED")
					return UnifiedProtocolFactory.create_response(
						request.request_id, false, save_result, String(save_result.get("error_code", flush_error_code)), "Pre-exit multi-domain save failed; runtime state preserved without scrubbing."
					)
				WorldSessionRuntimeService.clear_world_dirty()
		else:
			skip_unbound = true

	var scrub_result := gateway.exit_to_gateway()
	var scrub_ok := bool(scrub_result.get("success", false))
	if scrub_ok:
		WorldSessionRuntimeService.deactivate_world_session()
		HumanControlLeaseManager.release_lease()
	if skip_unbound:
		scrub_result["auto_save_skipped_unbound_slot"] = true
	if not save_result.is_empty():
		scrub_result["save_result"] = save_result
	var scrub_error_code := "" if scrub_ok else String(scrub_result.get("error_code", "ERR_EXIT_GATEWAY_FAILED"))
	var scrub_message := "Successfully exited world session and scrubbed gateway memory." if scrub_ok else String(scrub_result.get("message", "Failed to exit world session cleanly."))
	return UnifiedProtocolFactory.create_response(
		request.request_id, scrub_ok, scrub_result, scrub_error_code, scrub_message
	)

static func _handle_esc_quit_game(request: ClientRequestEnvelopeDTO, gateway: WorldGatewayFSM) -> UnifiedResponseEnvelopeDTO:
	var shutdown_request := GameShutdownDTO.Request.new()
	shutdown_request.session_token = request.session_token
	shutdown_request.account_id = request.account_id if not request.account_id.is_empty() else WorldSessionRuntimeService.get_active_account_id()
	shutdown_request.exit_reason = int(request.payload.get("exit_reason", GameLifecycleModel.ExitReason.USER_DESKTOP_QUIT))
	shutdown_request.target_save_slot = _resolve_effective_slot_id(request, gateway)
	shutdown_request.save_before_quit = bool(request.payload.get("save_before_quit", true))
	shutdown_request.require_save_success = bool(request.payload.get("require_save_success", false))
	shutdown_request.force_quit = bool(request.payload.get("force_quit", false))

	var shutdown_response := GameLifecycleService.execute_graceful_shutdown(shutdown_request)
	var is_shutdown_success: bool = bool(shutdown_response != null and shutdown_response.is_success)
	if is_shutdown_success:
		HumanControlLeaseManager.release_lease()
	var shutdown_payload: Dictionary = (shutdown_response.to_dto() as Dictionary) if shutdown_response != null else {}
	var error_code: String = "" if is_shutdown_success else (str(shutdown_response.error_code) if shutdown_response != null else "ERR_SHUTDOWN_FAILED")
	var status_message: String = "Five-phase graceful shutdown pipeline executed successfully." if is_shutdown_success else "Graceful shutdown aborted or degraded cleanly."
	return UnifiedProtocolFactory.create_response(
		request.request_id, is_shutdown_success, shutdown_payload, error_code, status_message
	)

static func _handle_esc_pause_resume(request: ClientRequestEnvelopeDTO, paused: bool) -> UnifiedResponseEnvelopeDTO:
	WorldSessionRuntimeService.set_paused(paused)
	var lifecycle_fsm: Variant = GameLifecycleManager.get_instance()
	var target_phase := GameLifecycleModel.LifecyclePhase.PAUSED if paused else GameLifecycleModel.LifecyclePhase.RUNNING
	var transitioned := false
	if lifecycle_fsm != null:
		var current_phase: int = int(lifecycle_fsm.get_current_phase())
		if current_phase == GameLifecycleModel.LifecyclePhase.UNINITIALIZED and paused:
			lifecycle_fsm.transition_to(GameLifecycleModel.LifecyclePhase.BOOT_INITIALIZING)
			lifecycle_fsm.transition_to(GameLifecycleModel.LifecyclePhase.RUNNING)
		transitioned = (int(lifecycle_fsm.get_current_phase()) == target_phase) or bool(lifecycle_fsm.transition_to(target_phase))
	var event_name := "lifecycle.game_paused" if paused else "lifecycle.game_resumed"
	EventBusCore.get_instance().emit_domain_event(event_name, {
		"is_paused": paused,
		"account_id": WorldSessionRuntimeService.get_active_account_id(),
		"character_id": WorldSessionRuntimeService.get_active_character_id()
	})
	return UnifiedProtocolFactory.create_response(
		request.request_id, true,
		{
			"is_paused": paused,
			"lifecycle_transitioned": transitioned,
			"current_phase": int(lifecycle_fsm.get_current_phase()) if lifecycle_fsm != null else -1
		},
		"",
		"Game paused by ESC menu." if paused else "Game resumed from pause."
	)

static func _resolve_effective_slot_id(request: ClientRequestEnvelopeDTO, gateway: WorldGatewayFSM) -> String:
	var explicit := str(request.payload.get("slot_id", request.payload.get("target_save_slot", "")))
	if not explicit.is_empty():
		return explicit
	if gateway != null and gateway.context != null and not gateway.context.selected_slot_id.is_empty():
		return gateway.context.selected_slot_id
	return WorldSessionRuntimeService.get_active_slot_id()

static func _resolve_save_payload(request: ClientRequestEnvelopeDTO) -> Dictionary:
	var raw_game_data: Variant = request.payload.get("game_data", null)
	if raw_game_data is Dictionary and not (raw_game_data as Dictionary).is_empty():
		return (raw_game_data as Dictionary).duplicate(true)
	var built := SaveDataAccessLayer.build_save_payload()
	if built.get("data", {}) is Dictionary and not (built["data"] as Dictionary).is_empty():
		return built
	if WorldSessionRuntimeService.has_active_world():
		var runtime_save_payload := WorldSessionRuntimeService.assemble_runtime_save_payload()
		if runtime_save_payload.get("data", {}) is Dictionary and not (runtime_save_payload["data"] as Dictionary).is_empty():
			return runtime_save_payload
	return {}

static func _has_existing_full_domain_save(slot_id: String) -> bool:
	if slot_id.is_empty():
		return false
	var existing := SaveDataAccessLayer.load_game(slot_id)
	if not bool(existing.get("success", false)):
		return false
	var raw_data: Variant = existing.get("data", null)
	if not raw_data is Dictionary:
		return false
	var save_dict: Dictionary = raw_data as Dictionary
	for domain_key in save_dict.keys():
		if domain_key != "slot_id" and domain_key != "saved_at" and domain_key != "account_id":
			return true
	return false

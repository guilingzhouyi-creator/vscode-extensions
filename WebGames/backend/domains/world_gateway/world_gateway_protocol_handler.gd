# ==============================================================================
# 模块归属: 业务领域层 (Domains · 世界网关集群 (World Gateway Domain))
# 文件路径: res://backend/domains/world_gateway/world_gateway_protocol_handler.gd
# 架构定位: Domain Protocol Action Handler
# 依赖与触发: 上游: UnifiedProtocolDispatcher | 下游: WorldGatewayFSM, ModeReadinessProbe
# 配置与信号: 契约 config/infrastructure/contracts.json
# 职责说明: 承接并解算世界网关领域客户端协议动作，分发网关进入、模式探测、档案选择与模式切换。
# 退出语义与设计依据: 卡拉尔领域第一性原理 (Inv-GATEWAY-AUTH-2)
# ==============================================================================

## WorldGatewayProtocolHandler：世界网关领域客户端协议动作分发处理器
class_name WorldGatewayProtocolHandler
extends RefCounted

const WorldGatewayModel = preload("res://backend/domains/world_gateway/world_gateway_model.gd")
const ModeReadinessProbe = preload("res://backend/domains/world_gateway/mode_readiness_probe.gd")
const RemoteRealmDirectoryProvider = preload("res://backend/domains/world_gateway/remote_realm_directory_provider.gd")
const WorldArchiveRepository = preload("res://backend/domains/world_state/world_archive_repository.gd")
const AccountRepository = preload("res://backend/domains/account/account_repository.gd")
const AccountSlotBindingSolver = preload("res://backend/domains/account/account_slot_binding_solver.gd")
const WorldSessionRuntimeService = preload("res://backend/domains/world_state/services/world_session_runtime_service.gd")
const HumanControlLeaseManager = preload("res://backend/domains/world_state/services/human_control_lease_manager.gd")
const EscMenuBackendService = preload("res://backend/domains/world_state/services/esc_menu_backend_service.gd")
const UnifiedProtocolFactory = preload("res://backend/domains/world_state/services/unified_protocol_factory.gd")

## 分发客户端世界网关协议请求至状态机并返回统一响应包
static func dispatch(request: ClientRequestEnvelopeDTO, gateway: WorldGatewayFSM) -> UnifiedResponseEnvelopeDTO:
	if request.action_type.begins_with("ESC_"):
		return EscMenuBackendService.handle_esc_action(request, gateway)

	var active_gateway := gateway
	if active_gateway == null and not request.account_id.is_empty():
		active_gateway = WorldGatewayFSM.new(request.account_id)
		WorldSessionRuntimeService.bind_gateway(active_gateway)
	if active_gateway == null:
		return UnifiedProtocolFactory.create_response(
			request.request_id, false, {}, "ERR_GATEWAY_NOT_BOUND", "Valid world gateway session instance not bound"
		)

	var request_payload: Dictionary = request.payload if request.payload is Dictionary else {}
	match request.action_type:
		"ENTER_GATEWAY":
			var enter_result := active_gateway.enter_gateway()
			if bool(enter_result.get("success", false)):
				enter_result["worlds"] = active_gateway.list_world_archives()
			return UnifiedProtocolFactory.create_response(
				request.request_id, bool(enter_result.get("success", false)), enter_result,
				"" if bool(enter_result.get("success", false)) else String(enter_result.get("error_code", "ERR_ENTER_GATEWAY")),
				String(enter_result.get("message", "Entered world gateway successfully"))
			)

		"PROBE_MODES":
			var reports := ModeReadinessProbe.probe_all_modes(active_gateway.context.account_id)
			return UnifiedProtocolFactory.create_response(
				request.request_id, true, {"probe_reports": reports}, "", "Mode readiness probes refreshed successfully"
			)

		"LIST_WORLDS":
			return UnifiedProtocolFactory.create_response(
				request.request_id, true, {"worlds": active_gateway.list_world_archives()}, "", "World archive list queried successfully"
			)

		"SELECT_MODE", "SELECT_OR_CREATE_WORLD":
			var target_mode: int = int(request_payload.get("target_mode", request_payload.get("mode", WorldGatewayModel.GameMode.SINGLE_PLAYER)))
			var target_world_id := str(request_payload.get("world_id", ""))
			var target_slot_id := str(request_payload.get("slot_id", ""))
			if not target_world_id.is_empty() and bool(request_payload.get("create_if_missing", true)):
				var world_repository := WorldArchiveRepository.get_instance()
				if world_repository != null and not world_repository.has_world(target_world_id):
					world_repository.create_world(target_world_id, str(request_payload.get("world_name", target_world_id)), int(request_payload.get("seed_value", 20261110)))
			var account_repository := AccountRepository.get_instance()
			if account_repository != null and not account_repository.is_loaded():
				account_repository.load_all()
			var account := account_repository.find_by_id(active_gateway.context.account_id) if account_repository != null else null
			var selection_result: Dictionary
			var custom_mods: Array = request_payload.get("custom_mods", []) if request_payload.get("custom_mods") is Array else []
			if account != null:
				if not custom_mods.is_empty():
					active_gateway.set_active_mods(custom_mods)
				selection_result = active_gateway.select_mode_for_account(target_mode, account, request_payload.get("canary_flags", {}), target_world_id, target_slot_id)
			else:
				var fallback_slot := target_slot_id if not target_slot_id.is_empty() else "SLOT_01"
				var slots: Array = [{"slot_id": fallback_slot, "is_first_creation": true, "bound_world_id": target_world_id}]
				selection_result = active_gateway.select_mode(target_mode, request_payload.get("canary_flags", {}), slots, target_world_id, fallback_slot, custom_mods)
			return UnifiedProtocolFactory.create_response(
				request.request_id, bool(selection_result.get("success", false)), selection_result,
				"" if bool(selection_result.get("success", false)) else String(selection_result.get("error_code", "ERR_SELECT_MODE")),
				String(selection_result.get("message", "Gateway mode and slot selected successfully"))
			)

		"ATTACH_READY_CHARACTER":
			var target_character_id := str(request_payload.get("character_id", request.character_id))
			if target_character_id.is_empty():
				target_character_id = active_gateway.context.active_character_id
			var attach_result := active_gateway.attach_ready_character(target_character_id)
			var is_attach_succeeded := bool(attach_result.get("success", false))
			return UnifiedProtocolFactory.create_response(
				request.request_id, is_attach_succeeded, attach_result,
				"" if is_attach_succeeded else String(attach_result.get("error_code", "ERR_ATTACH_CHARACTER")),
				String(attach_result.get("message", "Ready character attached to gateway"))
			)

		"ENTER_WORLD":
			var enter_world_id := str(request_payload.get("world_id", ""))
			var should_allow_safe_degrade := bool(request_payload.get("allow_safe_degrade", false))
			var enter_world_result := active_gateway.enter_world(enter_world_id, should_allow_safe_degrade)
			var is_enter_world_succeeded := bool(enter_world_result.get("success", false))
			if is_enter_world_succeeded:
				var live_snapshot := WorldSessionRuntimeService.pull_authoritative_hud_snapshot()
				enter_world_result["initial_hud_snapshot"] = live_snapshot.to_dto()
			return UnifiedProtocolFactory.create_response(
				request.request_id, is_enter_world_succeeded, enter_world_result,
				"" if is_enter_world_succeeded else String(enter_world_result.get("error_code", "ERR_ENTER_WORLD")),
				String(enter_world_result.get("message", "Entered world successfully"))
			)

		"DISCOVER_MODS":
			var roots: Array = request_payload.get("custom_roots", []) if request_payload.get("custom_roots") is Array else []
			var enabled_ids: Array = request_payload.get("enabled_pack_ids", ["*"]) if request_payload.get("enabled_pack_ids") is Array else ["*"]
			var discover_result := active_gateway.discover_and_configure_single_player_mods(roots, enabled_ids)
			var is_discover_succeeded := bool(discover_result.get("success", false))
			return UnifiedProtocolFactory.create_response(
				request.request_id, is_discover_succeeded, discover_result,
				"" if is_discover_succeeded else String(discover_result.get("error_code", "ERR_DISCOVER_MODS")),
				String(discover_result.get("message", "Single-player mods discovered and prechecked"))
			)

		"PRECHECK_MODS":
			var packs: Array = request_payload.get("candidate_packs", []) if request_payload.get("candidate_packs") is Array else []
			var enabled_pack_ids_override: Array = request_payload.get("enabled_pack_ids", ["*"]) if request_payload.get("enabled_pack_ids") is Array else ["*"]
			var precheck_result := active_gateway.precheck_and_configure_single_player_mods(packs, enabled_pack_ids_override)
			var is_precheck_succeeded := bool(precheck_result.get("success", false))
			return UnifiedProtocolFactory.create_response(
				request.request_id, is_precheck_succeeded, precheck_result,
				"" if is_precheck_succeeded else String(precheck_result.get("error_code", "ERR_PRECHECK_MODS")),
				String(precheck_result.get("message", "Single-player mods prechecked"))
			)

		"LIST_REMOTE_REALMS":
			var realms := RemoteRealmDirectoryProvider.list_realms(active_gateway.context.account_id)
			return UnifiedProtocolFactory.create_response(
				request.request_id, true, {"realms": realms}, "", "Remote realm directory retrieved successfully"
			)

		"DELETE_WORLD":
			var delete_world_id := str(request_payload.get("world_id", ""))
			if active_gateway.context.current_phase == WorldGatewayModel.GatewayPhase.IN_WORLD or WorldSessionRuntimeService.has_active_world():
				return UnifiedProtocolFactory.create_response(
					request.request_id, false, {}, "ERR_DELETE_WHILE_ACTIVE", "Cannot delete a world archive while in an active world"
				)
			var archive_repository := WorldArchiveRepository.get_instance()
			var is_delete_succeeded: bool = (archive_repository != null and archive_repository.delete_world(delete_world_id))
			return UnifiedProtocolFactory.create_response(
				request.request_id, is_delete_succeeded, {"world_id": delete_world_id, "deleted": is_delete_succeeded},
				"" if is_delete_succeeded else "ERR_DELETE_WORLD_FAILED",
				"World archive deleted successfully" if is_delete_succeeded else "Failed to delete world archive"
			)

		"EXIT_WORLD_TO_GATEWAY":
			if bool(request_payload.get("auto_save", false)):
				var esc_proxy := ClientRequestEnvelopeDTO.from_dto(request.to_dto())
				esc_proxy.action_type = "ESC_EXIT_TO_GATEWAY"
				return EscMenuBackendService.handle_esc_action(esc_proxy, active_gateway)
			var scrub_result := active_gateway.exit_to_gateway()
			var is_scrub_succeeded := bool(scrub_result.get("success", false))
			if is_scrub_succeeded:
				HumanControlLeaseManager.release_lease()
			return UnifiedProtocolFactory.create_response(
				request.request_id, is_scrub_succeeded, scrub_result,
				"" if is_scrub_succeeded else String(scrub_result.get("error_code", "ERR_EXIT_GATEWAY_FAILED")),
				"Exited world and returned to gateway" if is_scrub_succeeded else String(scrub_result.get("message", "Failed to exit world"))
			)

		"SWITCH_GATEWAY_MODE":
			var new_mode: int = int(request_payload.get("target_mode", WorldGatewayModel.GameMode.SINGLE_PLAYER))
			var switch_account_repository := AccountRepository.get_instance()
			if switch_account_repository != null and not switch_account_repository.is_loaded():
				switch_account_repository.load_all()
			var switch_account := switch_account_repository.find_by_id(active_gateway.context.account_id) if switch_account_repository != null else null
			var slots_argument: Array = []
			if switch_account == null:
				var target_slot := str(request_payload.get("slot_id", "SLOT_01"))
				slots_argument = [{"slot_id": target_slot, "is_first_creation": true}]
			else:
				slots_argument = AccountSlotBindingSolver.to_gateway_slot_states(switch_account, str(request_payload.get("world_id", "")))
			var switch_mods: Array = request_payload.get("custom_mods", []) if request_payload.get("custom_mods") is Array else []
			var switch_result := active_gateway.switch_gateway_mode(new_mode, request_payload.get("canary_flags", {}), slots_argument, str(request_payload.get("world_id", "")), str(request_payload.get("slot_id", "")), switch_mods)
			return UnifiedProtocolFactory.create_response(
				request.request_id, bool(switch_result.get("success", false)), switch_result,
				"" if bool(switch_result.get("success", false)) else String(switch_result.get("error_code", "ERR_SWITCH_GATEWAY")),
				String(switch_result.get("message", "Gateway mode switch completed successfully"))
			)

	return UnifiedProtocolFactory.create_unhandled_action_response(request.request_id, request.action_type)

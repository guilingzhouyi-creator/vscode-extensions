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
const WorldArchiveRepository = preload("res://backend/domains/world_state/world_archive_repository.gd")
const AccountRepository = preload("res://backend/domains/account/account_repository.gd")
const AccountSlotBindingSolver = preload("res://backend/domains/account/account_slot_binding_solver.gd")
const WorldSessionRuntimeService = preload("res://backend/domains/world_state/services/world_session_runtime_service.gd")
const HumanControlLeaseManager = preload("res://backend/domains/world_state/services/human_control_lease_manager.gd")
const EscMenuBackendService = preload("res://backend/domains/world_state/services/esc_menu_backend_service.gd")
const UnifiedProtocolFactory = preload("res://backend/domains/world_state/services/unified_protocol_factory.gd")

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

	var payload_dict: Dictionary = request.payload if request.payload is Dictionary else {}
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
			var target_mode: int = int(payload_dict.get("target_mode", payload_dict.get("mode", WorldGatewayModel.GameMode.SINGLE_PLAYER)))
			var target_world_id := str(payload_dict.get("world_id", ""))
			var target_slot_id := str(payload_dict.get("slot_id", ""))
			if not target_world_id.is_empty() and bool(payload_dict.get("create_if_missing", true)):
				var world_repo := WorldArchiveRepository.get_instance()
				if world_repo != null and not world_repo.has_world(target_world_id):
					world_repo.create_world(target_world_id, str(payload_dict.get("world_name", target_world_id)), int(payload_dict.get("seed_value", 20261110)))
			var repo := AccountRepository.get_instance()
			var acc := repo.find_by_id(active_gateway.context.account_id) if repo != null else null
			var selection_result: Dictionary
			if acc != null:
				selection_result = active_gateway.select_mode_for_account(target_mode, acc, payload_dict.get("canary_flags", {}), target_world_id, target_slot_id)
			else:
				var fallback_slot := target_slot_id if not target_slot_id.is_empty() else "SLOT_01"
				var slots: Array = [{"slot_id": fallback_slot, "is_first_creation": true, "bound_world_id": target_world_id}]
				selection_result = active_gateway.select_mode(target_mode, payload_dict.get("canary_flags", {}), slots, target_world_id, fallback_slot, payload_dict.get("custom_mods", []))
			return UnifiedProtocolFactory.create_response(
				request.request_id, bool(selection_result.get("success", false)), selection_result,
				"" if bool(selection_result.get("success", false)) else String(selection_result.get("error_code", "ERR_SELECT_MODE")),
				String(selection_result.get("message", "Gateway mode and slot selected successfully"))
			)

		"EXIT_WORLD_TO_GATEWAY":
			if bool(payload_dict.get("auto_save", false)):
				var esc_proxy := ClientRequestEnvelopeDTO.from_dto(request.to_dto())
				esc_proxy.action_type = "ESC_EXIT_TO_GATEWAY"
				return EscMenuBackendService.handle_esc_action(esc_proxy, active_gateway)
			var scrub := active_gateway.exit_to_gateway()
			HumanControlLeaseManager.release_lease()
			return UnifiedProtocolFactory.create_response(
				request.request_id, bool(scrub.get("success", false)), scrub, "", "Exited world and returned to gateway"
			)

		"SWITCH_GATEWAY_MODE":
			var new_mode: int = int(payload_dict.get("target_mode", WorldGatewayModel.GameMode.SINGLE_PLAYER))
			var switch_account_repo := AccountRepository.get_instance()
			var switch_account := switch_account_repo.find_by_id(active_gateway.context.account_id) if switch_account_repo != null else null
			var slots_arg: Array = []
			if switch_account == null:
				var target_slot := str(payload_dict.get("slot_id", "SLOT_01"))
				slots_arg = [{"slot_id": target_slot, "is_first_creation": true}]
			else:
				slots_arg = AccountSlotBindingSolver.to_gateway_slot_states(switch_account, str(payload_dict.get("world_id", "")))
			var switch_result := active_gateway.switch_gateway_mode(new_mode, payload_dict.get("canary_flags", {}), slots_arg, str(payload_dict.get("world_id", "")), str(payload_dict.get("slot_id", "")))
			return UnifiedProtocolFactory.create_response(
				request.request_id, bool(switch_result.get("success", false)), switch_result,
				"" if bool(switch_result.get("success", false)) else String(switch_result.get("error_code", "ERR_SWITCH_GATEWAY")),
				String(switch_result.get("message", "Gateway mode switch completed successfully"))
			)

	return UnifiedProtocolFactory.create_response(
		request.request_id, false, {}, "ERR_UNHANDLED_ACTION",
		TemplateFormatter.format("Unsupported action instruction: {action_type}.", {"action_type": request.action_type})
	)

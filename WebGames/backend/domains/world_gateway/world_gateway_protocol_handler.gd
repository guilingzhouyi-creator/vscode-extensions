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
			request.request_id, false, {}, "ERR_GATEWAY_NOT_BOUND", "未绑定有效的世界网关会话实例"
		)

	var payload_dict: Dictionary = request.payload if request.payload is Dictionary else {}
	match request.action_type:
		"ENTER_GATEWAY":
			var res := active_gateway.enter_gateway()
			if bool(res.get("success", false)):
				res["worlds"] = active_gateway.list_world_archives()
			return UnifiedProtocolFactory.create_response(
				request.request_id, bool(res.get("success", false)), res,
				"" if bool(res.get("success", false)) else String(res.get("error_code", "ERR_ENTER_GATEWAY")),
				String(res.get("message", "已进入世界网关"))
			)

		"PROBE_MODES":
			var reports := ModeReadinessProbe.probe_all_modes(active_gateway.context.account_id)
			return UnifiedProtocolFactory.create_response(
				request.request_id, true, {"probe_reports": reports}, "", "模式就绪探针刷新成功"
			)

		"LIST_WORLDS":
			return UnifiedProtocolFactory.create_response(
				request.request_id, true, {"worlds": active_gateway.list_world_archives()}, "", "世界档案列表查询成功"
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
			var sel_res: Dictionary
			if acc != null:
				sel_res = active_gateway.select_mode_for_account(target_mode, acc, payload_dict.get("canary_flags", {}), target_world_id, target_slot_id)
			else:
				var fallback_slot := target_slot_id if not target_slot_id.is_empty() else "SLOT_01"
				var slots: Array = [{"slot_id": fallback_slot, "is_first_creation": true, "bound_world_id": target_world_id}]
				sel_res = active_gateway.select_mode(target_mode, payload_dict.get("canary_flags", {}), slots, target_world_id, fallback_slot, payload_dict.get("custom_mods", []))
			return UnifiedProtocolFactory.create_response(
				request.request_id, bool(sel_res.get("success", false)), sel_res,
				"" if bool(sel_res.get("success", false)) else String(sel_res.get("error_code", "ERR_SELECT_MODE")),
				String(sel_res.get("message", "网关模式与档位已选定"))
			)

		"EXIT_WORLD_TO_GATEWAY":
			if bool(payload_dict.get("auto_save", false)):
				var esc_proxy := ClientRequestEnvelopeDTO.from_dto(request.to_dto())
				esc_proxy.action_type = "ESC_EXIT_TO_GATEWAY"
				return EscMenuBackendService.handle_esc_action(esc_proxy, active_gateway)
			var scrub := active_gateway.exit_to_gateway()
			HumanControlLeaseManager.release_lease()
			return UnifiedProtocolFactory.create_response(
				request.request_id, bool(scrub.get("success", false)), scrub, "", "已退出世界并返回网关"
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
			var sw_res := active_gateway.switch_gateway_mode(new_mode, payload_dict.get("canary_flags", {}), slots_arg, str(payload_dict.get("world_id", "")), str(payload_dict.get("slot_id", "")))
			return UnifiedProtocolFactory.create_response(
				request.request_id, bool(sw_res.get("success", false)), sw_res,
				"" if bool(sw_res.get("success", false)) else String(sw_res.get("error_code", "ERR_SWITCH_GATEWAY")),
				String(sw_res.get("message", "切换运行网关完成"))
			)

	return UnifiedProtocolFactory.create_response(
		request.request_id, false, {}, "ERR_UNHANDLED_ACTION", "未支持的操作指令: %s" % request.action_type
	)

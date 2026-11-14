# ==============================================================================
# 模块归属: 业务领域层 (Domains · 生命周期集群 (Lifecycle Domain))
# 文件路径: res://backend/domains/lifecycle/services/lifecycle_protocol_handler.gd
# 架构定位: Domain Protocol Action Handler
# 依赖与触发: 上游: UnifiedProtocolDispatcher | 下游: GameLifecycleService, EscMenuBackendService
# 配置与信号: 契约 config/infrastructure/contracts.json
# 职责说明: 承接并解算生命周期领域客户端协议动作，分发优雅停机与安全退出。
# 退出语义与设计依据: 卡拉尔领域第一性原理 (Inv-SYMMETRIC-TEARDOWN-4)
# ==============================================================================

## LifecycleProtocolHandler：生命周期领域客户端协议动作分发处理器
class_name LifecycleProtocolHandler
extends RefCounted

const GameLifecycleService = preload("res://backend/domains/lifecycle/game_lifecycle_service.gd")
const GameLifecycleModel = preload("res://backend/domains/lifecycle/game_lifecycle_model.gd")
const GameShutdownDTO = preload("res://backend/domains/lifecycle/dto/game_shutdown_dto.gd")
const EscMenuBackendService = preload("res://backend/domains/world_state/services/esc_menu_backend_service.gd")
const WorldSessionRuntimeService = preload("res://backend/domains/world_state/services/world_session_runtime_service.gd")
const HumanControlLeaseManager = preload("res://backend/domains/world_state/services/human_control_lease_manager.gd")
const UnifiedProtocolFactory = preload("res://backend/domains/world_state/services/unified_protocol_factory.gd")

## 分发并处理生命周期领域客户端协议动作（暂停/恢复/登出/停机）
static func dispatch(request: ClientRequestEnvelopeDTO, gateway: Variant) -> UnifiedResponseEnvelopeDTO:
	if request.action_type.begins_with("ESC_"):
		return EscMenuBackendService.handle_esc_action(request, gateway)
	var payload_dict: Dictionary = request.payload if request.payload is Dictionary else {}
	match request.action_type:
		"PAUSE_GAME", "RESUME_GAME":
			var paused := (request.action_type == "PAUSE_GAME")
			WorldSessionRuntimeService.set_paused(paused)
			var pause_result := GameLifecycleService.set_paused_state(paused)
			var pause_ok := bool(pause_result.get("success", false))
			return UnifiedProtocolFactory.create_response(
				request.request_id, pause_ok, pause_result,
				"" if pause_ok else String(pause_result.get("error_code", "ERR_PAUSE_TRANSITION")),
				"Game paused" if paused else "Game resumed"
			)

		"LOGOUT_TO_MENU":
			var logout_request := _build_shutdown_req(request, payload_dict, GameLifecycleModel.ExitReason.USER_LOGOUT_TO_MENU)
			return _execute_soft_logout_response(
				request.request_id, gateway, logout_request,
				"Returned to account home menu cleanly.",
				"Failed to return to account menu cleanly."
			)

		"FORCE_SHUTDOWN":
			var force_request := _build_shutdown_req(request, payload_dict, int(payload_dict.get("exit_reason", GameLifecycleModel.ExitReason.USER_DESKTOP_QUIT)))
			var force_response := GameLifecycleService.execute_force_shutdown(force_request)
			var ok_force := bool(force_response != null and force_response.is_success)
			if ok_force:
				HumanControlLeaseManager.release_lease()
			return UnifiedProtocolFactory.create_response(
				request.request_id, ok_force, force_response.to_dto() if force_response != null else {},
				"" if ok_force else (String(force_response.error_code) if force_response != null else "ERR_FORCE_SHUTDOWN"),
				"Forced shutdown completed." if ok_force else "Forced shutdown failed."
			)

		"REQUEST_GRACEFUL_SHUTDOWN":
			var shutdown_request := _build_shutdown_req(request, payload_dict, int(payload_dict.get("exit_reason", GameLifecycleModel.ExitReason.USER_DESKTOP_QUIT)))
			if shutdown_request.exit_reason == GameLifecycleModel.ExitReason.USER_LOGOUT_TO_MENU and not bool(payload_dict.get("full_teardown", false)):
				return _execute_soft_logout_response(
					request.request_id, gateway, shutdown_request,
					"Soft session exit to menu executed successfully.",
					"Soft exit to menu failed."
				)
			var shutdown_response := GameLifecycleService.execute_graceful_shutdown(shutdown_request)
			var ok := bool(shutdown_response != null and shutdown_response.is_success)
			if ok:
				HumanControlLeaseManager.release_lease()
			var error_code := "" if ok else (String(shutdown_response.error_code) if shutdown_response != null else "ERR_SHUTDOWN_FAILED")
			return UnifiedProtocolFactory.create_response(
				request.request_id, ok, shutdown_response.to_dto() if shutdown_response != null else {}, error_code,
				"Graceful shutdown request executed successfully." if ok else "Graceful shutdown aborted or failed."
			)
	return UnifiedProtocolFactory.create_unhandled_action_response(request.request_id, request.action_type)

static func _execute_soft_logout_response(
	request_id: String,
	gateway: Variant,
	shutdown_request: GameShutdownDTO.Request,
	success_message: String,
	failure_message: String
) -> UnifiedResponseEnvelopeDTO:
	var logout_response := GameLifecycleService.execute_logout_to_menu(shutdown_request)
	var ok_menu := bool(logout_response != null and logout_response.is_success)
	if ok_menu:
		if gateway != null and gateway.has_method("logout"):
			gateway.call("logout")
		WorldSessionRuntimeService.revoke_account_session()
		HumanControlLeaseManager.release_lease()
	var menu_error_code := "" if ok_menu else (String(logout_response.error_code) if logout_response != null else "ERR_LOGOUT_TO_MENU_FAILED")
	return UnifiedProtocolFactory.create_response(
		request_id, ok_menu, logout_response.to_dto() if logout_response != null else {}, menu_error_code, success_message if ok_menu else failure_message
	)

static func _build_shutdown_req(request: ClientRequestEnvelopeDTO, payload_dict: Dictionary, default_reason: int) -> GameShutdownDTO.Request:
	var shutdown_request := GameShutdownDTO.Request.new()
	shutdown_request.session_token = request.session_token
	shutdown_request.account_id = request.account_id if not request.account_id.is_empty() else WorldSessionRuntimeService.get_active_account_id()
	shutdown_request.exit_reason = int(payload_dict.get("exit_reason", default_reason))
	var explicit_slot := str(payload_dict.get("slot_id", payload_dict.get("target_save_slot", "")))
	shutdown_request.target_save_slot = explicit_slot if not explicit_slot.is_empty() else WorldSessionRuntimeService.get_active_slot_id()
	shutdown_request.save_before_quit = bool(payload_dict.get("save_before_quit", true))
	shutdown_request.require_save_success = bool(payload_dict.get("require_save_success", false))
	shutdown_request.force_quit = bool(payload_dict.get("force_quit", false))
	return shutdown_request

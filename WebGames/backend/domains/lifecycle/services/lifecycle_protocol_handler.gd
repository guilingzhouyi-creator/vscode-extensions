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
const GameLifecycleModel = preload("res://backend/domains/lifecycle/lifecycle_model.gd")
const GameShutdownDTO = preload("res://backend/domains/lifecycle/dto/game_shutdown_dto.gd")
const EscMenuBackendService = preload("res://backend/domains/world_state/services/esc_menu_backend_service.gd")
const WorldSessionRuntimeService = preload("res://backend/domains/world_state/services/world_session_runtime_service.gd")
const HumanControlLeaseManager = preload("res://backend/domains/world_state/services/human_control_lease_manager.gd")
const UnifiedProtocolFactory = preload("res://backend/domains/world_state/services/unified_protocol_factory.gd")

static func dispatch(request: ClientRequestEnvelopeDTO, gateway: Variant) -> UnifiedResponseEnvelopeDTO:
	if request.action_type.begins_with("ESC_"):
		return EscMenuBackendService.handle_esc_action(request, gateway)
	if request.action_type == "REQUEST_GRACEFUL_SHUTDOWN":
		var payload_dict: Dictionary = request.payload if request.payload is Dictionary else {}
		var shut_req := GameShutdownDTO.Request.new()
		shut_req.session_token = request.session_token
		shut_req.account_id = request.account_id if not request.account_id.is_empty() else WorldSessionRuntimeService.get_active_account_id()
		shut_req.exit_reason = int(payload_dict.get("exit_reason", GameLifecycleModel.ExitReason.USER_DESKTOP_QUIT))
		var explicit_slot := str(payload_dict.get("slot_id", ""))
		shut_req.target_save_slot = explicit_slot if not explicit_slot.is_empty() else WorldSessionRuntimeService.get_active_slot_id()
		shut_req.save_before_quit = bool(payload_dict.get("save_before_quit", true))
		shut_req.require_save_success = bool(payload_dict.get("require_save_success", false))
		shut_req.force_quit = bool(payload_dict.get("force_quit", false))
		var shut_resp := GameLifecycleService.execute_graceful_shutdown(shut_req)
		var ok := bool(shut_resp != null and shut_resp.is_success)
		if ok:
			HumanControlLeaseManager.release_lease()
		var err := "" if ok else (String(shut_resp.error_code) if shut_resp != null else "ERR_SHUTDOWN_FAILED")
		return UnifiedProtocolFactory.create_response(
			request.request_id, ok, shut_resp.to_dto() if shut_resp != null else {}, err, "优雅停机请求执行完成"
		)
	return UnifiedProtocolFactory.create_response(
		request.request_id, false, {}, "ERR_UNHANDLED_ACTION", "未支持的操作指令: %s" % request.action_type
	)

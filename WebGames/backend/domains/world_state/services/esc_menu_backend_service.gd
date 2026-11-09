# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群)
# 文件路径: res://backend/domains/world_state/services/esc_menu_backend_service.gd
# 架构定位: Domain Service / Facade Orchestrator
# 依赖与触发: 上游: UnifiedProtocolDispatcher | 下游: SaveReadinessGuard, SaveDataAccessLayer, WorldGatewayFSM, GameLifecycleService
# 职责说明: 集中处理 ESC 菜单各类操作（状态检测、安全存档、退回世界网关洗脱、退出桌面）
# 退出语义与设计依据: 业务服务类；设计依据: 卡拉尔事务级网关洗脱与停机安全契约 (Inv-TRANSACTIONAL-GATEWAY-SCRUB-2)
# ==============================================================================

## ESC 菜单后端领域服务：提供系统菜单请求处理与事务级状态流转
class_name EscMenuBackendService
extends RefCounted

const SaveReadinessGuard = preload("res://backend/domains/world_state/guards/save_readiness_guard.gd")
const SaveDataAccessLayer = preload("res://backend/domains/persistence_protocol/save_data_access_layer.gd")
const GameLifecycleService = preload("res://backend/domains/lifecycle/game_lifecycle_service.gd")
const GameShutdownDTO = preload("res://backend/domains/lifecycle/dto/game_shutdown_dto.gd")
const GameLifecycleModel = preload("res://backend/domains/lifecycle/lifecycle_model.gd")
const UnifiedProtocolFactory = preload("res://backend/domains/world_state/services/unified_protocol_factory.gd")
const ClientRequestEnvelopeDTO = preload("res://backend/domains/world_state/dto/client_request_envelope_dto.gd")
const UnifiedResponseEnvelopeDTO = preload("res://backend/domains/world_state/dto/unified_response_envelope_dto.gd")
const WorldGatewayFSM = preload("res://backend/domains/world_gateway/world_gateway_fsm.gd")
const WorldGatewayModel = preload("res://backend/domains/world_gateway/world_gateway_model.gd")
const HumanControlLeaseManager = preload("res://backend/domains/world_state/services/human_control_lease_manager.gd")

## 处理用户触发 ESC 快捷菜单时的动作路由
static func handle_esc_action(request: ClientRequestEnvelopeDTO, gateway: WorldGatewayFSM = null) -> UnifiedResponseEnvelopeDTO:
	if request == null:
		return UnifiedProtocolFactory.create_response(
			"", false, {}, "ERR_NULL_REQUEST", "请求信封不能为空"
		)

	match request.action_type:
		"ESC_QUERY_READINESS":
			var in_combat: bool = bool(request.payload.get("in_combat", false))
			var in_cutscene: bool = bool(request.payload.get("in_cutscene", false))
			var is_dead: bool = bool(request.payload.get("is_dead", false))
			var readiness := SaveReadinessGuard.evaluate_save_readiness(in_combat, in_cutscene, is_dead)
			return UnifiedProtocolFactory.create_response(
				request.request_id, true, readiness, "", "保存就绪状态查询成功"
			)

		"ESC_SAVE_GAME":
			var in_combat: bool = bool(request.payload.get("in_combat", false))
			var in_cutscene: bool = bool(request.payload.get("in_cutscene", false))
			var is_dead: bool = bool(request.payload.get("is_dead", false))
			var readiness := SaveReadinessGuard.evaluate_save_readiness(in_combat, in_cutscene, is_dead)
			if not bool(readiness.get("is_ready", false)):
				return UnifiedProtocolFactory.create_response(
					request.request_id, false, readiness,
					"ERR_SAVE_GUARD_BLOCKED",
					"当前状态被守卫拦截，不可保存"
				)

			var slot_id: String = str(request.payload.get("slot_id", "SLOT_01"))
			var mode: int = int(request.payload.get("game_mode", WorldGatewayModel.GameMode.SINGLE_PLAYER))
			var path_safety := SaveReadinessGuard.evaluate_storage_path_safety("user://offline_vault/%s.sav" % slot_id.to_lower(), mode)
			if not bool(path_safety.get("safe", path_safety.get("is_safe", false))):
				return UnifiedProtocolFactory.create_response(
					request.request_id, false, path_safety, "ERR_STORAGE_UNSAFE", "存储路径不符合模式隔离规范"
				)

			var raw_game_data: Variant = request.payload.get("game_data", null)
			var game_data: Dictionary = {}
			if raw_game_data is Dictionary and not (raw_game_data as Dictionary).is_empty():
				game_data = (raw_game_data as Dictionary).duplicate(true)
			else:
				game_data = {
					"slot_id": slot_id,
					"saved_at": Time.get_unix_time_from_system()
				}
			var save_result := SaveDataAccessLayer.save_game(slot_id, game_data)
			var is_save_success := bool(save_result.get("success", false))
			return UnifiedProtocolFactory.create_response(
				request.request_id, is_save_success, save_result,
				"" if is_save_success else str(save_result.get("error_code", "ERR_SAVE_FAILED")),
				"存档保存成功" if is_save_success else "存档保存失败"
			)

		"ESC_EXIT_TO_GATEWAY":
			if gateway == null:
				return UnifiedProtocolFactory.create_response(
					request.request_id, false, {}, "ERR_GATEWAY_NOT_BOUND", "未绑定当前世界的运行网关实例"
				)
			# 若指定 auto_save，执行前置快速刷盘
			if bool(request.payload.get("auto_save", true)):
				var slot_id: String = gateway.context.selected_slot_id if (gateway.context != null and not gateway.context.selected_slot_id.is_empty()) else "SLOT_01"
				var auto_save_data: Dictionary = {
					"slot_id": slot_id,
					"account_id": gateway.context.account_id if gateway.context != null else "",
					"saved_at": Time.get_unix_time_from_system()
				}
				SaveDataAccessLayer.save_game(slot_id, auto_save_data)

			# 触发网关全量内存洗脱
			var scrub_result := gateway.exit_to_gateway()
			HumanControlLeaseManager.release_lease()
			return UnifiedProtocolFactory.create_response(
				request.request_id, bool(scrub_result.get("success", false)), scrub_result, "", "已成功退出世界并洗脱网关内存"
			)

		"ESC_QUIT_GAME":
			var shutdown_request := GameShutdownDTO.Request.new()
			shutdown_request.session_token = request.session_token
			shutdown_request.account_id = request.account_id
			shutdown_request.exit_reason = GameLifecycleModel.ExitReason.USER_DESKTOP_QUIT
			shutdown_request.target_save_slot = str(request.payload.get("slot_id", "SLOT_01"))

			var shutdown_response := GameLifecycleService.execute_graceful_shutdown(shutdown_request)
			HumanControlLeaseManager.release_lease()
			var is_shutdown_success: bool = bool(shutdown_response != null and shutdown_response.is_success)
			var shutdown_dto: Dictionary = (shutdown_response.to_dto() as Dictionary) if shutdown_response != null else {}
			var err_code: String = str(shutdown_response.error_code) if shutdown_response != null else "ERR_SHUTDOWN_FAILED"
			return UnifiedProtocolFactory.create_response(
				request.request_id, is_shutdown_success, shutdown_dto, err_code, "五阶段安全停机管线已执行完毕"
			)

	return UnifiedProtocolFactory.create_response(
		request.request_id, false, {}, "ERR_INVALID_ESC_ACTION", "未识别的 ESC 指令: %s" % request.action_type
	)

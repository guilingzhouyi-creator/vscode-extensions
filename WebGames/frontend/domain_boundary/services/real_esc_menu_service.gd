# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Services)
# 文件路径: res://frontend/domain_boundary/services/real_esc_menu_service.gd
# 架构定位: Domain Boundary Adapter / Real ESC Menu Service Bridge
# 依赖与触发: 上游: ServiceContainer, ServiceLocator | 下游:
#           UnifiedProtocolDispatcher, WorldSessionRuntimeService
# 职责说明: 实现 IEscMenuService 接口，封装 ESC 系统菜单状态拉取、安全存盘、退回网关与退出指令，
#           自动注入当前活跃会话凭据与槽位，诚实校验后端存盘守卫回执。
# 设计依据: 业务领域第一性原理 / 表现层零计算纪律 / 持久化诚实原则
# ==============================================================================

class_name RealEscMenuService
extends "res://frontend/domain_boundary/interfaces/i_esc_menu_service.gd"

const UnifiedProtocolFactory = preload("res://backend/domains/world_state/services/unified_protocol_factory.gd")
const UnifiedProtocolDispatcher = preload("res://backend/domains/world_state/services/unified_protocol_dispatcher.gd")
const WorldSessionRuntimeService = preload("res://backend/domains/world_state/services/world_session_runtime_service.gd")

func _dispatch_esc_action(action_type: String, extra_payload: Dictionary, callback: Callable) -> void:
	var account_id := WorldSessionRuntimeService.get_active_account_id()
	var token := WorldSessionRuntimeService.get_active_session_token()
	var payload := {"account_id": account_id}
	payload.merge(extra_payload, true)
	var req := UnifiedProtocolFactory.create_human_request("world_state", action_type, payload, token, account_id)
	var resp := UnifiedProtocolDispatcher.dispatch_request(req)
	if callback.is_valid():
		callback.call({
			"success": resp.success,
			"error_code": resp.error_code,
			"message": resp.error_message,
			"data": resp.data
		})

## 异步拉取 ESC 菜单可用状态
func get_menu_state_async(callback: Callable) -> void:
	_dispatch_esc_action("ESC_GET_MENU_STATE", {}, callback)

## 异步请求安全存盘
func request_save_async(target_slot: String, is_quicksave: bool, callback: Callable) -> void:
	var slot_to_save := target_slot if not target_slot.is_empty() else WorldSessionRuntimeService.get_active_slot_id()
	_dispatch_esc_action("ESC_SAVE_GAME", {"target_save_slot": slot_to_save, "is_quicksave": is_quicksave}, callback)

## 异步请求退出世界退回网关
func exit_to_gateway_async(callback: Callable) -> void:
	_dispatch_esc_action("ESC_EXIT_TO_GATEWAY", {"auto_save": true}, callback)

## 异步请求安全优雅退出游戏
func quit_game_async(callback: Callable) -> void:
	_dispatch_esc_action("ESC_QUIT_GAME", {"target_save_slot": WorldSessionRuntimeService.get_active_slot_id()}, callback)

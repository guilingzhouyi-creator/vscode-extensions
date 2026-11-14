# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Services)
# 文件路径: res://frontend/domain_boundary/services/real_esc_menu_service.gd
# 架构定位: Domain Boundary Adapter / Real ESC Menu Service Bridge
# 依赖与触发: 上游: ServiceContainer, ServiceLocator | 下游:
#           UnifiedProtocolDispatcher, WorldSessionRuntimeService
# 职责说明: 实现 IEscMenuService 接口，封装 ESC 系统菜单状态拉取、安全存盘、退回网关与退出指令，
#           自动注入当前活跃会话凭据与槽位，诚实校验后端存盘守卫回执。
# 退出语义与设计依据: 业务领域第一性原理 / 表现层零计算纪律 / 持久化诚实原则
# ==============================================================================

## RealEscMenuService：直连后端协议的 ESC 系统菜单真实边界服务实现
class_name RealEscMenuService
extends "res://frontend/domain_boundary/interfaces/i_esc_menu_service.gd"

const RealProtocolBridge = preload("res://frontend/domain_boundary/services/real_protocol_bridge.gd")
const WorldSessionRuntimeService = preload("res://backend/domains/world_state/services/world_session_runtime_service.gd")

func _dispatch_esc_action(action_type: String, extra_payload: Dictionary, result_callback: Callable) -> void:
	RealProtocolBridge.dispatch_active_session("world_state", action_type, extra_payload, result_callback)

## 异步拉取 ESC 菜单可用状态
func get_menu_state_async(result_callback: Callable) -> void:
	_dispatch_esc_action("ESC_GET_MENU_STATE", {}, result_callback)

## 异步查询当前存储安全就绪度
func query_readiness_async(result_callback: Callable, context_flags: Dictionary = {}) -> void:
	_dispatch_esc_action("ESC_QUERY_READINESS", context_flags, result_callback)

## 异步请求暂停游戏
func pause_game_async(result_callback: Callable) -> void:
	_dispatch_esc_action("ESC_PAUSE_GAME", {}, result_callback)

## 异步请求恢复游戏运行
func resume_game_async(result_callback: Callable) -> void:
	_dispatch_esc_action("ESC_RESUME_GAME", {}, result_callback)

## 异步请求安全存盘
func request_save_async(target_slot: String, is_quicksave: bool, result_callback: Callable) -> void:
	var slot_to_save := target_slot if not target_slot.is_empty() else WorldSessionRuntimeService.get_active_slot_id()
	_dispatch_esc_action("ESC_SAVE_GAME", {
		"slot_id": slot_to_save,
		"target_save_slot": slot_to_save,
		"is_quicksave": is_quicksave
	}, result_callback)

## 异步应用 ESC 设置调整
func apply_settings_async(settings_patch: Dictionary, result_callback: Callable) -> void:
	_dispatch_esc_action("ESC_APPLY_SETTINGS", settings_patch, result_callback)

## 异步请求退出世界退回网关
func exit_to_gateway_async(result_callback: Callable, auto_save: bool = true, allow_skip_unsaved: bool = false) -> void:
	_dispatch_esc_action("ESC_EXIT_TO_GATEWAY", {
		"auto_save": auto_save,
		"allow_skip_unsaved_exit": allow_skip_unsaved
	}, result_callback)

## 异步请求安全优雅退出游戏
func quit_game_async(result_callback: Callable, save_before_quit: bool = true, require_save_success: bool = false, force_quit: bool = false) -> void:
	_dispatch_esc_action("ESC_QUIT_GAME", {
		"slot_id": WorldSessionRuntimeService.get_active_slot_id(),
		"target_save_slot": WorldSessionRuntimeService.get_active_slot_id(),
		"save_before_quit": save_before_quit,
		"require_save_success": require_save_success,
		"force_quit": force_quit
	}, result_callback)

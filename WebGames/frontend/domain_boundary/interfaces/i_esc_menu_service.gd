# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Interfaces)
# 文件路径: res://frontend/domain_boundary/interfaces/i_esc_menu_service.gd
# 架构定位: Domain Boundary Interface / ESC Menu Service Contract
# 依赖与触发: 上游: Frontend Views, ServiceContainer | 下游: RealEscMenuService,
#           MockEscMenuService
# 职责说明: 规范 ESC 菜单状态拉取、安全存盘与双退出逻辑（退回网关 / 直接退出）。
# 退出语义与设计依据: 前端无业务逻辑契约与领域边界服务解耦规范
# ==============================================================================
class_name IEscMenuService
extends RefCounted

## 异步拉取 ESC 菜单可用状态 (can_save, is_dirty, allowed_actions)
func get_menu_state_async(callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IEscMenuService.get_menu_state_async: pure virtual method must be implemented by subclass")
	if callback.is_valid():
		callback.call({"success": false, "error_code": "NOT_IMPLEMENTED"})

## 异步请求安全存盘 (target_slot: "SLOT_01" 等, is_quicksave: bool)
func request_save_async(target_slot: String, is_quicksave: bool, callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IEscMenuService.request_save_async: pure virtual method must be implemented by subclass")
	if callback.is_valid():
		callback.call({"success": false, "error_code": "NOT_IMPLEMENTED"})

## 异步请求退出世界退回网关
func exit_to_gateway_async(callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IEscMenuService.exit_to_gateway_async: pure virtual method must be implemented by subclass")
	if callback.is_valid():
		callback.call({"success": false, "error_code": "NOT_IMPLEMENTED"})

## 异步请求安全优雅退出游戏
func quit_game_async(callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IEscMenuService.quit_game_async: pure virtual method must be implemented by subclass")
	if callback.is_valid():
		callback.call({"success": false, "error_code": "NOT_IMPLEMENTED"})

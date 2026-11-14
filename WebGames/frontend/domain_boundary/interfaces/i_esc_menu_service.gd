# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Interfaces)
# 文件路径: res://frontend/domain_boundary/interfaces/i_esc_menu_service.gd
# 架构定位: Domain Boundary Interface / ESC Menu Service Contract
# 依赖与触发: 上游: Frontend Views, ServiceContainer | 下游: RealEscMenuService,
#           MockEscMenuService
# 职责说明: 规范 ESC 菜单状态拉取、安全存盘与双退出逻辑（退回网关 / 直接退出）。
# 退出语义与设计依据: 前端无业务逻辑契约与领域边界服务解耦规范
# ==============================================================================

## IEscMenuService：ESC 系统菜单状态、存盘与双退出边界服务接口
class_name IEscMenuService
extends RefCounted

## 异步拉取 ESC 菜单可用状态 (can_save, is_dirty, allowed_actions)
func get_menu_state_async(callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IEscMenuService.get_menu_state_async: pure virtual method must be implemented by subclass")
	if callback.is_valid():
		callback.call({"success": false, "error_code": "NOT_IMPLEMENTED"})

## 异步查询当前存储安全就绪度 (ESC_QUERY_READINESS)
func query_readiness_async(callback: Callable, _context_flags: Dictionary = {}) -> void:
	EventBusCore.get_instance().emit_log("error", "IEscMenuService.query_readiness_async: pure virtual method must be implemented by subclass")
	if callback.is_valid():
		callback.call({"success": false, "error_code": "NOT_IMPLEMENTED"})

## 异步请求暂停游戏并锁定 Agent 控制 (ESC_PAUSE_GAME)
func pause_game_async(callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IEscMenuService.pause_game_async: pure virtual method must be implemented by subclass")
	if callback.is_valid():
		callback.call({"success": false, "error_code": "NOT_IMPLEMENTED"})

## 异步请求恢复游戏运行 (ESC_RESUME_GAME)
func resume_game_async(callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IEscMenuService.resume_game_async: pure virtual method must be implemented by subclass")
	if callback.is_valid():
		callback.call({"success": false, "error_code": "NOT_IMPLEMENTED"})

## 异步请求安全存盘 (target_slot: "SLOT_01" 等, is_quicksave: bool)
func request_save_async(target_slot: String, is_quicksave: bool, callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IEscMenuService.request_save_async: pure virtual method must be implemented by subclass")
	if callback.is_valid():
		callback.call({"success": false, "error_code": "NOT_IMPLEMENTED"})

## 异步应用 ESC 设置调整 (ESC_APPLY_SETTINGS)
func apply_settings_async(_settings_patch: Dictionary, callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IEscMenuService.apply_settings_async: pure virtual method must be implemented by subclass")
	if callback.is_valid():
		callback.call({"success": false, "error_code": "NOT_IMPLEMENTED"})

## 异步请求退出世界退回网关
func exit_to_gateway_async(callback: Callable, _auto_save: bool = true, _allow_skip_unsaved: bool = false) -> void:
	EventBusCore.get_instance().emit_log("error", "IEscMenuService.exit_to_gateway_async: pure virtual method must be implemented by subclass")
	if callback.is_valid():
		callback.call({"success": false, "error_code": "NOT_IMPLEMENTED"})

## 异步请求安全优雅退出游戏
func quit_game_async(callback: Callable, _save_before_quit: bool = true, _require_save_success: bool = false, _force_quit: bool = false) -> void:
	EventBusCore.get_instance().emit_log("error", "IEscMenuService.quit_game_async: pure virtual method must be implemented by subclass")
	if callback.is_valid():
		callback.call({"success": false, "error_code": "NOT_IMPLEMENTED"})

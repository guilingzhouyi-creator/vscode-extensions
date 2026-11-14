# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Interfaces)
# 文件路径: res://frontend/domain_boundary/interfaces/i_lifecycle_service.gd
# 架构定位: Domain Boundary Interface / Engine Lifecycle Contract
# 依赖与触发: 上游: ServiceContainer, AppRoot, ESC/退出面板 | 下游: RealLifecycleService, MockLifecycleService
# 职责说明: 规范暂停/恢复、退回账号首页（软重置）与多阶段优雅/强制停机退出游戏的前端交互边界。
# 退出语义与设计依据: 前端零业务逻辑契约与对称生命周期退出规范
# ==============================================================================

## ILifecycleService：客户端暂停、登出与安全停机边界服务抽象接口
class_name ILifecycleService
extends RefCounted

## 异步请求暂停主循环与锁定后台 Agent 控制 (PAUSE_GAME)
func pause_game_async(_account_id: String, _token: String, _reason: String = "ESC_MENU", result_callback: Callable = Callable()) -> void:
	EventBusCore.get_instance().emit_log("error", "ILifecycleService.pause_game_async: not implemented")
	if result_callback.is_valid():
		result_callback.call({"success": false, "error_code": "NOT_IMPLEMENTED"})

## 异步请求恢复主循环运行 (RESUME_GAME)
func resume_game_async(_account_id: String, _token: String, result_callback: Callable = Callable()) -> void:
	EventBusCore.get_instance().emit_log("error", "ILifecycleService.resume_game_async: not implemented")
	if result_callback.is_valid():
		result_callback.call({"success": false, "error_code": "NOT_IMPLEMENTED"})

## 异步退回账号首页菜单（保存+退出网关+注销会话，保留引擎装配）(LOGOUT_TO_MENU)
func logout_to_menu_async(_account_id: String, _token: String, _target_save_slot: String = "", _save_before_quit: bool = true, result_callback: Callable = Callable()) -> void:
	EventBusCore.get_instance().emit_log("error", "ILifecycleService.logout_to_menu_async: not implemented")
	if result_callback.is_valid():
		result_callback.call({"success": false, "error_code": "NOT_IMPLEMENTED"})

## 异步请求五阶段安全优雅停机退出游戏 (REQUEST_GRACEFUL_SHUTDOWN)
func request_graceful_shutdown_async(_account_id: String, _token: String, _options: Dictionary = {}, result_callback: Callable = Callable()) -> void:
	EventBusCore.get_instance().emit_log("error", "ILifecycleService.request_graceful_shutdown_async: not implemented")
	if result_callback.is_valid():
		result_callback.call({"success": false, "error_code": "NOT_IMPLEMENTED"})

## 异步请求强制降级停机恢复 (FORCE_SHUTDOWN)
func force_shutdown_async(_account_id: String, _token: String, _options: Dictionary = {}, result_callback: Callable = Callable()) -> void:
	EventBusCore.get_instance().emit_log("error", "ILifecycleService.force_shutdown_async: not implemented")
	if result_callback.is_valid():
		result_callback.call({"success": false, "error_code": "NOT_IMPLEMENTED"})

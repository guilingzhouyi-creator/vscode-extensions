# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Interfaces)
# 文件路径: res://frontend/domain_boundary/interfaces/i_game_settings_service.gd
# 架构定位: Domain Boundary Interface / Game Settings Contract
# 依赖与触发: 上游: ServiceContainer, 设置中心视图 | 下游: RealGameSettingsService, MockGameSettingsService
# 职责说明: 规范游戏音画/UI 设置拉取、即时应用与黑屏回滚确认及恢复默认设置的前端边界接口。
# 退出语义与设计依据: 前端零业务逻辑契约与未接线接口预留规范
# ==============================================================================

## IGameSettingsService：游戏音画与显示设置边界服务抽象接口
class_name IGameSettingsService
extends RefCounted

## 异步读取当前权威游戏设置快照 (GET_GAME_SETTINGS)
func get_settings_async(_account_id: String, _token: String, result_callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IGameSettingsService.get_settings_async: not implemented")
	if result_callback.is_valid():
		result_callback.call({"success": false, "error_code": "NOT_IMPLEMENTED"})

## 异步应用设置变更（支持持久化与分辨率回滚守护）(APPLY_GAME_SETTINGS)
func apply_settings_async(_account_id: String, _token: String, _settings_patch: Dictionary, result_callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IGameSettingsService.apply_settings_async: not implemented")
	if result_callback.is_valid():
		result_callback.call({"success": false, "error_code": "NOT_IMPLEMENTED"})

## 异步确认待验证的分辨率修改 (CONFIRM_GAME_SETTINGS)
func confirm_resolution_async(_account_id: String, _token: String, result_callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IGameSettingsService.confirm_resolution_async: not implemented")
	if result_callback.is_valid():
		result_callback.call({"success": false, "error_code": "NOT_IMPLEMENTED"})

## 异步重置设置回默认配置 (RESET_GAME_SETTINGS)
func reset_defaults_async(_account_id: String, _token: String, result_callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IGameSettingsService.reset_defaults_async: not implemented")
	if result_callback.is_valid():
		result_callback.call({"success": false, "error_code": "NOT_IMPLEMENTED"})

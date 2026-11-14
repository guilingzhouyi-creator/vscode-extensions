# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Mocks)
# 文件路径: res://frontend/domain_boundary/mocks/mock_game_settings_service.gd
# 架构定位: Domain Boundary Mock / Simulated Game Settings Service
# 依赖与触发: 上游: ServiceContainer, 设置视图 | 下游: MockBaseService
# 职责说明: 提供设置快照拉取、热更新、分辨率确认与默认恢复的模拟服务实现。
# 退出语义与设计依据: 领域边界前后同构测试隔离契约
## MockGameSettingsService：游戏设置读取、应用与重置模拟服务
class_name MockGameSettingsService
extends "res://frontend/domain_boundary/interfaces/i_game_settings_service.gd"

var simulate_delay_ms: int = MockBaseService.DEFAULT_SIMULATE_DELAY_MS

func _init(delay_milliseconds: int = MockBaseService.DEFAULT_SIMULATE_DELAY_MS) -> void:
	simulate_delay_ms = delay_milliseconds

## 模拟异步拉取当前游戏设置快照
func get_settings_async(_account_id: String, _token: String, result_callback: Callable) -> void:
	var service_response := {
		"success": true,
		"data": {"settings": {}}
	}
	MockBaseService.delayed_call(
		result_callback,
		service_response,
		simulate_delay_ms
	)

## 模拟异步应用设置补丁并返回已应用字典副本
func apply_settings_async(
	_account_id: String,
	_token: String,
	settings_patch: Dictionary,
	result_callback: Callable
) -> void:
	var service_response := {
		"success": true,
		"data": {"applied_settings": settings_patch.duplicate(true)}
	}
	MockBaseService.delayed_call(
		result_callback,
		service_response,
		simulate_delay_ms
	)

## 模拟异步确认待生效的分辨率改动
func confirm_resolution_async(_account_id: String, _token: String, result_callback: Callable) -> void:
	var service_response := {
		"success": true,
		"data": {"is_pending_confirm": false}
	}
	MockBaseService.delayed_call(
		result_callback,
		service_response,
		simulate_delay_ms
	)

## 模拟异步将游戏设置恢复为默认配置
func reset_defaults_async(_account_id: String, _token: String, result_callback: Callable) -> void:
	var service_response := {
		"success": true,
		"data": {"settings": {}}
	}
	MockBaseService.delayed_call(
		result_callback,
		service_response,
		simulate_delay_ms
	)

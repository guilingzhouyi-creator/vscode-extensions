# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Mocks)
# 文件路径: res://frontend/domain_boundary/mocks/mock_lifecycle_service.gd
# 架构定位: Domain Boundary Mock / Simulated Engine Lifecycle Service
# 依赖与触发: 上游: ServiceContainer, AppRoot | 下游: MockBaseService
# 职责说明: 提供暂停/恢复、退回账号首页（软重置）与安全优雅停机的可证伪模拟服务实现。
# 退出语义与设计依据: 领域边界前后同构测试隔离契约
## MockLifecycleService：客户端暂停、登出与优雅停机模拟服务
class_name MockLifecycleService
extends "res://frontend/domain_boundary/interfaces/i_lifecycle_service.gd"

var simulate_delay_ms: int = MockBaseService.DEFAULT_SIMULATE_DELAY_MS

func _init(delay_milliseconds: int = MockBaseService.DEFAULT_SIMULATE_DELAY_MS) -> void:
	simulate_delay_ms = delay_milliseconds

## 模拟异步请求暂停游戏运行
func pause_game_async(
	_account_id: String,
	_token: String,
	_reason: String = "ESC_MENU",
	result_callback: Callable = Callable()
) -> void:
	var service_response := {
		"success": true,
		"data": {"is_paused": true}
	}
	MockBaseService.delayed_call(
		result_callback,
		service_response,
		simulate_delay_ms
	)

## 模拟异步请求恢复游戏运行
func resume_game_async(
	_account_id: String,
	_token: String,
	result_callback: Callable = Callable()
) -> void:
	var service_response := {
		"success": true,
		"data": {"is_paused": false}
	}
	MockBaseService.delayed_call(
		result_callback,
		service_response,
		simulate_delay_ms
	)

## 模拟异步退回账号首页菜单并执行会话软重置
func logout_to_menu_async(
	_account_id: String,
	_token: String,
	_target_save_slot: String = "",
	_save_before_quit: bool = true,
	result_callback: Callable = Callable()
) -> void:
	var service_response := {
		"success": true,
		"data": {"returned_to_menu": true}
	}
	MockBaseService.delayed_call(
		result_callback,
		service_response,
		simulate_delay_ms
	)

## 模拟异步执行五阶段安全优雅停机
func request_graceful_shutdown_async(
	_account_id: String,
	_token: String,
	_options: Dictionary = {},
	result_callback: Callable = Callable()
) -> void:
	var service_response := {
		"success": true,
		"data": {"graceful_shutdown": true}
	}
	MockBaseService.delayed_call(
		result_callback,
		service_response,
		simulate_delay_ms
	)

## 模拟异步执行强制降级停机
func force_shutdown_async(
	_account_id: String,
	_token: String,
	_options: Dictionary = {},
	result_callback: Callable = Callable()
) -> void:
	var service_response := {
		"success": true,
		"data": {"force_shutdown": true}
	}
	MockBaseService.delayed_call(
		result_callback,
		service_response,
		simulate_delay_ms
	)

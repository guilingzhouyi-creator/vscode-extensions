# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Mocks)
# 文件路径: res://frontend/domain_boundary/mocks/mock_esc_menu_service.gd
# 架构定位: Domain Boundary Mock / Simulated ESC Menu Service
# 依赖与触发: 上游: Frontend Views, MockServiceContainer | 下游: MockBaseService
# 职责说明: 提供可证伪的 ESC 菜单状态拉取、安全存盘与退出模拟服务实现。
# 退出语义与设计依据: 业务领域第一性原理与无头单元测试隔离契约
## MockEscMenuService：ESC 系统菜单状态、存盘与双退出模拟服务
class_name MockEscMenuService
extends "res://frontend/domain_boundary/interfaces/i_esc_menu_service.gd"

var simulate_delay_ms: int = MockBaseService.DEFAULT_SIMULATE_DELAY_MS

func _init(delay_ms: int = MockBaseService.DEFAULT_SIMULATE_DELAY_MS) -> void:
	simulate_delay_ms = delay_ms

## 模拟异步拉取 ESC 菜单当前可执行操作与未保存状态
func get_menu_state_async(callback: Callable) -> void:
	MockBaseService.delayed_call(callback, {
		"success": true,
		"can_save": true,
		"is_dirty": false,
		"allowed_actions": ["ESC_SAVE_GAME", "ESC_EXIT_TO_GATEWAY", "ESC_QUIT_GAME"]
	}, simulate_delay_ms)

## 模拟异步查询存储安全就绪状态
func query_readiness_async(callback: Callable, _context_flags: Dictionary = {}) -> void:
	MockBaseService.delayed_call(
		callback,
		{
			"success": true,
			"data": {"is_ready": true}
		},
		simulate_delay_ms
	)

## 模拟异步暂停游戏运行
func pause_game_async(callback: Callable) -> void:
	MockBaseService.delayed_call(
		callback,
		{
			"success": true,
			"data": {"is_paused": true}
		},
		simulate_delay_ms
	)

## 模拟异步恢复游戏运行
func resume_game_async(callback: Callable) -> void:
	MockBaseService.delayed_call(
		callback,
		{
			"success": true,
			"data": {"is_paused": false}
		},
		simulate_delay_ms
	)

## 模拟异步向指定存档槽位请求存盘
func request_save_async(target_slot: String, is_quicksave: bool, callback: Callable) -> void:
	MockBaseService.delayed_call(callback, {
		"success": true,
		"slot_id": target_slot,
		"is_quicksave": is_quicksave
	}, simulate_delay_ms)

## 模拟异步应用 ESC 菜单内局部设置变更
func apply_settings_async(settings_patch: Dictionary, callback: Callable) -> void:
	MockBaseService.delayed_call(
		callback,
		{
			"success": true,
			"data": {"applied_settings": settings_patch.duplicate(true)}
		},
		simulate_delay_ms
	)

## 模拟异步保存并退出当前世界返回网关
func exit_to_gateway_async(callback: Callable, _auto_save: bool = true, _allow_skip_unsaved: bool = false) -> void:
	MockBaseService.delayed_call(callback, {
		"success": true,
		"returned_to_gateway": true
	}, simulate_delay_ms)

## 模拟异步安全优雅停机退出游戏
func quit_game_async(callback: Callable, _save_before_quit: bool = true, _require_save_success: bool = false, _force_quit: bool = false) -> void:
	MockBaseService.delayed_call(callback, {
		"success": true,
		"graceful_shutdown": true
	}, simulate_delay_ms)

# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Mocks)
# 文件路径: res://frontend/domain_boundary/mocks/mock_esc_menu_service.gd
# 架构定位: Domain Boundary Mock / Simulated ESC Menu Service
# 依赖与触发: 上游: Frontend Views, MockServiceContainer | 下游: MockBaseService
# 职责说明: 提供可证伪的 ESC 菜单状态拉取、安全存盘与退出模拟数据桩。
# 退出语义与设计依据: 业务领域第一性原理与无头单元测试隔离契约
# ==============================================================================
class_name MockEscMenuService
extends "res://frontend/domain_boundary/interfaces/i_esc_menu_service.gd"

var simulate_delay_ms: int = MockBaseService.DEFAULT_SIMULATE_DELAY_MS

func _init(delay_ms: int = MockBaseService.DEFAULT_SIMULATE_DELAY_MS) -> void:
	simulate_delay_ms = delay_ms

func get_menu_state_async(callback: Callable) -> void:
	MockBaseService.delayed_call(callback, {
		"success": true,
		"can_save": true,
		"is_dirty": false,
		"allowed_actions": ["ESC_SAVE_GAME", "ESC_EXIT_TO_GATEWAY", "ESC_QUIT_GAME"]
	}, simulate_delay_ms)

func request_save_async(target_slot: String, is_quicksave: bool, callback: Callable) -> void:
	MockBaseService.delayed_call(callback, {
		"success": true,
		"slot_id": target_slot,
		"is_quicksave": is_quicksave
	}, simulate_delay_ms)

func exit_to_gateway_async(callback: Callable) -> void:
	MockBaseService.delayed_call(callback, {
		"success": true,
		"returned_to_gateway": true
	}, simulate_delay_ms)

func quit_game_async(callback: Callable) -> void:
	MockBaseService.delayed_call(callback, {
		"success": true,
		"graceful_shutdown": true
	}, simulate_delay_ms)

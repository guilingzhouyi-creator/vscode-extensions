# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Mocks)
# 文件路径: res://frontend/domain_boundary/mocks/mock_hud_sync_service.gd
# 架构定位: Domain Boundary Mock / Simulated Resident HUD Sync Service
# 依赖与触发: 上游: ServiceContainer, 未来主页 HUD | 下游: MockBaseService, MockDataCatalog
# 职责说明: 提供主页 HUD 常驻快照拉取、时钟模拟推进与本地模拟订阅实现。
# 退出语义与设计依据: 领域边界前后同构测试隔离契约
## MockHudSyncService：常驻主页 HUD 快照同步与总线订阅模拟服务
class_name MockHudSyncService
extends "res://frontend/domain_boundary/interfaces/i_hud_sync_service.gd"

var simulate_delay_ms: int = MockBaseService.DEFAULT_SIMULATE_DELAY_MS

func _init(delay_milliseconds: int = MockBaseService.DEFAULT_SIMULATE_DELAY_MS) -> void:
	simulate_delay_ms = delay_milliseconds

## 模拟异步拉取常驻主页 HUD 权威快照副本
func pull_authoritative_snapshot_async(
	_account_id: String,
	_token: String,
	_character_id: String,
	result_callback: Callable
) -> void:
	var hud_snapshot := MockDataCatalog.get_domain_data("hud_snapshot")
	var service_response := {
		"success": true,
		"data": {
			"hud_snapshot": hud_snapshot.duplicate(true),
			"world_active": true
		}
	}
	MockBaseService.delayed_call(
		result_callback,
		service_response,
		simulate_delay_ms
	)

## 模拟异步推进世界时钟并将增量小时数注入 HUD 快照
func tick_world_clock_async(
	_account_id: String,
	_token: String,
	_character_id: String,
	mutations: Dictionary,
	result_callback: Callable
) -> void:
	var hud_snapshot := MockDataCatalog.get_domain_data("hud_snapshot").duplicate(true)
	hud_snapshot["delta_hours"] = int(mutations.get("clock_hours_delta", 0))
	var service_response := {
		"success": true,
		"data": {"hud_snapshot": hud_snapshot}
	}
	MockBaseService.delayed_call(
		result_callback,
		service_response,
		simulate_delay_ms
	)

## 模拟异步派发主页 HUD 支持指令并返回指令回执
func dispatch_hud_directive_async(
	_account_id: String,
	_token: String,
	_character_id: String,
	action_type: String,
	directive_payload: Dictionary,
	result_callback: Callable
) -> void:
	var service_response := {
		"success": true,
		"data": {
			"directive_id": action_type,
			"payload": directive_payload.duplicate(true)
		}
	}
	MockBaseService.delayed_call(
		result_callback,
		service_response,
		simulate_delay_ms
	)

## 模拟订阅常驻 HUD 多信道事件（返回空令牌数组）
func subscribe_hud_channels(_callbacks: Dictionary) -> Array:
	return []

## 模拟退订常驻 HUD 事件信道（空操作）
func unsubscribe_hud_channels(_tokens: Array) -> void:
	pass

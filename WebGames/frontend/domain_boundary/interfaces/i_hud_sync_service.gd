# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Interfaces)
# 文件路径: res://frontend/domain_boundary/interfaces/i_hud_sync_service.gd
# 架构定位: Domain Boundary Interface / Resident HUD Sync Contract
# 依赖与触发: 上游: ServiceContainer, 未来主页 HUD 视图 | 下游: RealHudSyncService, MockHudSyncService
# 职责说明: 规范前端主页常驻 HUD 的权威快照拉取、时钟/状态增量同步、HUD 指令派发与总线信道订阅接口。
# 退出语义与设计依据: 前端零业务逻辑契约与未接线接口预留规范
# ==============================================================================

## IHudSyncService：常驻主页 HUD 快照同步与总线订阅抽象接口
class_name IHudSyncService
extends RefCounted

## 异步拉取权威 HUD 快照 (对齐 PULL_HUD_SNAPSHOT)
func pull_authoritative_snapshot_async(_account_id: String, _token: String, _character_id: String, callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IHudSyncService.pull_authoritative_snapshot_async: not implemented")
	if callback.is_valid():
		callback.call({"success": false, "error_code": "NOT_IMPLEMENTED"})

## 异步推进世界时钟并触发常驻 HUD 节流同步 (对齐 TICK_WORLD_CLOCK)
func tick_world_clock_async(_account_id: String, _token: String, _character_id: String, _mutations: Dictionary, callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IHudSyncService.tick_world_clock_async: not implemented")
	if callback.is_valid():
		callback.call({"success": false, "error_code": "NOT_IMPLEMENTED"})

## 异步派发主页 HUD 支持指令（如 ALLOCATE_POTENTIAL_STAT / REST_AND_ADVANCE_TIME 等）
func dispatch_hud_directive_async(_account_id: String, _token: String, _character_id: String, _action_type: String, _payload: Dictionary, callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IHudSyncService.dispatch_hud_directive_async: not implemented")
	if callback.is_valid():
		callback.call({"success": false, "error_code": "NOT_IMPLEMENTED"})

## 订阅常驻 HUD 多信道事件（返回订阅令牌数组供对称退订）
func subscribe_hud_channels(_callbacks: Dictionary) -> Array:
	EventBusCore.get_instance().emit_log("error", "IHudSyncService.subscribe_hud_channels: not implemented")
	return []

## 退订常驻 HUD 事件信道（幂等清理）
func unsubscribe_hud_channels(_tokens: Array) -> void:
	EventBusCore.get_instance().emit_log("error", "IHudSyncService.unsubscribe_hud_channels: not implemented")

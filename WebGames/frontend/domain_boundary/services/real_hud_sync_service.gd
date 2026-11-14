# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Services)
# 文件路径: res://frontend/domain_boundary/services/real_hud_sync_service.gd
# 架构定位: Domain Boundary Adapter / Real Resident HUD Sync Bridge
# 依赖与触发: 上游: ServiceContainer, ServiceLocator | 下游: RealProtocolBridge, AuthoritativeHudSyncService
# 职责说明: 实现 IHudSyncService 接口，负责主页 HUD 常驻快照拉取、时钟推进、指令派发与信道订阅隔离。
# 退出语义与设计依据: 表现层零计算纪律与单源事件订阅契约
# ==============================================================================

## RealHudSyncService：直连后端权威同步服务的主页 HUD 真实边界服务实现
class_name RealHudSyncService
extends "res://frontend/domain_boundary/interfaces/i_hud_sync_service.gd"

const RealProtocolBridge = preload("res://frontend/domain_boundary/services/real_protocol_bridge.gd")
const AuthoritativeHudSyncService = preload("res://backend/domains/world_state/services/authoritative_hud_sync_service.gd")

## 异步向后端拉取当前活跃角色的权威 HUD 快照
func pull_authoritative_snapshot_async(account_id: String, token: String, character_id: String, result_callback: Callable) -> void:
	RealProtocolBridge.dispatch_and_reply("world_state", "PULL_HUD_SNAPSHOT", {}, account_id, token, result_callback, "data", {}, character_id)

## 异步触发世界时钟推进与状态增量同步
func tick_world_clock_async(account_id: String, token: String, character_id: String, mutations: Dictionary, result_callback: Callable) -> void:
	RealProtocolBridge.dispatch_and_reply("world_state", "TICK_WORLD_CLOCK", mutations, account_id, token, result_callback, "data", {}, character_id)

## 异步派发主页 HUD 控制指令至世界状态统一调度器
func dispatch_hud_directive_async(account_id: String, token: String, character_id: String, action_type: String, directive_payload: Dictionary, result_callback: Callable) -> void:
	RealProtocolBridge.dispatch_and_reply("world_state", action_type, directive_payload, account_id, token, result_callback, "data", {}, character_id)

## 订阅常驻 HUD 多信道后端事件，返回可用于退订的令牌数组
func subscribe_hud_channels(callbacks: Dictionary) -> Array:
	return AuthoritativeHudSyncService.subscribe_hud_channels(
		callbacks.get("on_snapshot", Callable()),
		callbacks.get("on_wallet", Callable()),
		callbacks.get("on_prologue", Callable()),
		callbacks.get("on_world_entered", Callable()),
		callbacks.get("on_stat_mutated", Callable()),
		callbacks.get("on_clock_advanced", Callable())
	)

## 按令牌数组幂等退订常驻 HUD 事件信道
func unsubscribe_hud_channels(tokens: Array) -> void:
	AuthoritativeHudSyncService.unsubscribe_hud_channels(tokens)

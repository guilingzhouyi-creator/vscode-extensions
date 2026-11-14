# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Services)
# 文件路径: res://frontend/domain_boundary/services/real_lifecycle_service.gd
# 架构定位: Domain Boundary Adapter / Real Lifecycle Service Bridge
# 依赖与触发: 上游: ServiceContainer, ServiceLocator | 下游: RealProtocolBridge
# 职责说明: 实现 ILifecycleService 接口，封装暂停/恢复、退回账号首页（软重置）与安全优雅/强制停机协议。
# 退出语义与设计依据: 卡拉尔对称生命周期解体契约 (Inv-SYMMETRIC-TEARDOWN-4)
## RealLifecycleService：直连后端生命周期协议的暂停与停机真实边界服务实现
class_name RealLifecycleService
extends "res://frontend/domain_boundary/interfaces/i_lifecycle_service.gd"

const RealProtocolBridge = preload("res://frontend/domain_boundary/services/real_protocol_bridge.gd")

## 异步向后端发送游戏暂停指令并附带暂停原因
func pause_game_async(
	account_id: String,
	token: String,
	reason: String = "ESC_MENU",
	result_callback: Callable = Callable()
) -> void:
	RealProtocolBridge.dispatch_and_reply(
		"lifecycle",
		"PAUSE_GAME",
		{"reason": reason},
		account_id,
		token,
		result_callback
	)

## 异步向后端发送恢复游戏运行指令
func resume_game_async(
	account_id: String,
	token: String,
	result_callback: Callable = Callable()
) -> void:
	RealProtocolBridge.dispatch_and_reply(
		"lifecycle",
		"RESUME_GAME",
		{},
		account_id,
		token,
		result_callback
	)

## 异步请求保存并退出至账号首页菜单（执行软重置）
func logout_to_menu_async(
	account_id: String,
	token: String,
	target_save_slot: String = "",
	save_before_quit: bool = true,
	result_callback: Callable = Callable()
) -> void:
	RealProtocolBridge.dispatch_and_reply("lifecycle", "LOGOUT_TO_MENU", {
		"slot_id": target_save_slot,
		"save_before_quit": save_before_quit
	}, account_id, token, result_callback)

## 异步请求执行五阶段安全优雅停机并持久化会话状态
func request_graceful_shutdown_async(
	account_id: String,
	token: String,
	options: Dictionary = {},
	result_callback: Callable = Callable()
) -> void:
	RealProtocolBridge.dispatch_and_reply(
		"lifecycle",
		"REQUEST_GRACEFUL_SHUTDOWN",
		options,
		account_id,
		token,
		result_callback
	)

## 异步请求强制停机降级退出
func force_shutdown_async(
	account_id: String,
	token: String,
	options: Dictionary = {},
	result_callback: Callable = Callable()
) -> void:
	RealProtocolBridge.dispatch_and_reply(
		"lifecycle",
		"FORCE_SHUTDOWN",
		options,
		account_id,
		token,
		result_callback
	)

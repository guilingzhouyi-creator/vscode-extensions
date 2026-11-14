# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Services)
# 文件路径: res://frontend/domain_boundary/services/real_game_settings_service.gd
# 架构定位: Domain Boundary Adapter / Real Game Settings Service Bridge
# 依赖与触发: 上游: ServiceContainer, ServiceLocator | 下游: RealProtocolBridge
# 职责说明: 实现 IGameSettingsService 接口，经由统一协议调度器透传设置读取、热应用、确认与重置指令。
# 退出语义与设计依据: 表现层零计算纪律与配置参数边界规范
## RealGameSettingsService：直连后端协议的游戏设置真实边界服务实现
class_name RealGameSettingsService
extends "res://frontend/domain_boundary/interfaces/i_game_settings_service.gd"

const RealProtocolBridge = preload("res://frontend/domain_boundary/services/real_protocol_bridge.gd")

## 异步拉取权威游戏设置快照
func get_settings_async(account_id: String, token: String, callback: Callable) -> void:
	RealProtocolBridge.dispatch_and_reply(
		"game_settings",
		"GET_GAME_SETTINGS",
		{},
		account_id,
		token,
		callback
	)

## 异步向后端提交并应用游戏设置补丁
func apply_settings_async(
	account_id: String,
	token: String,
	patch: Dictionary,
	callback: Callable
) -> void:
	RealProtocolBridge.dispatch_and_reply(
		"game_settings",
		"APPLY_GAME_SETTINGS",
		patch,
		account_id,
		token,
		callback
	)

## 异步确认待验证的新分辨率设置
func confirm_resolution_async(account_id: String, token: String, callback: Callable) -> void:
	RealProtocolBridge.dispatch_and_reply(
		"game_settings",
		"CONFIRM_GAME_SETTINGS",
		{},
		account_id,
		token,
		callback
	)

## 异步将游戏设置恢复为默认权威配置
func reset_defaults_async(account_id: String, token: String, callback: Callable) -> void:
	RealProtocolBridge.dispatch_and_reply(
		"game_settings",
		"RESET_GAME_SETTINGS",
		{},
		account_id,
		token,
		callback
	)

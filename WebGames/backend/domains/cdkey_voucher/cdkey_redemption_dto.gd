# ==============================================================================
# 模块归属: 业务领域层 (Domains · 商业化与活动集群 (Monetization & Events))
# 文件路径: res://backend/domains/cdkey_voucher/cdkey_redemption_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: cdkey_voucher | 配置: config/domains/cdkey_voucher.json | 信号: EventBus 领域广播
# 职责说明: 规范 CD-Key 兑换与回滚事务的上下文参数，消除散落标量参数泥团（GOV-DAT-001）。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## CDKeyRedemptionDTO：Value Object DTO / Data Transport Model
class_name CDKeyRedemptionDTO
extends RefCounted

## Request：网络请求数据传输模型
class Request extends RefCounted:
	var code: String = ""
	var user_id: String = ""
	var batch_id: String = ""
	var channel_tag: String = ""
	var signature: String = ""
	var context: Dictionary = {}

	## 构造兑换请求 DTO
	func _init(
		initial_code: String = "",
		initial_user_id: String = "",
		initial_batch_id: String = "",
		initial_channel_tag: String = "",
		initial_signature: String = "",
		initial_context: Dictionary = {}
	) -> void:
		code = initial_code
		user_id = initial_user_id
		batch_id = initial_batch_id
		channel_tag = initial_channel_tag
		signature = initial_signature
		context = initial_context

## RollbackRequest：回滚请求数据传输模型
class RollbackRequest extends RefCounted:
	var code: String = ""
	var user_id: String = ""
	var reason: String = ""
	var rollback_token: String = ""

	## 构造回滚请求 DTO
	func _init(
		initial_code: String = "",
		initial_user_id: String = "",
		initial_reason: String = "",
		initial_rollback_token: String = ""
	) -> void:
		code = initial_code
		user_id = initial_user_id
		reason = initial_reason
		rollback_token = initial_rollback_token

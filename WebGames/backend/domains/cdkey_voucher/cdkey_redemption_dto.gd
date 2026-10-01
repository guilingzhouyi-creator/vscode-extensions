# ==============================================================================
# 模块归属: 业务领域层 (Domains · 商业化与活动集群 (Monetization & Events))
# 文件路径: res://backend/domains/cdkey_voucher/cdkey_redemption_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: cdkey_voucher | 配置: config/domains/cdkey_voucher.json | 信号: EventBus 领域广播
# 职责说明: 规范 CD-Key 兑换与回滚事务的上下文参数，消除散落标量参数泥团（GOV-DAT-001）。
# 设计依据: 业务领域第一性原理 / Phase 97 施工细则规范
# ==============================================================================

class_name CDKeyRedemptionDTO
extends RefCounted

class Request extends RefCounted:
	var code: String = ""
	var user_id: String = ""
	var batch_id: String = ""
	var channel_tag: String = ""
	var signature: String = ""
	var context: Dictionary = {}

	func _init(
		p_code: String = "",
		p_user_id: String = "",
		p_batch_id: String = "",
		p_channel_tag: String = "",
		p_signature: String = "",
		p_context: Dictionary = {}
	) -> void:
		code = p_code
		user_id = p_user_id
		batch_id = p_batch_id
		channel_tag = p_channel_tag
		signature = p_signature
		context = p_context

class RollbackRequest extends RefCounted:
	var code: String = ""
	var user_id: String = ""
	var reason: String = ""
	var rollback_token: String = ""

	func _init(
		p_code: String = "",
		p_user_id: String = "",
		p_reason: String = "",
		p_rollback_token: String = ""
	) -> void:
		code = p_code
		user_id = p_user_id
		reason = p_reason
		rollback_token = p_rollback_token

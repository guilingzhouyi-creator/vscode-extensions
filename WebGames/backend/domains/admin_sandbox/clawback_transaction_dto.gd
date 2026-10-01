# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/admin_sandbox/clawback_transaction_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: admin_sandbox, currency_economy | 配置: infrastructure.admin.json | 信号: EventBus 领域广播
# 职责说明: 封装沙盒运营资产追缴事务上下文载荷，消除散落标量参数泥团（GOV-DAT-001）。
# 设计依据: 业务领域第一性原理 / Phase 97 施工细则规范
# ==============================================================================

class_name ClawbackTransactionDTO
extends RefCounted

var admin: AdminPermissionAggregate = null
var mode: String = "online"
var target_key: String = ""
var amount: int = 0
var reason: String = ""
var wallet: CharacterWalletEntity = null
var inventory: WearableInventoryAggregate = null
var item_id: String = ""
var instance_id: String = ""
var audit_id: String = ""

func _init(
	p_admin: AdminPermissionAggregate = null,
	p_mode: String = "online",
	p_target_key: String = "",
	p_amount: int = 0,
	p_reason: String = "",
	p_wallet: CharacterWalletEntity = null,
	p_audit_id: String = ""
) -> void:
	admin = p_admin
	mode = p_mode
	target_key = p_target_key
	amount = p_amount
	reason = p_reason
	wallet = p_wallet
	audit_id = p_audit_id

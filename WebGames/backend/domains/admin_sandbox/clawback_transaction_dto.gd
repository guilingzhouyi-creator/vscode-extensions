# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/admin_sandbox/clawback_transaction_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: admin_sandbox, currency_economy | 配置: infrastructure.admin.json | 信号: EventBus 领域广播
# 职责说明: 封装沙盒运营资产追缴事务上下文载荷，消除散落标量参数泥团（GOV-DAT-001）。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## ClawbackTransactionDTO：Value Object DTO / Data Transport Model
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

## 构造资产追缴事务上下文载荷
func _init(
	initial_admin: AdminPermissionAggregate = null,
	initial_mode: String = "online",
	initial_target_key: String = "",
	initial_amount: int = 0,
	initial_reason: String = "",
	initial_wallet: CharacterWalletEntity = null,
	initial_audit_id: String = ""
) -> void:
	admin = initial_admin
	mode = initial_mode
	target_key = initial_target_key
	amount = initial_amount
	reason = initial_reason
	wallet = initial_wallet
	audit_id = initial_audit_id

# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/admin_sandbox/clawback_service.gd
# 架构定位: Domain Service / State Orchestrator
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: currency_economy | 配置: infrastructure.admin.json | 信号: EventBus 领域广播
# 职责说明: 追缴由外挂 / 利用漏洞等机制非法刷取的资产（货币 / 原型物品 / 实例物品）， 供开发商运营部门使用。边界规范： - 仅联机模式（RUN_MODE_ONLINE）可用，单机沙盒一律拒绝； - 权限门槛 LEVEL_GAME_MASTER（追缴属运营重操作）； - 货币追缴全额扣减、支持扣至负数（超额部分记为欠账/赤字，钱包 is_in_debt 语义，允许突破下界）；物品追缴不得超过实际持有数（超额钳制）； - 全部追缴经 GMArbitrationAuditService 留痕（操作者 / 原因码 / 数量 / 签名）。 运行模式默认值由 config/infrastructure/admin.json 的 run/mode 驱动。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## ClawbackService：Domain Service / State Orchestrator
class_name ClawbackService
extends RefCounted

const PoolableDtoBase = preload("res://backend/domains/persistence_protocol/poolable_dto_base.gd")

const RUN_MODE_ONLINE: String = "online"
const RUN_MODE_STANDALONE: String = "standalone"

## 追缴原因码（边界规范：外挂 / 漏洞 / 人工审计）
const REASON_CHEAT_DETECTED: String = "CHEAT_DETECTED"
const REASON_EXPLOIT_ABUSE: String = "EXPLOIT_ABUSE"
const REASON_MANUAL_AUDIT: String = "MANUAL_AUDIT"

static var _processed_audits: Dictionary = {}

## 强类型追缴请求上下文（收敛多参数并预留商业化审计扩展字段）
class ClawbackContext extends PoolableDtoBase:
	var admin: AdminPermissionAggregate = null
	var mode: String = RUN_MODE_ONLINE
	var reason: String = ""
	var audit_id: String = ""
	var currency_key: String = ""
	var amount: int = 0
	var wallet: CharacterWalletEntity = null
	var canonical_id: String = ""
	var quantity: int = 0
	var inventory: WearableInventoryAggregate = null
	var library: AccountItemLibrary = null
	var item_id: String = ""
	var item_uid: String = ""

	## 重置追缴请求上下文状态，供对象池无堆分配复用
	func reset_state() -> void:
		super.reset_state()
		admin = null
		mode = RUN_MODE_ONLINE
		reason = ""
		audit_id = ""
		currency_key = ""
		amount = 0
		wallet = null
		canonical_id = ""
		quantity = 0
		inventory = null
		library = null
		item_id = ""
		item_uid = ""

## S3-03 有界保留：追缴幂等/审计键超容量时按插入序裁剪最旧（内存有界，防无限增长）
static func _prune_processed_audits() -> void:
	# 边界约束：单次 keys 快照裁剪最旧溢出项（消除 while keys()[0] 每轮重建的 O(k×N)）
	FifoBudget.trim_oldest(_processed_audits, GameConfig.get_int("infrastructure.admin", "idempotency/max_records", 1000))

static func _begin_clawback_tx(
	admin: AdminPermissionAggregate,
	mode: String,
	default_prefix: String,
	audit_id: String
) -> Dictionary:
	var gate := _gate(admin, mode)
	if not gate.success:
		return {"ok": false, "response": gate}
	var transaction_id: String = audit_id if not audit_id.is_empty() else "%s_%s" % [default_prefix, str(Time.get_ticks_usec())]
	if _processed_audits.has(transaction_id):
		return {"ok": false, "response": {"success": false, "error_code": "IDEMPOTENCY_REPLAY", "audit_id": transaction_id}}
	return {"ok": true, "tx_id": transaction_id}

static func _commit_clawback_tx(
	admin: AdminPermissionAggregate,
	action: String,
	transaction_id: String,
	details: Dictionary
) -> void:
	_audit(admin, action, details)
	_processed_audits[transaction_id] = true
	_prune_processed_audits()

## 当前运行模式（联机服务端宿主默认 online；单机进程在配置里置 standalone）
static func current_run_mode() -> String:
	return GameConfig.get_string("infrastructure.admin", "run/mode", RUN_MODE_ONLINE)

## 强类型上下文货币追缴入口（供运营后台与可扩展工作流调用）
static func clawback_currency_with_context(context: ClawbackContext) -> Dictionary:
	if context == null:
		return {"success": false, "error_code": "CLAWBACK_INVALID_TARGET"}
	return clawback_currency(context.admin, context.mode, context.currency_key, context.amount, context.reason, context.wallet, context.audit_id)

## 货币追缴：按币种回扣非法刷取金额，支持扣至负数（超额部分记为欠账/赤字，
## 钱包 is_in_debt 语义；负数余额即对运营方的欠账，可由 get_net_debt_copper 查询）
static func clawback_currency(
	admin: AdminPermissionAggregate,
	mode: String,
	currency_key: String,
	amount: int,
	reason: String,
	wallet: CharacterWalletEntity,
	audit_id: String = ""
) -> Dictionary:
	var transaction_begin := _begin_clawback_tx(admin, mode, "CLAWBACK_%s" % currency_key, audit_id)
	if not bool(transaction_begin.get("ok", false)):
		if not _gate(admin, mode).success:
			return transaction_begin["response"]
		if wallet == null or amount <= 0 or not _currency_keys().has(currency_key):
			return {"success": false, "error_code": "CLAWBACK_INVALID_TARGET"}
		return transaction_begin["response"]
	if wallet == null or amount <= 0 or not _currency_keys().has(currency_key):
		return {"success": false, "error_code": "CLAWBACK_INVALID_TARGET"}
	var transaction_id: String = str(transaction_begin["tx_id"])

	var balance_before := _wallet_balance(wallet, currency_key)
	var delta := {}
	delta[currency_key] = - amount
	var applied := wallet.apply_transaction(delta, true)
	if not applied.get("success", false):
		return {"success": false, "error_code": applied.get("error_code", "CLAWBACK_NOT_ATOMIC"), "audit_id": transaction_id}
	var balance_after := _wallet_balance(wallet, currency_key)
	var into_debt := wallet.is_in_debt()
	_commit_clawback_tx(admin, "CLAWBACK_CURRENCY", transaction_id, {
		"audit_id": transaction_id,
		"reason": reason, "currency_key": currency_key,
		"requested": amount, "actual_clawed": amount,
		"balance_before": balance_before, "balance_after": balance_after,
		"into_debt": into_debt, "net_debt_copper": wallet.get_net_debt_copper()
	})
	return {
		"success": true,
		"currency_key": currency_key,
		"requested": amount,
		"actual_clawed": amount,
		"balance_before": balance_before,
		"balance_after": balance_after,
		"into_debt": into_debt,
		"net_debt_copper": wallet.get_net_debt_copper(),
		"audit_id": transaction_id
	}

## 强类型上下文原型物品追缴入口
static func clawback_item_prototype_with_context(context: ClawbackContext) -> Dictionary:
	if context == null:
		return {"success": false, "error_code": "CLAWBACK_INVALID_TARGET"}
	return clawback_item_prototype(context.admin, context.mode, context.canonical_id, context.quantity, context.reason, context.inventory, context.library, context.audit_id)

## 原型物品追缴：按 canonical_id 回扣指定数量的同原型实例，超额钳制到实际持有数
static func clawback_item_prototype(
	admin: AdminPermissionAggregate,
	mode: String,
	canonical_id: String,
	quantity: int,
	reason: String,
	inventory: WearableInventoryAggregate,
	library: AccountItemLibrary = null,
	audit_id: String = ""
) -> Dictionary:
	var transaction_begin := _begin_clawback_tx(admin, mode, "CLAWBACK_ITEM_%s" % canonical_id, audit_id)
	if not bool(transaction_begin.get("ok", false)):
		var gate_check: Dictionary = _gate(admin, mode)
		if not gate_check.success:
			return gate_check
		if inventory == null or canonical_id.is_empty() or quantity <= 0:
			return {"success": false, "error_code": "CLAWBACK_INVALID_TARGET", "message": _msg("clawback_invalid_target")}
		return transaction_begin["response"]
	if inventory == null or canonical_id.is_empty() or quantity <= 0:
		return {
			"success": false,
			"error_code": "CLAWBACK_INVALID_TARGET",
			"message": _msg("clawback_invalid_target")
		}
	var transaction_id: String = str(transaction_begin["tx_id"])
	var inventory_snapshot := inventory.snapshot()

	var matches: Array = []
	for stored_item in inventory.storage_items:
		if stored_item is ItemEntity and stored_item.template_id == canonical_id:
			matches.append(stored_item)
	for equipped_item in inventory.equipped_slots.values():
		if equipped_item is ItemEntity and equipped_item.template_id == canonical_id:
			matches.append(equipped_item)
	var actual := mini(quantity, matches.size())
	if actual <= 0:
		return {
			"success": false,
			"error_code": "CLAWBACK_NOTHING_TO_CLAW",
			"message": _msg("clawback_nothing_to_claw")
		}
	for match_index in range(actual):
		if inventory.remove_owned_item(matches[match_index]) == WearableInventoryAggregate.RemovalOutcome.NOT_FOUND:
			inventory.restore(inventory_snapshot)
			return {"success": false, "error_code": "CLAWBACK_NOT_ATOMIC", "audit_id": transaction_id}
	if library != null:
		ItemStatisticsSolver.record_item_event(library, ItemStatisticsSolver.EVENT_ITEM_CLAWED_BACK, canonical_id, actual, null, null, {
			"transaction_id": "CLAWBACK_ITEM"
		})
	_commit_clawback_tx(admin, "CLAWBACK_ITEM_PROTOTYPE", transaction_id, {
		"audit_id": transaction_id,
		"reason": reason, "canonical_id": canonical_id,
		"requested": quantity, "actual_clawed": actual, "clamped": actual < quantity
	})
	return {
		"success": true,
		"canonical_id": canonical_id,
		"requested": quantity,
		"actual_clawed": actual,
		"clamped": actual < quantity,
		"audit_id": transaction_id
	}

## 强类型上下文实例物品追缴入口
static func clawback_item_instance_with_context(context: ClawbackContext) -> Dictionary:
	if context == null:
		return {"success": false, "error_code": "CLAWBACK_INVALID_TARGET"}
	return clawback_item_instance(context.admin, context.mode, context.item_id, context.reason, context.inventory, context.library, context.item_uid, context.audit_id)

## 实例物品追缴：按 item_uid 精确回扣（权威），item_id 兼容回退（针对定向刷取的唯一实例）
static func clawback_item_instance(
	admin: AdminPermissionAggregate,
	mode: String,
	item_id: String,
	reason: String,
	inventory: WearableInventoryAggregate,
	library: AccountItemLibrary = null,
	item_uid: String = "",
	audit_id: String = ""
) -> Dictionary:
	var key_part: String = item_uid if not item_uid.is_empty() else item_id
	var transaction_begin := _begin_clawback_tx(admin, mode, "CLAWBACK_INSTANCE_%s" % key_part, audit_id)
	if not bool(transaction_begin.get("ok", false)):
		var gate_check: Dictionary = _gate(admin, mode)
		if not gate_check.success:
			return gate_check
		if inventory == null or (item_id.is_empty() and item_uid.is_empty()):
			return {"success": false, "error_code": "CLAWBACK_INVALID_TARGET", "message": _msg("clawback_invalid_target")}
		return transaction_begin["response"]
	if inventory == null or (item_id.is_empty() and item_uid.is_empty()):
		return {
			"success": false,
			"error_code": "CLAWBACK_INVALID_TARGET",
			"message": _msg("clawback_invalid_target")
		}
	var transaction_id: String = str(transaction_begin["tx_id"])

	var target_item: ItemEntity = inventory.find_item_by_item_uid(item_uid) if not item_uid.is_empty() else inventory.find_item_by_item_id(item_id)
	if target_item == null:
		return {
			"success": false,
			"error_code": "CLAWBACK_NOTHING_TO_CLAW",
			"message": _msg("clawback_nothing_to_claw")
		}
	if inventory.remove_owned_item(target_item) == WearableInventoryAggregate.RemovalOutcome.NOT_FOUND:
		return {"success": false, "error_code": "CLAWBACK_NOT_ATOMIC", "audit_id": transaction_id}
	if library != null:
		ItemStatisticsSolver.record_item_event(library, ItemStatisticsSolver.EVENT_ITEM_CLAWED_BACK, target_item.template_id, 1, null, null, {
			"uid": target_item.item_uid,
			"transaction_id": "CLAWBACK_ITEM"
		})
	_commit_clawback_tx(admin, "CLAWBACK_ITEM_INSTANCE", transaction_id, {
		"audit_id": transaction_id,
		"reason": reason, "item_id": item_id, "item_uid": target_item.item_uid, "template_id": target_item.template_id, "actual_clawed": 1
	})
	return {"success": true, "item_id": item_id, "item_uid": target_item.item_uid, "template_id": target_item.template_id, "actual_clawed": 1, "audit_id": transaction_id}

# ==============================================================================
# 内部实现
# ==============================================================================

## 边界门禁：联机模式（服务端独立判定 + 调用方意图双满足）+ LEVEL_GAME_MASTER
## + CLAWBACK 授权权限（权限清单规范：空权限集合不能仅凭等级放行——权限集合为权威）
static func _gate(admin: AdminPermissionAggregate, mode: String) -> Dictionary:
	if mode != RUN_MODE_ONLINE or current_run_mode() != RUN_MODE_ONLINE:
		return {
			"success": false,
			"error_code": "CLAWBACK_OFFLINE_FORBIDDEN",
			"message": _msg("clawback_offline_forbidden")
		}
	if admin == null or not admin.has_permission(AdminPermissionAggregate.AdminLevel.LEVEL_GAME_MASTER) \
		or not admin.has_granted_permission("CLAWBACK"):
		return {
			"success": false,
			"error_code": "CLAWBACK_PERMISSION_DENIED",
			"message": _msg("clawback_permission_denied")
		}
	return {"success": true}

static func _currency_keys() -> Array:
	return GameConfig.get_array("domains.currency", "debt/allowed_currencies", CharacterWalletEntity.CURRENCY_FIELDS)

static func _wallet_balance(wallet: CharacterWalletEntity, currency_key: String) -> int:
	match currency_key:
		"copper": return wallet.copper
		"silver": return wallet.silver
		"gold": return wallet.gold
		"platinum": return wallet.platinum
		"mana_monocrystals": return wallet.mana_monocrystals
	return 0

## 追缴留痕：复用 GM 仲裁审计（操作者 / 动作 / 详情 / 签名）
static func _audit(admin: AdminPermissionAggregate, action: String, details: Dictionary) -> void:
	var admin_id := admin.authorized_admin_id if not admin.authorized_admin_id.is_empty() else "CLI_OPS"
	GMArbitrationAuditService.record_audit(admin_id, action, details)

static func _msg(key: String) -> String:
	return GameConfig.msg("admin", key)

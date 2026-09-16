# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/commission_quest/commission_fsm.gd
# 架构定位: Domain FSM / Lifecycle Session Engine
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/commission_quest.json | 信号: EventBus 领域广播
# 职责说明: 接取质押保证金、交付验收结算入账、违约没收保证金与信誉扣分
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name CommissionFSM
extends RefCounted

# GAP-03 修复：幂等保护（与 workshop/gacha/quest 奖励同模式）
static var _completed_transactions: Dictionary = {}

## 有界保留：超容量按插入序裁剪最旧记录（内存有界，防无限增长）
static func _prune_completed() -> void:
	# P4：单次 keys 快照裁剪最旧溢出项（消除 while keys()[0] 每轮重建的 O(k×N)）
	FifoBudget.trim_oldest(_completed_transactions, GameConfig.get_int("infrastructure.admin", "idempotency/max_records", 1000))

## 接取委托：幂等键 → 状态/资质/保证金逐级校验 → 扣保证金置进行中并写期限
static func accept_commission(
	commission: CommissionAggregate,
	assignee_acc_id: String,
	adventurer_tier: CommissionAggregate.CommissionTier,
	assignee_wallet: CharacterWalletEntity,
	current_time_utc: int,
	duration_seconds: int = 86400,
	transaction_id: String = "" # GAP-03 可选幂等键
) -> Dictionary:
	var tx_id := transaction_id if not transaction_id.is_empty() \
		else "COMMISSION_ACCEPT_%s_%s" % [commission.commission_id, str(Time.get_ticks_usec())]
	if _completed_transactions.has(tx_id):
		return _completed_transactions[tx_id]

	if commission.status != CommissionAggregate.CommissionStatus.POSTED_AVAILABLE:
		return {
			"success": false,
			"error_code": "COMMISSION_UNAVAILABLE",
			"error_message": _msg("already_accepted")
		}

	if not CommissionSettlementSolver.check_qualification(commission, adventurer_tier):
		return {
			"success": false,
			"error_code": "TIER_TOO_LOW",
			"error_message": _msg("tier_insufficient")
		}

	if assignee_wallet.gold < commission.security_deposit_required:
		return {
			"success": false,
			"error_code": "INSUFFICIENT_DEPOSIT",
			"error_message": _msg("deposit_insufficient") % commission.security_deposit_required
		}

	# 扣除保证金
	assignee_wallet.gold -= commission.security_deposit_required
	commission.status = CommissionAggregate.CommissionStatus.ACCEPTED_IN_PROGRESS
	commission.assignee_account_id = assignee_acc_id
	commission.accept_timestamp_utc = current_time_utc
	commission.deadline_timestamp_utc = current_time_utc + duration_seconds

	var result := {
		"success": true,
		"commission_id": commission.commission_id,
		"deadline_utc": commission.deadline_timestamp_utc
	}
	_completed_transactions[tx_id] = result.duplicate(true)
	_prune_completed()
	return result

## 交付验收结算：返还保证金 + 净赏金入账，公会税入金库，置 SETTLED_SUCCESS
static func settle_successful_commission(
	commission: CommissionAggregate,
	assignee_wallet: CharacterWalletEntity,
	guild_treasury: OrganizationAggregate,
	transaction_id: String = "" # GAP-03 可选幂等键
) -> Dictionary:
	var tx_id := transaction_id if not transaction_id.is_empty() \
		else "COMMISSION_SETTLE_%s_%s" % [commission.commission_id, str(Time.get_ticks_usec())]
	if _completed_transactions.has(tx_id):
		return _completed_transactions[tx_id]

	if commission.status != CommissionAggregate.CommissionStatus.ACCEPTED_IN_PROGRESS and commission.status != CommissionAggregate.CommissionStatus.COMPLETED_PENDING:
		return {
			"success": false,
			"error_code": "INVALID_STATUS",
			"error_message": _msg("invalid_settle_state")
		}

	var split = CommissionSettlementSolver.calculate_payout_split(commission)

	# 返还保证金 + 净赏金
	var total_payout_gold = split["net_gold_to_adventurer"] + commission.security_deposit_required
	assignee_wallet.apply_delta({
		"gold": total_payout_gold,
		"mana_monocrystals": split["net_crystals_to_adventurer"]
	})

	if guild_treasury != null:
		guild_treasury.treasury_gold_coins += split["tax_gold_to_guild"]
		guild_treasury.treasury_mana_crystals += split["tax_crystals_to_guild"]

	commission.status = CommissionAggregate.CommissionStatus.SETTLED_SUCCESS

	var result := {
		"success": true,
		"total_gold_received": total_payout_gold,
		"crystals_received": split["net_crystals_to_adventurer"],
		"guild_tax_gold": split["tax_gold_to_guild"]
	}
	_completed_transactions[tx_id] = result.duplicate(true)
	_prune_completed()
	return result

## 违约处置：没收保证金进公会金库，置 FAILED_DEFAULTED
static func handle_commission_breach(
	commission: CommissionAggregate,
	guild_treasury: OrganizationAggregate,
	transaction_id: String = "" # GAP-03 可选幂等键
) -> Dictionary:
	var tx_id := transaction_id if not transaction_id.is_empty() \
		else "COMMISSION_BREACH_%s_%s" % [commission.commission_id, str(Time.get_ticks_usec())]
	if _completed_transactions.has(tx_id):
		return _completed_transactions[tx_id]

	if commission.status != CommissionAggregate.CommissionStatus.ACCEPTED_IN_PROGRESS:
		return {
			"success": false,
			"error_code": "NOT_IN_PROGRESS"
		}

	# 违约：没收保证金进公会金库
	if guild_treasury != null:
		guild_treasury.treasury_gold_coins += commission.security_deposit_required

	commission.status = CommissionAggregate.CommissionStatus.FAILED_DEFAULTED
	var result := {
		"success": true,
		"forfeited_deposit": commission.security_deposit_required,
		"penalty_applied": true
	}
	_completed_transactions[tx_id] = result.duplicate(true)
	_prune_completed()
	return result

# ==============================================================================
# 配置读取
# ==============================================================================

static func _msg(key: String) -> String:
	return GameConfig.msg("commission_quest", key)

# ==============================================================================
# 单元测试：兑换流程审计与测试体系（Phase 37 S4 验收）
# 文件路径: res://tests/unit/infrastructure/test_flow_orchestration.gd
# 覆盖: TC-FLOW-S4-01/05/06/07 —— 流程闭环 / 重复事务键去重 /
#       投递失败恢复（DISPATCH_PENDING + 重发）/ 审计记录可回溯
# ==============================================================================
class_name TestFlowOrchestrationDomain
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "Phase 37: 兑换流程审计与测试体系验收"

	results.append(_test_flow_full_cycle())
	results.append(_test_duplicate_transaction())
	results.append(_test_dispatch_pending_recovery())
	results.append(_test_audit_record_traceable())
	results.append(_test_prune_retention())

	var passed_cnt := 0
	for r in results:
		if r.get("passed", false):
			passed_cnt += 1
	return {
		"domain": domain_name,
		"passed_count": passed_cnt,
		"total_count": results.size(),
		"all_passed": (passed_cnt == results.size()),
		"results": results
	}

## TC-FLOW-S4-01: 完整流程闭环（判定→核销→记录→投递 DISPATCHED）
static func _test_flow_full_cycle() -> Dictionary:
	RedemptionFlowOrchestrator.reset_records()
	var req := _build_request("TX_FLOW_1", null)
	req["mailbox"] = MailboxManager.new()
	var res := RedemptionFlowOrchestrator.process_redemption(req)
	var passed = res.get("success", false) and res.get("code", "") == "OK" \
		and res.get("record_status", "") == "DISPATCHED"
	return { "test": "TC-FLOW-S4-01: 完整兑换流程闭环（五阶段 DISPATCHED）", "passed": passed }

## TC-FLOW-S4-05: 同一事务键重复提交去重
static func _test_duplicate_transaction() -> Dictionary:
	RedemptionFlowOrchestrator.reset_records()
	var req := _build_request("TX_DUP_1", null)
	req["mailbox"] = MailboxManager.new()
	var first := RedemptionFlowOrchestrator.process_redemption(req)
	var second := RedemptionFlowOrchestrator.process_redemption(req)
	var passed = first.get("success", false) \
		and (not second.get("success", true)) and second.get("code", "") == "DUPLICATE_TRANSACTION"
	return { "test": "TC-FLOW-S4-05: 同一事务键重复提交去重（无双倍奖励）", "passed": passed }

## TC-FLOW-S4-06: 投递失败 DISPATCH_PENDING + 恢复重发（不重复核销）
static func _test_dispatch_pending_recovery() -> Dictionary:
	RedemptionFlowOrchestrator.reset_records()
	var req := _build_request("TX_PEND_1", null)
	req["mailbox"] = null  # 首次投递失败（无邮箱）
	var first := RedemptionFlowOrchestrator.process_redemption(req)
	var pending: bool = (not first.get("success", true)) and first.get("code", "") == "DISPATCH_PENDING"
	# 恢复：真实邮箱重发
	var retry := RedemptionFlowOrchestrator.retry_dispatch("TX_PEND_1", MailboxManager.new())
	var passed = pending and retry.get("success", false) and retry.get("code", "") == "OK"
	return { "test": "TC-FLOW-S4-06: 投递失败 DISPATCH_PENDING 恢复重发不重复核销", "passed": passed }

## TC-FLOW-S4-07: 审计记录可回溯（内部状态/邮件路径——仅供服务端）
static func _test_audit_record_traceable() -> Dictionary:
	RedemptionFlowOrchestrator.reset_records()
	var req := _build_request("TX_AUDIT_1", null)
	req["mailbox"] = MailboxManager.new()
	var res := RedemptionFlowOrchestrator.process_redemption(req)
	var rec := RedemptionFlowOrchestrator.get_record("TX_AUDIT_1")
	var passed = res.get("success", false) \
		and rec.get("status", "") == "DISPATCHED" \
		and not String(rec.get("mail_id", "")).is_empty()
	return { "test": "TC-FLOW-S4-07: 审计记录可回溯（状态/邮件投递留痕）", "passed": passed }

static func _build_request(tx_id: String, mailbox, account_id: String = "ACC_TX_1", code: String = "KALAR_TX_TEST", registry: Dictionary = {}) -> Dictionary:
	var reg := registry
	if reg.is_empty():
		reg = { "KALAR_TX_TEST": _build_voucher() }
	return {
		"transaction_id": tx_id,
		"account_id": account_id,
		"character_level": 10,
		"voucher_code": code,
		"current_time_utc": 1000,
		"voucher_registry": reg,
		"rate_limit_state": {},
		"account_history": {},
		"unique_redeemed": {},
		"eligibility_metrics": {},
		"mailbox": mailbox
	}

## TC-FLOW-S4-08: 保留窗口压缩（超限清理最旧已完成记录 + DISPATCH_PENDING 保留）
static func _test_prune_retention() -> Dictionary:
	RedemptionFlowOrchestrator.reset_records()
	var reg := {}
	for i in range(3):
		var v := CDKeyVoucherAggregate.new("KALAR_P_%d" % i, CDKeyVoucherAggregate.VoucherType.UNIVERSAL_PER_ACCOUNT, "prune%d" % i)
		v.reward_payload = { "gold_coins": 1, "item_templates": [] }
		reg["KALAR_P_%d" % i] = v
	for i in range(3):
		var req := _build_request("TX_P_%d" % i, MailboxManager.new(), "ACC_P_%d" % i, "KALAR_P_%d" % i, reg)
		RedemptionFlowOrchestrator.process_redemption(req)
	# 压缩到 1：最旧 TX_P_0 被清理，最新 TX_P_2 保留
	RedemptionFlowOrchestrator.prune_records(1)
	var oldest_pruned: bool = RedemptionFlowOrchestrator.get_record("TX_P_0").is_empty()
	var newest_kept: bool = RedemptionFlowOrchestrator.get_record("TX_P_2").get("status", "") == "DISPATCHED"
	# DISPATCH_PENDING 不被压缩清除
	var pend_req := _build_request("TX_P_PEND", null, "ACC_P_9", "KALAR_P_1", reg)
	RedemptionFlowOrchestrator.process_redemption(pend_req)
	RedemptionFlowOrchestrator.prune_records(1)
	var pending_kept: bool = RedemptionFlowOrchestrator.get_record("TX_P_PEND").get("status", "") == "DISPATCH_PENDING"
	var passed = oldest_pruned and newest_kept and pending_kept
	return { "test": "TC-FLOW-S4-08: 保留窗口压缩（最旧清理 + pending 保留）", "passed": passed }

static func _build_voucher() -> CDKeyVoucherAggregate:
	var v := CDKeyVoucherAggregate.new("KALAR_TX_TEST", CDKeyVoucherAggregate.VoucherType.UNIVERSAL_PER_ACCOUNT, "流程测试礼包")
	v.reward_payload = { "mana_monocrystals": 2, "gold_coins": 10, "item_templates": [] }
	return v
